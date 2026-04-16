use serde::Serialize;

use crate::segment::SegmentationStats;

#[derive(Debug, Clone, Copy, Serialize)]
pub struct ImageMetadata {
    pub width_px: u32,
    pub height_px: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReferenceBoardMetadata {
    pub board_id: String,
    pub squares_x: u32,
    pub squares_y: u32,
    pub square_size_mm: f64,
    pub marker_size_mm: f64,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct ScaleMetadata {
    pub pixels_per_mm: f64,
    pub mm_per_pixel: f64,
}

/// The 3×3 homography stored row-major, matching the spec's `transform.json` layout.
pub type HomographyMatrix = [[f64; 3]; 3];

#[derive(Debug, Clone, Serialize)]
pub struct TransformMetadata {
    pub schema_version: u32,
    pub phase: &'static str,
    pub input_image: ImageMetadata,
    pub prepared_image: ImageMetadata,
    pub reference_board: ReferenceBoardMetadata,
    pub board_detection: crate::board_detect::BoardDetectionSummary,
    /// Present only after the rectification stage.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rectified_image: Option<ImageMetadata>,
    /// Rectified-image origin and extent in board-mm coordinates. Used by UI
    /// overlays to map polygon-mm back onto the rectified PNG.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rectified_bounds_mm: Option<[f64; 4]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale: Option<ScaleMetadata>,
    /// H that maps board-mm → image-px (forward direction from detection).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homography_board_mm_to_image: Option<HomographyMatrix>,
    /// H that maps image-px → board-mm (inverse, used for warping).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homography_image_to_board_mm: Option<HomographyMatrix>,
    /// Present only when outline extraction ran successfully.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outline: Option<OutlineMetadata>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OutlineMetadata {
    pub vertex_count_raw: usize,
    pub vertex_count_simplified: usize,
    pub simplify_tolerance_mm: f64,
    pub bounding_box_mm: [f64; 4],
    pub area_mm2: f64,
    pub perimeter_mm: f64,
    pub segmentation: SegmentationStats,
}
