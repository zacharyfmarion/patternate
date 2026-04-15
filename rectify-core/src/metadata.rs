use serde::Serialize;

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

#[derive(Debug, Serialize)]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale: Option<ScaleMetadata>,
    /// H that maps board-mm → image-px (forward direction from detection).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homography_board_mm_to_image: Option<HomographyMatrix>,
    /// H that maps image-px → board-mm (inverse, used for warping).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homography_image_to_board_mm: Option<HomographyMatrix>,
}
