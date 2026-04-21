use anyhow::{Result, anyhow};
use image::{DynamicImage, GrayImage};
use nalgebra::Point2;
use serde::{Deserialize, Serialize};

use calib_targets::charuco::{CharucoBoardSpec, CharucoParams, MarkerLayout};
use calib_targets::core::{estimate_homography_rect_to_img, Homography};
use calib_targets::detect::detect_charuco;
use calib_targets_aruco::builtins::builtin_dictionary;

use crate::board_spec::BoardSpec;

// ---------------------------------------------------------------------------
// Public types (shared with pipeline / quality)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardDetectionMarker {
    pub id: u32,
    pub corners_image: [[f32; 2]; 4],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharucoCornerObservation {
    pub id: u32,
    pub image_xy: [f32; 2],
    pub board_xy_mm: [f32; 2],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardDetectionSummary {
    pub board_id: String,
    pub marker_count: usize,
    pub charuco_corner_count: usize,
    pub confidence: f32,
    pub board_outline_image: Option<Vec<[f32; 2]>>,
    pub board_reprojection_rmse_px: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardDetectionDebug {
    pub summary: BoardDetectionSummary,
    /// 3×3 homography mapping board-mm → image-px, row-major.
    pub homography_board_mm_to_image: [[f64; 3]; 3],
    pub markers: Vec<BoardDetectionMarker>,
    pub charuco_corners: Vec<CharucoCornerObservation>,
}

#[derive(Debug, Clone)]
pub struct BoardDetectionResult {
    pub debug: BoardDetectionDebug,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Detect a ChArUco board, automatically handling portrait-orientation images.
///
/// Tries detection in the given orientation first. If that fails and the image
/// is portrait (height > width), retries after a 90° CW rotation to landscape —
/// some phone photos (with EXIF orientation applied) are only detectable in
/// landscape orientation due to a `calib_targets` bug with tall images. All
/// returned image coordinates are transformed back to the original space.
pub fn detect_board_in_image(
    gray: &GrayImage,
    board_spec: &BoardSpec,
) -> Result<BoardDetectionResult> {
    // Try detection in the original orientation first.
    if let Ok(result) = detect_board(gray, board_spec) {
        return Ok(result);
    }

    // Portrait-only fallback: rotate 90° CW to landscape, detect, transform back.
    if gray.height() <= gray.width() {
        return detect_board(gray, board_spec); // re-run to get the original error
    }
    let landscape = DynamicImage::ImageLuma8(gray.clone()).rotate90().into_luma8();
    let mut result = detect_board(&landscape, board_spec)?;

    // Map landscape coordinates back to portrait coordinates.
    // Rotate90 CW: portrait(x, y) → landscape(H_p - 1 - y, x)
    // Inverse: landscape(lx, ly) → portrait(ly, H_p - 1 - lx)
    // As homogeneous matrix T (landscape → portrait):
    //   [[0, 1, 0], [-1, 0, H_p - 1], [0, 0, 1]]
    let h_p = (gray.height() as f64) - 1.0;
    let t = [[0.0, 1.0, 0.0_f64], [-1.0, 0.0, h_p], [0.0, 0.0, 1.0]];

    result.debug.homography_board_mm_to_image =
        mat3_mul(&t, &result.debug.homography_board_mm_to_image);

    if let Some(ref mut outline) = result.debug.summary.board_outline_image {
        for pt in outline.iter_mut() {
            *pt = transform_pt_f32(&t, *pt);
        }
    }
    for corner in result.debug.charuco_corners.iter_mut() {
        corner.image_xy = transform_pt_f32(&t, corner.image_xy);
    }
    for marker in result.debug.markers.iter_mut() {
        for c in marker.corners_image.iter_mut() {
            *c = transform_pt_f32(&t, *c);
        }
    }

    Ok(result)
}

fn mat3_mul(a: &[[f64; 3]; 3], b: &[[f64; 3]; 3]) -> [[f64; 3]; 3] {
    let mut c = [[0.0_f64; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            for k in 0..3 {
                c[i][j] += a[i][k] * b[k][j];
            }
        }
    }
    c
}

fn transform_pt_f32(t: &[[f64; 3]; 3], [x, y]: [f32; 2]) -> [f32; 2] {
    let (xd, yd) = (x as f64, y as f64);
    let w = t[2][0] * xd + t[2][1] * yd + t[2][2];
    [(( t[0][0] * xd + t[0][1] * yd + t[0][2]) / w) as f32,
     ((t[1][0] * xd + t[1][1] * yd + t[1][2]) / w) as f32]
}

/// Detect a ChArUco board in `gray` using a pure-Rust detector.
///
/// Tries a range of `px_per_square` hints (multi-scale sweep) and returns
/// the first result that yields ≥ 6 corners with board-mm coordinates.
pub fn detect_board(
    gray: &GrayImage,
    board_spec: &BoardSpec,
) -> Result<BoardDetectionResult> {
    let charuco_spec = to_charuco_spec(board_spec)?;

    // Multi-scale sweep: board may appear at many sizes in real photos.
    // Each hint drives the grid-graph spacing window [hint*0.5, hint*1.5].
    let hints: &[f32] = &[35.0, 50.0, 65.0, 80.0, 100.0, 130.0, 160.0, 200.0];

    let mut best: Option<calib_targets::charuco::CharucoDetectionResult> = None;

    for &hint in hints {
        let mut params = CharucoParams::for_board(&charuco_spec);
        params.px_per_square = hint;
        params.chessboard.graph.min_spacing_pix = hint * 0.5;
        params.chessboard.graph.max_spacing_pix = hint * 1.5;

        if let Ok(det) = detect_charuco(gray, &params) {
            let n_with_pos = det
                .detection
                .corners
                .iter()
                .filter(|c| c.target_position.is_some())
                .count();
            if n_with_pos >= 6 {
                best = Some(det);
                break;
            }
        }
    }

    let det = best.ok_or_else(|| {
        anyhow!("ChArUco detection failed on all scale hints (board not found or too few corners)")
    })?;

    build_result(board_spec, &charuco_spec, &det)
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

fn to_charuco_spec(spec: &BoardSpec) -> Result<CharucoBoardSpec> {
    let dict = builtin_dictionary(&spec.marker_dictionary).ok_or_else(|| {
        anyhow!(
            "unsupported marker dictionary `{}`; check calib-targets-aruco builtins",
            spec.marker_dictionary
        )
    })?;

    Ok(CharucoBoardSpec {
        cols: spec.squares_x,
        rows: spec.squares_y,
        cell_size: spec.square_size_mm as f32,
        marker_size_rel: (spec.marker_size_mm / spec.square_size_mm) as f32,
        dictionary: dict,
        marker_layout: MarkerLayout::default(),
    })
}

fn build_result(
    board_spec: &BoardSpec,
    charuco_spec: &CharucoBoardSpec,
    det: &calib_targets::charuco::CharucoDetectionResult,
) -> Result<BoardDetectionResult> {
    // Collect corners that have board-mm positions.
    let corners: Vec<_> = det
        .detection
        .corners
        .iter()
        .filter(|c| c.target_position.is_some())
        .collect();

    let board_pts: Vec<Point2<f32>> = corners
        .iter()
        .map(|c| {
            let tp = c.target_position.unwrap();
            Point2::new(tp.x, tp.y)
        })
        .collect();

    let image_pts: Vec<Point2<f32>> = corners
        .iter()
        .map(|c| Point2::new(c.position.x, c.position.y))
        .collect();

    // Estimate H: board-mm → image-px via DLT.
    let h = estimate_homography_rect_to_img(&board_pts, &image_pts)
        .ok_or_else(|| anyhow!("homography DLT estimation failed (degenerate correspondences?)"))?;

    // Reprojection RMSE.
    let rmse = compute_rmse(&board_pts, &image_pts, &h);

    // Board outline in image coords: project the four board corners through H.
    let w_mm = charuco_spec.cols as f32 * charuco_spec.cell_size;
    let h_mm = charuco_spec.rows as f32 * charuco_spec.cell_size;
    let board_corners = [
        Point2::new(0.0_f32, 0.0),
        Point2::new(w_mm, 0.0),
        Point2::new(w_mm, h_mm),
        Point2::new(0.0, h_mm),
    ];
    let outline: Vec<[f32; 2]> = board_corners
        .iter()
        .map(|&p| {
            let ip = h.apply(p);
            [ip.x, ip.y]
        })
        .collect();

    // Confidence: fraction of interior corners detected vs maximum.
    let max_corners = (charuco_spec.cols - 1) * (charuco_spec.rows - 1);
    let confidence = corners.len() as f32 / max_corners as f32;

    // Convert H from f32 to f64 for storage.
    let h_arr = h.to_array();
    let homography_f64: [[f64; 3]; 3] = [
        [h_arr[0][0] as f64, h_arr[0][1] as f64, h_arr[0][2] as f64],
        [h_arr[1][0] as f64, h_arr[1][1] as f64, h_arr[1][2] as f64],
        [h_arr[2][0] as f64, h_arr[2][1] as f64, h_arr[2][2] as f64],
    ];

    // Build marker list (only markers with image-space corners are useful).
    let markers: Vec<BoardDetectionMarker> = det
        .markers
        .iter()
        .filter_map(|m| {
            let corners = m.corners_img?;
            Some(BoardDetectionMarker {
                id: m.id,
                corners_image: corners.map(|p| [p.x, p.y]),
            })
        })
        .collect();

    // Build charuco corner observations.
    let charuco_corners: Vec<CharucoCornerObservation> = corners
        .iter()
        .filter_map(|c| {
            let tp = c.target_position?;
            let id = c.id?;
            Some(CharucoCornerObservation {
                id: id as u32,
                image_xy: [c.position.x, c.position.y],
                board_xy_mm: [tp.x, tp.y],
            })
        })
        .collect();

    Ok(BoardDetectionResult {
        debug: BoardDetectionDebug {
            summary: BoardDetectionSummary {
                board_id: board_spec.board_id.clone(),
                marker_count: det.markers.len(),
                charuco_corner_count: corners.len(),
                confidence,
                board_outline_image: Some(outline),
                board_reprojection_rmse_px: Some(rmse),
            },
            homography_board_mm_to_image: homography_f64,
            markers,
            charuco_corners,
        },
    })
}

/// Compute reprojection RMSE: mean L2 distance between observed image points
/// and DLT-projected board-mm points.
fn compute_rmse(
    board_pts: &[Point2<f32>],
    image_pts: &[Point2<f32>],
    h: &Homography<f32>,
) -> f32 {
    if board_pts.is_empty() {
        return 0.0;
    }
    let sum_sq: f32 = board_pts
        .iter()
        .zip(image_pts.iter())
        .map(|(&bp, &ip)| {
            let pred = h.apply(bp);
            let dx = pred.x - ip.x;
            let dy = pred.y - ip.y;
            dx * dx + dy * dy
        })
        .sum();
    (sum_sq / board_pts.len() as f32).sqrt()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board_spec::{BoardSpecSource, load_board_spec};

    fn load_gray(rel_path: &str) -> GrayImage {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        image::open(root.join(rel_path))
            .unwrap_or_else(|_| panic!("failed to open {rel_path}"))
            .to_luma8()
    }

    fn refboard_v1() -> BoardSpec {
        load_board_spec(&BoardSpecSource::BuiltIn("refboard_v1".to_string())).unwrap()
    }

    #[test]
    fn detects_board_png_300dpi() {
        let gray = load_gray("assets/refboard_v1/refboard_v1_letter.png");
        let spec = refboard_v1();
        let result = detect_board(&gray, &spec).expect("detection should succeed");
        let s = &result.debug.summary;
        assert_eq!(s.board_id, "refboard_v1");
        assert!(s.charuco_corner_count >= 6, "need ≥6 corners, got {}", s.charuco_corner_count);
        assert!(s.board_outline_image.is_some());
        assert!(s.board_reprojection_rmse_px.unwrap() < 5.0, "RMSE too high");
    }

    #[test]
    fn detects_synthetic_easy() {
        let gray = load_gray("examples/photos/synthetic_refboard_set/easy.png");
        let spec = refboard_v1();
        let result = detect_board(&gray, &spec).expect("detection should succeed on easy scene");
        let s = &result.debug.summary;
        assert!(s.charuco_corner_count >= 6);
        assert!(s.board_reprojection_rmse_px.unwrap() < 5.0);
    }

    #[test]
    fn detects_synthetic_oblique() {
        let gray = load_gray("examples/photos/synthetic_refboard_set/oblique.png");
        let spec = refboard_v1();
        let result = detect_board(&gray, &spec).expect("detection should succeed on oblique scene");
        let s = &result.debug.summary;
        assert!(s.charuco_corner_count >= 6);
    }

    #[test]
    fn detects_synthetic_partial_occlusion() {
        let gray = load_gray("examples/photos/synthetic_refboard_set/partial_occlusion.png");
        let spec = refboard_v1();
        let result =
            detect_board(&gray, &spec).expect("detection should succeed on partially occluded board");
        let s = &result.debug.summary;
        assert!(s.charuco_corner_count >= 6);
    }

    #[test]
    fn homography_matrix_is_finite() {
        let gray = load_gray("assets/refboard_v1/refboard_v1_letter.png");
        let spec = refboard_v1();
        let result = detect_board(&gray, &spec).unwrap();
        let h = &result.debug.homography_board_mm_to_image;
        for row in h {
            for &v in row {
                assert!(v.is_finite(), "H contains non-finite value: {v}");
            }
        }
    }

    #[test]
    fn unsupported_dictionary_errors() {
        let spec = BoardSpec {
            schema_version: 1,
            board_id: "test".to_string(),
            board_family: crate::board_spec::BoardFamily::Charuco,
            marker_dictionary: "DICT_INVALID_XYZ".to_string(),
            squares_x: 6,
            squares_y: 5,
            square_size_mm: 10.0,
            marker_size_mm: 7.0,
            quiet_zone_mm: 5.0,
            origin: "top_left_corner".to_string(),
            target_paper: None,
            notes: None,
        };
        let gray = GrayImage::new(64, 64);
        assert!(detect_board(&gray, &spec).is_err());
    }
}
