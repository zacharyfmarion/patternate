use serde::Serialize;

use crate::calibration::{BrownConradyDistortion, Intrinsics};

#[derive(Debug, Clone, Copy, Serialize)]
pub struct ImageMetadata {
    pub width_px: u32,
    pub height_px: u32,
}

#[derive(Debug, Serialize)]
pub struct TransformMetadata {
    pub schema_version: u32,
    pub phase: &'static str,
    pub input_image: ImageMetadata,
    pub undistorted_image: ImageMetadata,
    pub calibration_profile_id: String,
    pub intrinsics_used: Intrinsics,
    pub distortion_used: BrownConradyDistortion,
}

