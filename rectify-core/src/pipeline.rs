use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};

use crate::{
    board_detect::detect_board,
    board_spec::{BoardSpec, BoardSpecSource, load_board_spec},
    contour::{MmPolygon, pixels_to_mm, trace_outer_contour_px},
    homography::{Homography, RectifiedBounds, compute_rectified_bounds},
    image_io::load_image,
    metadata::{
        ImageMetadata, OutlineMetadata, ReferenceBoardMetadata, ScaleMetadata, TransformMetadata,
    },
    quality::{QualityReport, assess_quality},
    segment::{SegmentationOptions, SegmentationStats, segment_piece_with_validity},
    simplify::simplify_polygon,
    vector_export::{write_dxf, write_outline_json, write_svg},
    warp::warp_image_with_validity,
};
use image::{GrayImage, RgbImage};

// ---------------------------------------------------------------------------
// Shared request / result types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct BoardDetectionRequest {
    pub input_path: PathBuf,
    pub board_spec_source: BoardSpecSource,
    pub output_dir: PathBuf,
}

#[derive(Debug, Clone)]
pub struct BoardDetectionRunResult {
    pub prepared_input_path: PathBuf,
    pub debug_overlay_path: PathBuf,
    pub board_debug_path: PathBuf,
    pub transform_path: PathBuf,
    pub board_spec_path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct OutlineOptions {
    /// Enable outline extraction / SVG / DXF export.
    pub extract: bool,
    /// Ramer–Douglas–Peucker tolerance in mm.
    pub simplify_mm: f64,
    /// Minimum accepted candidate area, in mm². Anything smaller is
    /// rejected as noise.
    pub min_piece_area_mm2: f64,
    /// Additional mm margin around the known board rectangle to exclude
    /// from segmentation candidates.
    pub board_margin_mm: Option<f64>,
    /// Reserved for future curve fitting. Currently no-op.
    pub smooth: bool,
}

impl Default for OutlineOptions {
    fn default() -> Self {
        Self {
            extract: true,
            simplify_mm: 0.3,
            min_piece_area_mm2: 200.0,
            board_margin_mm: None,
            smooth: false,
        }
    }
}

#[derive(Debug, Clone)]
pub struct RectifyRequest {
    pub input_path: PathBuf,
    pub board_spec_source: BoardSpecSource,
    pub output_dir: PathBuf,
    /// Target output scale.  Defaults to 10 px/mm if not set.
    pub pixels_per_mm: Option<f64>,
    pub outline: OutlineOptions,
}

impl RectifyRequest {
    pub fn new(
        input_path: PathBuf,
        board_spec_source: BoardSpecSource,
        output_dir: PathBuf,
    ) -> Self {
        Self {
            input_path,
            board_spec_source,
            output_dir,
            pixels_per_mm: None,
            outline: OutlineOptions::default(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct OutlineOutput {
    pub svg_path: PathBuf,
    pub dxf_path: PathBuf,
    pub json_path: PathBuf,
    pub mask_debug_path: PathBuf,
    pub metadata: OutlineMetadata,
}

#[derive(Debug, Clone)]
pub struct RectifyRunResult {
    pub prepared_input_path: PathBuf,
    pub debug_overlay_path: PathBuf,
    pub board_debug_path: PathBuf,
    pub rectified_path: PathBuf,
    pub transform_path: PathBuf,
    pub quality_path: PathBuf,
    pub board_spec_path: PathBuf,
    pub pixels_per_mm: f64,
    pub quality: QualityReport,
    pub outline: Option<OutlineOutput>,
}

// ---------------------------------------------------------------------------
// Phase 2 checkpoint — board detection only
// ---------------------------------------------------------------------------

pub fn run_board_detection_checkpoint(
    request: &BoardDetectionRequest,
) -> Result<BoardDetectionRunResult> {
    fs::create_dir_all(&request.output_dir).with_context(|| {
        format!(
            "failed to create output directory {}",
            request.output_dir.display()
        )
    })?;

    let loaded = load_image(&request.input_path)?;
    let board_spec = load_board_spec(&request.board_spec_source)?;
    let board_spec_path = materialize_board_spec(&request.output_dir, &request.board_spec_source)?;

    let prepared_input_path = request.output_dir.join("prepared_input.png");
    loaded
        .image
        .save(&prepared_input_path)
        .with_context(|| format!("failed to save {}", prepared_input_path.display()))?;

    let board_debug_path = request.output_dir.join("board_debug.json");
    let debug_overlay_path = request.output_dir.join("debug_overlay.png");
    let gray = image::open(&prepared_input_path)
        .with_context(|| format!("failed to reload {} as grayscale", prepared_input_path.display()))?
        .to_luma8();
    let detection = detect_board(&gray, &board_spec)?;
    write_json_pretty_value(
        &board_debug_path,
        &serde_json::to_value(&detection.debug)?,
    )?;
    // Overlay: use the prepared input as placeholder (pure-Rust annotated overlay is not yet implemented).
    loaded
        .image
        .save(&debug_overlay_path)
        .with_context(|| format!("failed to save {}", debug_overlay_path.display()))?;

    let transform = TransformMetadata {
        schema_version: 1,
        phase: "board_detection_checkpoint",
        input_image: ImageMetadata {
            width_px: loaded.original_width_px,
            height_px: loaded.original_height_px,
        },
        prepared_image: ImageMetadata {
            width_px: loaded.image.width(),
            height_px: loaded.image.height(),
        },
        reference_board: ReferenceBoardMetadata {
            board_id: board_spec.board_id.clone(),
            squares_x: board_spec.squares_x,
            squares_y: board_spec.squares_y,
            square_size_mm: board_spec.square_size_mm,
            marker_size_mm: board_spec.marker_size_mm,
        },
        board_detection: detection.debug.summary.clone(),
        rectified_image: None,
        scale: None,
        homography_board_mm_to_image: None,
        homography_image_to_board_mm: None,
        outline: None,
    };

    let transform_path = request.output_dir.join("transform.json");
    write_json_pretty(&transform_path, &transform)?;

    Ok(BoardDetectionRunResult {
        prepared_input_path,
        debug_overlay_path,
        board_debug_path,
        transform_path,
        board_spec_path,
    })
}

// ---------------------------------------------------------------------------
// Phase 3 — full rectification
// ---------------------------------------------------------------------------

pub fn run_rectify(request: &RectifyRequest) -> Result<RectifyRunResult> {
    fs::create_dir_all(&request.output_dir).with_context(|| {
        format!(
            "failed to create output directory {}",
            request.output_dir.display()
        )
    })?;

    // --- Stage A: image ingestion ---
    let loaded = load_image(&request.input_path)?;
    let board_spec = load_board_spec(&request.board_spec_source)?;
    let board_spec_path = materialize_board_spec(&request.output_dir, &request.board_spec_source)?;

    let prepared_input_path = request.output_dir.join("prepared_input.png");
    loaded
        .image
        .save(&prepared_input_path)
        .with_context(|| format!("failed to save {}", prepared_input_path.display()))?;

    // --- Stage C: board detection ---
    let board_debug_path = request.output_dir.join("board_debug.json");
    let debug_overlay_path = request.output_dir.join("debug_overlay.png");
    let gray = image::open(&prepared_input_path)
        .with_context(|| format!("failed to reload {} as grayscale", prepared_input_path.display()))?
        .to_luma8();
    let detection = detect_board(&gray, &board_spec)?;
    write_json_pretty_value(
        &board_debug_path,
        &serde_json::to_value(&detection.debug)?,
    )?;
    // Overlay: use the prepared input as placeholder.
    loaded
        .image
        .save(&debug_overlay_path)
        .with_context(|| format!("failed to save {}", debug_overlay_path.display()))?;

    // --- Stage B: capture quality validation ---
    let quality_path = request.output_dir.join("quality.json");
    let quality = assess_quality(&loaded.image, &detection.debug.summary)
        .unwrap_or_else(|report| report.clone());

    // Write quality.json before checking for failure so it is always emitted.
    write_quality_json(&quality_path, &quality)?;

    if quality.status == crate::quality::QualityStatus::Fail {
        anyhow::bail!(
            "capture quality check failed: {}",
            quality.warnings.join("; ")
        );
    }

    // --- Stage D: homography estimation ---
    let h_board_to_image =
        Homography::from_rows(detection.debug.homography_board_mm_to_image);
    let h_image_to_board = h_board_to_image
        .inverse()
        .context("board homography is singular — cannot rectify")?;

    // --- Stage E: metric scale ---
    let pixels_per_mm = request.pixels_per_mm.unwrap_or(10.0);
    let bounds = compute_rectified_bounds(
        loaded.image.width(),
        loaded.image.height(),
        &h_image_to_board,
    );

    // --- Stage F: warp ---
    let (rectified, validity) =
        warp_image_with_validity(&loaded.image, &h_board_to_image, &bounds, pixels_per_mm);
    let rectified_path = request.output_dir.join("rectified.png");
    rectified
        .save(&rectified_path)
        .with_context(|| format!("failed to save {}", rectified_path.display()))?;

    let (out_w, out_h) = bounds.output_size_px(pixels_per_mm);
    let mm_per_pixel = 1.0 / pixels_per_mm;

    // --- Stage G: outline extraction (optional) ---
    let outline_output = if request.outline.extract {
        match extract_outline(
            &rectified,
            Some(&validity),
            &bounds,
            pixels_per_mm,
            &board_spec,
            &request.outline,
            &request.output_dir,
        ) {
            Ok(output) => Some(output),
            Err(e) => {
                eprintln!("outline extraction failed: {e:#}");
                None
            }
        }
    } else {
        None
    };

    // --- Emit transform.json ---
    let transform = TransformMetadata {
        schema_version: 1,
        phase: "rectify",
        input_image: ImageMetadata {
            width_px: loaded.original_width_px,
            height_px: loaded.original_height_px,
        },
        prepared_image: ImageMetadata {
            width_px: loaded.image.width(),
            height_px: loaded.image.height(),
        },
        reference_board: ReferenceBoardMetadata {
            board_id: board_spec.board_id.clone(),
            squares_x: board_spec.squares_x,
            squares_y: board_spec.squares_y,
            square_size_mm: board_spec.square_size_mm,
            marker_size_mm: board_spec.marker_size_mm,
        },
        board_detection: detection.debug.summary.clone(),
        rectified_image: Some(ImageMetadata {
            width_px: out_w,
            height_px: out_h,
        }),
        scale: Some(ScaleMetadata {
            pixels_per_mm,
            mm_per_pixel,
        }),
        homography_board_mm_to_image: Some(*h_board_to_image.rows()),
        homography_image_to_board_mm: Some(*h_image_to_board.rows()),
        outline: outline_output.as_ref().map(|o| o.metadata.clone()),
    };

    let transform_path = request.output_dir.join("transform.json");
    write_json_pretty(&transform_path, &transform)?;

    Ok(RectifyRunResult {
        prepared_input_path,
        debug_overlay_path,
        board_debug_path,
        rectified_path,
        transform_path,
        quality_path,
        board_spec_path,
        pixels_per_mm,
        quality,
        outline: outline_output,
    })
}

// ---------------------------------------------------------------------------
// Outline extraction
// ---------------------------------------------------------------------------

fn extract_outline(
    rectified: &RgbImage,
    validity: Option<&GrayImage>,
    bounds: &RectifiedBounds,
    pixels_per_mm: f64,
    board_spec: &BoardSpec,
    opts: &OutlineOptions,
    output_dir: &Path,
) -> Result<OutlineOutput> {
    let board_margin_mm = opts.board_margin_mm.unwrap_or(board_spec.quiet_zone_mm);

    let seg_opts = SegmentationOptions::default_for_scale(
        pixels_per_mm,
        *bounds,
        board_spec.board_width_mm(),
        board_spec.board_height_mm(),
        board_margin_mm,
        opts.min_piece_area_mm2,
    );

    let seg = segment_piece_with_validity(rectified, validity, &seg_opts)?;

    // Debug outputs so users (and tests) can inspect segmentation quality.
    let mask_debug_path = output_dir.join("piece_mask.png");
    seg.mask
        .save(&mask_debug_path)
        .with_context(|| format!("failed to save {}", mask_debug_path.display()))?;
    let exclusion_debug_path = output_dir.join("board_exclusion.png");
    let _ = seg.board_exclusion.save(&exclusion_debug_path);

    let pixel_contour = trace_outer_contour_px(&seg.mask)?;
    let raw_polygon = pixels_to_mm(&pixel_contour, bounds, pixels_per_mm);
    let raw_vertex_count = raw_polygon.len();

    let simplified = simplify_polygon(&raw_polygon, opts.simplify_mm);
    let polygon: MmPolygon = if opts.smooth {
        // Placeholder for future cubic-Bezier fit; keep identity for now so
        // downstream output is deterministic.
        simplified
    } else {
        simplified
    };

    let bbox = polygon
        .bbox()
        .context("simplified polygon has no vertices")?;
    let area_mm2 = polygon.area_abs();
    let perimeter_mm = polygon.perimeter();

    let svg_path = output_dir.join("outline.svg");
    write_svg(&svg_path, &polygon, bbox)?;

    let dxf_path = output_dir.join("outline.dxf");
    write_dxf(&dxf_path, &polygon, bbox)?;

    let outline_json = build_outline_json_payload(
        &polygon,
        bbox,
        area_mm2,
        perimeter_mm,
        raw_vertex_count,
        opts.simplify_mm,
        seg.stats,
    );
    let json_path = output_dir.join("outline.json");
    write_outline_json(&json_path, &outline_json)?;

    Ok(OutlineOutput {
        svg_path,
        dxf_path,
        json_path,
        mask_debug_path,
        metadata: OutlineMetadata {
            vertex_count_raw: raw_vertex_count,
            vertex_count_simplified: polygon.len(),
            simplify_tolerance_mm: opts.simplify_mm,
            bounding_box_mm: bbox,
            area_mm2,
            perimeter_mm,
            segmentation: seg.stats,
        },
    })
}

fn build_outline_json_payload(
    polygon: &MmPolygon,
    bbox: [f64; 4],
    area_mm2: f64,
    perimeter_mm: f64,
    raw_vertex_count: usize,
    simplify_mm: f64,
    segmentation: SegmentationStats,
) -> serde_json::Value {
    let points: Vec<serde_json::Value> = polygon
        .points
        .iter()
        .map(|p| serde_json::json!([p[0], p[1]]))
        .collect();

    serde_json::json!({
        "schema_version": 1,
        "units": "millimeters",
        "closed": true,
        "vertex_count_raw": raw_vertex_count,
        "vertex_count": polygon.len(),
        "simplify_tolerance_mm": simplify_mm,
        "bounding_box_mm": {
            "min_x": bbox[0],
            "min_y": bbox[1],
            "max_x": bbox[2],
            "max_y": bbox[3],
        },
        "area_mm2": area_mm2,
        "perimeter_mm": perimeter_mm,
        "polygon_mm": points,
        "segmentation": {
            "background_rgb": segmentation.background_rgb,
            "otsu_threshold": segmentation.otsu_threshold,
            "component_count": segmentation.component_count,
            "piece_area_mm2": segmentation.piece_area_mm2,
            "piece_pixel_count": segmentation.piece_pixel_count,
        },
    })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn materialize_board_spec(output_dir: &Path, source: &BoardSpecSource) -> Result<PathBuf> {
    match source {
        BoardSpecSource::Path(path) => Ok(path.clone()),
        BoardSpecSource::BuiltIn(board_id) => {
            let spec = load_board_spec(source)?;
            let path = output_dir.join(format!("{board_id}.json"));
            let json = serde_json::to_string_pretty(&spec)?;
            fs::write(&path, json)
                .with_context(|| format!("failed to write {}", path.display()))?;
            Ok(path)
        }
    }
}

fn write_json_pretty(path: &Path, value: &TransformMetadata) -> Result<()> {
    let json = serde_json::to_string_pretty(value)?;
    fs::write(path, json).with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

fn write_json_pretty_value(path: &Path, value: &serde_json::Value) -> Result<()> {
    let json = serde_json::to_string_pretty(value)?;
    fs::write(path, json).with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

fn write_quality_json(path: &Path, report: &QualityReport) -> Result<()> {
    let json = serde_json::to_string_pretty(report)?;
    fs::write(path, json).with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    fn unique_tmp(prefix: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "{prefix}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn board_detection_checkpoint_emits_expected_outputs() {
        let tmp = unique_tmp("rectify-core-board-checkpoint");
        fs::create_dir_all(&tmp).unwrap();
        let output_dir = tmp.join("output");

        let result = run_board_detection_checkpoint(&BoardDetectionRequest {
            input_path: Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../assets/refboard_v1/refboard_v1_letter.png"),
            board_spec_source: BoardSpecSource::BuiltIn("refboard_v1".to_string()),
            output_dir: output_dir.clone(),
        })
        .unwrap();

        assert!(result.prepared_input_path.exists());
        assert!(result.debug_overlay_path.exists());
        assert!(result.board_debug_path.exists());
        assert!(result.transform_path.exists());
        assert!(result.board_spec_path.exists());

        let transform: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&result.transform_path).unwrap()).unwrap();
        assert_eq!(transform["phase"], "board_detection_checkpoint");
        assert_eq!(transform["reference_board"]["board_id"], "refboard_v1");
        assert!(transform["board_detection"]["marker_count"].as_u64().unwrap() > 0);
        // Rectification fields must be absent in the checkpoint phase.
        assert!(transform["rectified_image"].is_null());
        assert!(transform["scale"].is_null());

        fs::remove_dir_all(tmp).unwrap();
    }

    #[test]
    fn rectify_emits_expected_outputs() {
        let tmp = unique_tmp("rectify-core-rectify");
        fs::create_dir_all(&tmp).unwrap();
        let output_dir = tmp.join("output");

        let result = run_rectify(&RectifyRequest {
            input_path: Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../assets/refboard_v1/refboard_v1_letter.png"),
            board_spec_source: BoardSpecSource::BuiltIn("refboard_v1".to_string()),
            output_dir: output_dir.clone(),
            pixels_per_mm: Some(5.0),
            outline: OutlineOptions {
                extract: false,
                ..OutlineOptions::default()
            },
        })
        .unwrap();

        // All output files must exist.
        assert!(result.prepared_input_path.exists(), "prepared_input.png missing");
        assert!(result.debug_overlay_path.exists(), "debug_overlay.png missing");
        assert!(result.board_debug_path.exists(), "board_debug.json missing");
        assert!(result.rectified_path.exists(), "rectified.png missing");
        assert!(result.transform_path.exists(), "transform.json missing");
        assert!(result.quality_path.exists(), "quality.json missing");

        // transform.json content checks.
        let transform: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&result.transform_path).unwrap()).unwrap();
        assert_eq!(transform["phase"], "rectify");
        assert_eq!(transform["scale"]["pixels_per_mm"], 5.0);
        assert!((transform["scale"]["mm_per_pixel"].as_f64().unwrap() - 0.2).abs() < 1e-9);
        assert!(transform["rectified_image"]["width_px"].as_u64().unwrap() > 0);
        assert!(transform["rectified_image"]["height_px"].as_u64().unwrap() > 0);
        // Both homography matrices must be 3×3.
        let h = &transform["homography_board_mm_to_image"];
        assert_eq!(h.as_array().unwrap().len(), 3);
        assert_eq!(h[0].as_array().unwrap().len(), 3);

        // rectified.png must be a valid, non-empty image.
        let img = image::open(&result.rectified_path).unwrap();
        assert!(img.width() > 0 && img.height() > 0);

        // quality.json must parse and have status ok or warning (not fail).
        let quality: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&result.quality_path).unwrap()).unwrap();
        assert_eq!(quality["schema_version"], 1);
        assert_ne!(quality["status"].as_str().unwrap(), "fail");
        assert!(quality["metrics"]["blur_score"].as_f64().unwrap() > 0.0);

        fs::remove_dir_all(tmp).unwrap();
    }

    #[test]
    fn rectify_scale_is_applied_correctly() {
        // Running the same image at two different scales should produce
        // proportionally different output dimensions.
        let base = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../assets/refboard_v1/refboard_v1_letter.png");

        let tmp5 = unique_tmp("rectify-scale-5");
        fs::create_dir_all(&tmp5).unwrap();
        let r5 = run_rectify(&RectifyRequest {
            input_path: base.clone(),
            board_spec_source: BoardSpecSource::BuiltIn("refboard_v1".to_string()),
            output_dir: tmp5.join("out"),
            pixels_per_mm: Some(5.0),
            outline: OutlineOptions {
                extract: false,
                ..OutlineOptions::default()
            },
        })
        .unwrap();

        let tmp10 = unique_tmp("rectify-scale-10");
        fs::create_dir_all(&tmp10).unwrap();
        let r10 = run_rectify(&RectifyRequest {
            input_path: base.clone(),
            board_spec_source: BoardSpecSource::BuiltIn("refboard_v1".to_string()),
            output_dir: tmp10.join("out"),
            pixels_per_mm: Some(10.0),
            outline: OutlineOptions {
                extract: false,
                ..OutlineOptions::default()
            },
        })
        .unwrap();

        let img5 = image::open(&r5.rectified_path).unwrap();
        let img10 = image::open(&r10.rectified_path).unwrap();

        // 10 px/mm should be roughly 2× the dimensions of 5 px/mm.
        let ratio_w = img10.width() as f64 / img5.width() as f64;
        let ratio_h = img10.height() as f64 / img5.height() as f64;
        assert!((ratio_w - 2.0).abs() < 0.05, "width ratio {ratio_w}");
        assert!((ratio_h - 2.0).abs() < 0.05, "height ratio {ratio_h}");

        fs::remove_dir_all(tmp5).unwrap();
        fs::remove_dir_all(tmp10).unwrap();
    }
}
