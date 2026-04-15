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

#[derive(Debug, Serialize)]
pub struct TransformMetadata {
    pub schema_version: u32,
    pub phase: &'static str,
    pub input_image: ImageMetadata,
    pub prepared_image: ImageMetadata,
    pub reference_board: ReferenceBoardMetadata,
    pub board_detection: crate::board_detect::BoardDetectionSummary,
}
