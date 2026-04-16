#[cfg(not(target_family = "wasm"))]
use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[cfg(not(target_family = "wasm"))]
use crate::board_spec::{BoardSpecSource, load_board_spec};
use crate::{
    board_detect::{BoardDetectionDebug, detect_board},
    board_spec::BoardSpec,
    contour::{MmPolygon, pixels_to_mm, trace_outer_contour_px},
    homography::{Homography, RectifiedBounds, compute_rectified_bounds},
    image_io::{LoadedImage, load_image_from_bytes},
    metadata::{
        ImageMetadata, OutlineMetadata, ReferenceBoardMetadata, ScaleMetadata, TransformMetadata,
    },
    quality::{QualityReport, QualityStatus, assess_quality},
    segment::{SegmentationOptions, SegmentationStats, segment_piece_with_validity},
    simplify::simplify_polygon,
    vector_export::{render_dxf, render_svg},
    warp::warp_image_with_validity,
};
use image::{GrayImage, ImageFormat, RgbImage};

// ---------------------------------------------------------------------------
// Shared option / result types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
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

/// Options for the in-memory rectify pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RectifyOptions {
    /// Target output scale. Defaults to 10 px/mm when `None`.
    pub pixels_per_mm: Option<f64>,
    pub outline: OutlineOptions,
}

