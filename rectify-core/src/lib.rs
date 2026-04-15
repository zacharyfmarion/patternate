pub mod board_detect;
pub mod board_spec;
pub mod calibration;
pub mod grid_detect;
pub mod homography;
pub mod image_io;
pub mod metadata;
pub mod pipeline;
pub mod undistort;
pub mod warp;

pub use board_detect::{
    BoardDetectionDebug, BoardDetectionMarker, BoardDetectionResult, BoardDetectionSummary,
    CharucoCornerObservation, detect_board,
};
pub use board_spec::{BoardFamily, BoardSpec, BoardSpecSource, load_board_spec};
pub use calibration::{
    BrownConradyDistortion, CalibrationProfile, ImageSize, Intrinsics, ScaledCalibration,
};
pub use grid_detect::{DetectedLine, GridDetectionDebug, GridDetectionResult, detect_grid};
pub use homography::{Homography, RectifiedBounds, compute_rectified_bounds};
pub use image_io::{ExifOrientation, LoadedImage, apply_orientation};
pub use metadata::{HomographyMatrix, ImageMetadata, ReferenceBoardMetadata, ScaleMetadata, TransformMetadata};
pub use pipeline::{
    BoardDetectionRequest, BoardDetectionRunResult, RectifyRequest, RectifyRunResult,
    run_board_detection_checkpoint, run_rectify,
};