impl Default for RectifyOptions {
    fn default() -> Self {
        Self {
            pixels_per_mm: None,
            outline: OutlineOptions::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RectifyProgressStep {
    PrepareInput,
    DetectBoard,
    AssessQuality,
    RectifyImage,
    ExtractOutline,
    FinalizeResults,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RectifyProgressStatus {
    Running,
    Completed,
    Skipped,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RectifyProgressEvent {
    pub step: RectifyProgressStep,
    pub status: RectifyProgressStatus,
    pub message: String,
}

// ---------------------------------------------------------------------------
// In-memory result types (no filesystem paths). These are what WASM exports.
// ---------------------------------------------------------------------------

/// Fully serializable outline bundle produced by the in-memory pipeline.
#[derive(Debug, Clone, Serialize)]
pub struct OutlineBundle {
    /// SVG document as a string.
    pub svg: String,
    /// DXF document as a string.
    pub dxf: String,
    /// `outline.json` payload.
    pub json: serde_json::Value,
    /// PNG-encoded piece mask (debug aid).
    #[serde(skip_serializing)]
    pub mask_png: Vec<u8>,
    /// Polygon in millimetre coordinates on the board plane.
    pub polygon_mm: Vec<[f64; 2]>,
    /// Structured metadata (vertex counts, area, perimeter, segmentation).
    pub metadata: OutlineMetadata,
}

/// Result of the in-memory board-detection pass.
#[derive(Debug, Clone)]
pub struct DetectBoardOutcome {
    pub detection: BoardDetectionDebug,
    pub metadata: TransformMetadata,
    /// PNG-encoded prepared (EXIF-oriented) input image.
    pub prepared_png: Vec<u8>,
    pub input_width_px: u32,
    pub input_height_px: u32,
    pub prepared_width_px: u32,
    pub prepared_height_px: u32,
}

/// Result of the in-memory full rectify pass.
#[derive(Debug)]
pub struct RectifyOutcome {
    pub detection: BoardDetectionDebug,
    pub quality: QualityReport,
    pub metadata: TransformMetadata,
    /// PNG-encoded prepared (EXIF-oriented) input image.
    pub prepared_png: Vec<u8>,
    /// PNG-encoded rectified output (may be empty if quality failed and
    /// rectification was skipped).
    pub rectified_png: Vec<u8>,
    pub pixels_per_mm: f64,
    pub outline: Option<OutlineBundle>,
    /// True if quality check hard-failed and rectification was skipped.
    pub quality_failed: bool,
}

// ---------------------------------------------------------------------------
// In-memory core — used by WASM and by the filesystem wrappers below
// ---------------------------------------------------------------------------

/// Run board detection on in-memory image bytes, returning a serializable
/// bundle of the detection debug, the prepared PNG, and transform metadata.
pub fn detect_board_in_memory(
    image_bytes: &[u8],
    board_spec: &BoardSpec,
) -> Result<DetectBoardOutcome> {
    let loaded = load_image_from_bytes(image_bytes)?;
    let detection = detect_board(&to_gray(&loaded.image), board_spec)?.debug;
    let prepared_png = encode_png(&loaded.image)?;

    let metadata = build_metadata_board_only(&loaded, board_spec, &detection);

    Ok(DetectBoardOutcome {
        detection,
        metadata,
        prepared_png,
        input_width_px: loaded.original_width_px,
        input_height_px: loaded.original_height_px,
        prepared_width_px: loaded.image.width(),
        prepared_height_px: loaded.image.height(),
    })
}

/// Run the full rectify pipeline on in-memory image bytes.
///
/// Always returns `Ok` (even when the quality gate fails, so callers can
/// display the report); check `quality_failed` to see whether rectification
/// was skipped.
pub fn rectify_in_memory(
    image_bytes: &[u8],
    board_spec: &BoardSpec,
    options: &RectifyOptions,
) -> Result<RectifyOutcome> {
    rectify_in_memory_with_progress(image_bytes, board_spec, options, |_| {})
}

pub fn rectify_in_memory_with_progress<F>(
    image_bytes: &[u8],
    board_spec: &BoardSpec,
    options: &RectifyOptions,
    mut on_progress: F,
) -> Result<RectifyOutcome>
where
    F: FnMut(RectifyProgressEvent),
{
    progress(
        &mut on_progress,
        RectifyProgressStep::PrepareInput,
        RectifyProgressStatus::Running,
        "Preparing input image",
    );
    let loaded = load_image_from_bytes(image_bytes)?;
    let prepared_png = encode_png(&loaded.image)?;
    progress(
        &mut on_progress,
        RectifyProgressStep::PrepareInput,
        RectifyProgressStatus::Completed,
        "Prepared input image",
    );

    progress(
        &mut on_progress,
        RectifyProgressStep::DetectBoard,
        RectifyProgressStatus::Running,
        "Detecting reference board",
    );
    let detection = detect_board(&to_gray(&loaded.image), board_spec)?.debug;
    progress(
        &mut on_progress,
        RectifyProgressStep::DetectBoard,
        RectifyProgressStatus::Completed,
        format!(
            "Detected {} markers and {} ChArUco corners",
            detection.summary.marker_count, detection.summary.charuco_corner_count
        ),
    );

    progress(
        &mut on_progress,
        RectifyProgressStep::AssessQuality,
        RectifyProgressStatus::Running,
        "Checking image quality",
    );
    let quality =
        assess_quality(&loaded.image, &detection.summary).unwrap_or_else(|report| report.clone());

    if quality.status == QualityStatus::Fail {
        progress(
            &mut on_progress,
            RectifyProgressStep::AssessQuality,
            RectifyProgressStatus::Failed,
            if quality.warnings.is_empty() {
                "Quality gate failed".to_string()
            } else {
                format!("Quality gate failed: {}", quality.warnings.join("; "))
            },
        );
        progress(
            &mut on_progress,
            RectifyProgressStep::RectifyImage,
            RectifyProgressStatus::Skipped,
            "Skipped because quality checks failed",
        );
        progress(
            &mut on_progress,
            RectifyProgressStep::ExtractOutline,
            RectifyProgressStatus::Skipped,
            "Skipped because rectification did not run",
        );
        let metadata = build_metadata_board_only(&loaded, board_spec, &detection);
        return Ok(RectifyOutcome {
            detection,
            quality,
            metadata,
            prepared_png,
            rectified_png: Vec::new(),
            pixels_per_mm: options.pixels_per_mm.unwrap_or(10.0),
            outline: None,
            quality_failed: true,
        });
    }
    progress(
        &mut on_progress,
        RectifyProgressStep::AssessQuality,
        RectifyProgressStatus::Completed,
        if quality.warnings.is_empty() {
            "Image quality checks passed".to_string()
        } else {
            format!("Quality checks passed with warnings: {}", quality.warnings.join("; "))
        },
    );

    progress(
        &mut on_progress,
        RectifyProgressStep::RectifyImage,
        RectifyProgressStatus::Running,
        "Rectifying image to board plane",
    );
    let h_board_to_image = Homography::from_rows(detection.homography_board_mm_to_image);
    let h_image_to_board = h_board_to_image
        .inverse()
        .context("board homography is singular — cannot rectify")?;

    let pixels_per_mm = options.pixels_per_mm.unwrap_or(10.0);
    let bounds = compute_rectified_bounds(
        loaded.image.width(),
        loaded.image.height(),
        &h_image_to_board,
    );

    let (rectified, validity) =
        warp_image_with_validity(&loaded.image, &h_board_to_image, &bounds, pixels_per_mm);
    let rectified_png = encode_png(&rectified)?;
    progress(
        &mut on_progress,
        RectifyProgressStep::RectifyImage,
        RectifyProgressStatus::Completed,
        format!(
            "Created rectified image at {:.1} px/mm",
            pixels_per_mm
        ),
    );

    let (out_w, out_h) = bounds.output_size_px(pixels_per_mm);
    let mm_per_pixel = 1.0 / pixels_per_mm;

    let outline_bundle = if options.outline.extract {
        progress(
            &mut on_progress,
            RectifyProgressStep::ExtractOutline,
            RectifyProgressStatus::Running,
            "Extracting pattern outline",
        );
        match extract_outline_in_memory(
            &rectified,
            Some(&validity),
            &bounds,
            pixels_per_mm,
            board_spec,
            &options.outline,
        ) {
            Ok(bundle) => {
                progress(
                    &mut on_progress,
                    RectifyProgressStep::ExtractOutline,
                    RectifyProgressStatus::Completed,
                    format!(
                        "Extracted outline with {} vertices",
                        bundle.metadata.vertex_count_simplified
                    ),
                );
                Some(bundle)
            }
            Err(err) => {
                progress(
                    &mut on_progress,
                    RectifyProgressStep::ExtractOutline,
                    RectifyProgressStatus::Failed,
                    format!("Outline extraction failed: {err}"),
                );
                None
            }
        }
    } else {
        progress(
            &mut on_progress,
            RectifyProgressStep::ExtractOutline,
            RectifyProgressStatus::Skipped,
            "Outline extraction is disabled",
        );
        None
    };

    let metadata = TransformMetadata {
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
        board_detection: detection.summary.clone(),
        rectified_image: Some(ImageMetadata {
            width_px: out_w,
            height_px: out_h,
        }),
        rectified_bounds_mm: Some([
            bounds.min_x_mm,
            bounds.min_y_mm,
            bounds.max_x_mm,
            bounds.max_y_mm,
        ]),
        scale: Some(ScaleMetadata {
            pixels_per_mm,
            mm_per_pixel,
        }),
        homography_board_mm_to_image: Some(*h_board_to_image.rows()),
        homography_image_to_board_mm: Some(*h_image_to_board.rows()),
        outline: outline_bundle.as_ref().map(|b| b.metadata.clone()),
    };

    Ok(RectifyOutcome {
        detection,
        quality,
        metadata,
        prepared_png,
        rectified_png,
        pixels_per_mm,
        outline: outline_bundle,
        quality_failed: false,
    })
}

fn progress<F>(
    on_progress: &mut F,
    step: RectifyProgressStep,
    status: RectifyProgressStatus,
    message: impl Into<String>,
) where
    F: FnMut(RectifyProgressEvent),
{
    on_progress(RectifyProgressEvent {
        step,
        status,
        message: message.into(),
    });
}

// ---------------------------------------------------------------------------
// Outline extraction (pure, in-memory)
// ---------------------------------------------------------------------------

fn extract_outline_in_memory(
    rectified: &RgbImage,
    validity: Option<&GrayImage>,
    bounds: &RectifiedBounds,
    pixels_per_mm: f64,
    board_spec: &BoardSpec,
    opts: &OutlineOptions,
) -> Result<OutlineBundle> {
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

    let pixel_contour = trace_outer_contour_px(&seg.mask)?;
    let raw_polygon = pixels_to_mm(&pixel_contour, bounds, pixels_per_mm);
    let raw_vertex_count = raw_polygon.len();

    let simplified = simplify_polygon(&raw_polygon, opts.simplify_mm);
    let polygon: MmPolygon = if opts.smooth { simplified } else { simplified };

    let bbox = polygon
        .bbox()
        .context("simplified polygon has no vertices")?;
    let area_mm2 = polygon.area_abs();
    let perimeter_mm = polygon.perimeter();

    let svg = render_svg(&polygon, bbox);
    let dxf = render_dxf(&polygon, bbox);

    let json = build_outline_json_payload(
        &polygon,
        bbox,
        area_mm2,
        perimeter_mm,
        raw_vertex_count,
        opts.simplify_mm,
        seg.stats,
    );

    let mask_png = encode_png_gray(&seg.mask)?;

    Ok(OutlineBundle {
        svg,
        dxf,
        json,
        mask_png,
        polygon_mm: polygon.points.clone(),
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

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

fn encode_png(image: &RgbImage) -> Result<Vec<u8>> {
    let mut buf = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut buf), ImageFormat::Png)
        .context("failed to PNG-encode image")?;
    Ok(buf)
}

fn encode_png_gray(image: &GrayImage) -> Result<Vec<u8>> {
    let mut buf = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut buf), ImageFormat::Png)
        .context("failed to PNG-encode grayscale image")?;
    Ok(buf)
}

fn to_gray(image: &RgbImage) -> GrayImage {
    let (w, h) = image.dimensions();
    let mut gray = GrayImage::new(w, h);
    for (x, y, px) in image.enumerate_pixels() {
        let [r, g, b] = px.0;
        let luma = (0.299 * r as f64 + 0.587 * g as f64 + 0.114 * b as f64).round() as u8;
        gray.put_pixel(x, y, image::Luma([luma]));
    }
    gray
}

fn build_metadata_board_only(
    loaded: &LoadedImage,
    board_spec: &BoardSpec,
    detection: &BoardDetectionDebug,
) -> TransformMetadata {
    TransformMetadata {
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
        board_detection: detection.summary.clone(),
        rectified_image: None,
        rectified_bounds_mm: None,
        scale: None,
        homography_board_mm_to_image: None,
        homography_image_to_board_mm: None,
        outline: None,
    }
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
// Filesystem wrappers (native-only)
// ---------------------------------------------------------------------------

#[cfg(not(target_family = "wasm"))]
#[derive(Debug, Clone)]
pub struct BoardDetectionRequest {
    pub input_path: PathBuf,
    pub board_spec_source: BoardSpecSource,
    pub output_dir: PathBuf,
}

#[cfg(not(target_family = "wasm"))]
#[derive(Debug, Clone)]
pub struct BoardDetectionRunResult {
    pub prepared_input_path: PathBuf,
    pub debug_overlay_path: PathBuf,
    pub board_debug_path: PathBuf,
    pub transform_path: PathBuf,
    pub board_spec_path: PathBuf,
}

#[cfg(not(target_family = "wasm"))]
#[derive(Debug, Clone)]
pub struct RectifyRequest {
    pub input_path: PathBuf,
    pub board_spec_source: BoardSpecSource,
    pub output_dir: PathBuf,
    pub pixels_per_mm: Option<f64>,
    pub outline: OutlineOptions,
}

#[cfg(not(target_family = "wasm"))]
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

#[cfg(not(target_family = "wasm"))]
#[derive(Debug, Clone)]
pub struct OutlineOutput {
    pub svg_path: PathBuf,
    pub dxf_path: PathBuf,
    pub json_path: PathBuf,
    pub mask_debug_path: PathBuf,
    pub metadata: OutlineMetadata,
}

#[cfg(not(target_family = "wasm"))]
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

#[cfg(not(target_family = "wasm"))]
pub fn run_board_detection_checkpoint(
    request: &BoardDetectionRequest,
) -> Result<BoardDetectionRunResult> {
    fs::create_dir_all(&request.output_dir).with_context(|| {
        format!(
            "failed to create output directory {}",
            request.output_dir.display()
        )
    })?;

    let bytes = fs::read(&request.input_path).with_context(|| {
        format!("failed to read image {}", request.input_path.display())
    })?;
    let board_spec = load_board_spec(&request.board_spec_source)?;
    let board_spec_path = materialize_board_spec(&request.output_dir, &request.board_spec_source)?;

    let outcome = detect_board_in_memory(&bytes, &board_spec)?;

    let prepared_input_path = request.output_dir.join("prepared_input.png");
    fs::write(&prepared_input_path, &outcome.prepared_png)
        .with_context(|| format!("failed to save {}", prepared_input_path.display()))?;

    let debug_overlay_path = request.output_dir.join("debug_overlay.png");
    fs::write(&debug_overlay_path, &outcome.prepared_png)
        .with_context(|| format!("failed to save {}", debug_overlay_path.display()))?;

    let board_debug_path = request.output_dir.join("board_debug.json");
    write_json_pretty_value(&board_debug_path, &serde_json::to_value(&outcome.detection)?)?;

    let transform_path = request.output_dir.join("transform.json");
    write_json_pretty(&transform_path, &outcome.metadata)?;

    Ok(BoardDetectionRunResult {
        prepared_input_path,
        debug_overlay_path,
        board_debug_path,
        transform_path,
        board_spec_path,
    })
}

#[cfg(not(target_family = "wasm"))]
pub fn run_rectify(request: &RectifyRequest) -> Result<RectifyRunResult> {
    fs::create_dir_all(&request.output_dir).with_context(|| {
        format!(
            "failed to create output directory {}",
            request.output_dir.display()
        )
    })?;

    let bytes = fs::read(&request.input_path).with_context(|| {
        format!("failed to read image {}", request.input_path.display())
    })?;
    let board_spec = load_board_spec(&request.board_spec_source)?;
    let board_spec_path = materialize_board_spec(&request.output_dir, &request.board_spec_source)?;

    let opts = RectifyOptions {
        pixels_per_mm: request.pixels_per_mm,
        outline: request.outline.clone(),
    };
    let outcome = rectify_in_memory(&bytes, &board_spec, &opts)?;

    let prepared_input_path = request.output_dir.join("prepared_input.png");
    fs::write(&prepared_input_path, &outcome.prepared_png)
        .with_context(|| format!("failed to save {}", prepared_input_path.display()))?;

    let debug_overlay_path = request.output_dir.join("debug_overlay.png");
    fs::write(&debug_overlay_path, &outcome.prepared_png)
        .with_context(|| format!("failed to save {}", debug_overlay_path.display()))?;

    let board_debug_path = request.output_dir.join("board_debug.json");
    write_json_pretty_value(&board_debug_path, &serde_json::to_value(&outcome.detection)?)?;

    let quality_path = request.output_dir.join("quality.json");
    write_quality_json(&quality_path, &outcome.quality)?;

    if outcome.quality_failed {
        anyhow::bail!(
            "capture quality check failed: {}",
            outcome.quality.warnings.join("; ")
        );
    }

    let rectified_path = request.output_dir.join("rectified.png");
    fs::write(&rectified_path, &outcome.rectified_png)
        .with_context(|| format!("failed to save {}", rectified_path.display()))?;

    let outline_output = if let Some(bundle) = outcome.outline.as_ref() {
        let svg_path = request.output_dir.join("outline.svg");
        fs::write(&svg_path, bundle.svg.as_bytes())
            .with_context(|| format!("failed to write {}", svg_path.display()))?;
        let dxf_path = request.output_dir.join("outline.dxf");
        fs::write(&dxf_path, bundle.dxf.as_bytes())
            .with_context(|| format!("failed to write {}", dxf_path.display()))?;
        let json_path = request.output_dir.join("outline.json");
        fs::write(&json_path, serde_json::to_string_pretty(&bundle.json)?)
            .with_context(|| format!("failed to write {}", json_path.display()))?;
        let mask_debug_path = request.output_dir.join("piece_mask.png");
        fs::write(&mask_debug_path, &bundle.mask_png)
            .with_context(|| format!("failed to write {}", mask_debug_path.display()))?;
        Some(OutlineOutput {
            svg_path,
            dxf_path,
            json_path,
            mask_debug_path,
            metadata: bundle.metadata.clone(),
        })
    } else {
        None
    };

    let transform_path = request.output_dir.join("transform.json");
    write_json_pretty(&transform_path, &outcome.metadata)?;

    Ok(RectifyRunResult {
        prepared_input_path,
        debug_overlay_path,
        board_debug_path,
        rectified_path,
        transform_path,
        quality_path,
        board_spec_path,
        pixels_per_mm: outcome.pixels_per_mm,
        quality: outcome.quality,
        outline: outline_output,
    })
}

#[cfg(not(target_family = "wasm"))]
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

#[cfg(not(target_family = "wasm"))]
fn write_json_pretty(path: &Path, value: &TransformMetadata) -> Result<()> {
    let json = serde_json::to_string_pretty(value)?;
    fs::write(path, json).with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

#[cfg(not(target_family = "wasm"))]
fn write_json_pretty_value(path: &Path, value: &serde_json::Value) -> Result<()> {
    let json = serde_json::to_string_pretty(value)?;
    fs::write(path, json).with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

#[cfg(not(target_family = "wasm"))]
fn write_quality_json(path: &Path, report: &QualityReport) -> Result<()> {
    let json = serde_json::to_string_pretty(report)?;
    fs::write(path, json).with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(all(test, not(target_family = "wasm")))]
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

        assert!(result.prepared_input_path.exists(), "prepared_input.png missing");
        assert!(result.debug_overlay_path.exists(), "debug_overlay.png missing");
        assert!(result.board_debug_path.exists(), "board_debug.json missing");
        assert!(result.rectified_path.exists(), "rectified.png missing");
        assert!(result.transform_path.exists(), "transform.json missing");
        assert!(result.quality_path.exists(), "quality.json missing");

        let transform: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&result.transform_path).unwrap()).unwrap();
        assert_eq!(transform["phase"], "rectify");
        assert_eq!(transform["scale"]["pixels_per_mm"], 5.0);
        assert!((transform["scale"]["mm_per_pixel"].as_f64().unwrap() - 0.2).abs() < 1e-9);
        assert!(transform["rectified_image"]["width_px"].as_u64().unwrap() > 0);
        assert!(transform["rectified_image"]["height_px"].as_u64().unwrap() > 0);
        let h = &transform["homography_board_mm_to_image"];
        assert_eq!(h.as_array().unwrap().len(), 3);
        assert_eq!(h[0].as_array().unwrap().len(), 3);

        let img = image::open(&result.rectified_path).unwrap();
        assert!(img.width() > 0 && img.height() > 0);

        let quality: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&result.quality_path).unwrap()).unwrap();
        assert_eq!(quality["schema_version"], 1);
        assert_ne!(quality["status"].as_str().unwrap(), "fail");
        assert!(quality["metrics"]["blur_score"].as_f64().unwrap() > 0.0);

        fs::remove_dir_all(tmp).unwrap();
    }

    #[test]
    fn rectify_scale_is_applied_correctly() {
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

        let ratio_w = img10.width() as f64 / img5.width() as f64;
        let ratio_h = img10.height() as f64 / img5.height() as f64;
        assert!((ratio_w - 2.0).abs() < 0.05, "width ratio {ratio_w}");
        assert!((ratio_h - 2.0).abs() < 0.05, "height ratio {ratio_h}");

        fs::remove_dir_all(tmp5).unwrap();
        fs::remove_dir_all(tmp10).unwrap();
    }
}
