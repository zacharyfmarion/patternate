pub mod board_detect;
pub mod board_spec;
pub mod calibration;
pub mod contour;
pub mod grid_detect;
pub mod homography;
pub mod image_io;
pub mod metadata;
pub mod pipeline;
pub mod quality;
pub mod segment;
pub mod simplify;
pub mod undistort;
pub mod vector_export;
pub mod warp;

pub use board_detect::{
    BoardDetectionDebug, BoardDetectionMarker, BoardDetectionResult, BoardDetectionSummary,
    CharucoCornerObservation, detect_board, detect_board_in_image,
};
pub use board_spec::{
    BoardFamily, BoardSpec, BoardSpecSource, builtin_board_spec_json, load_board_spec,
    load_builtin_board_spec,
};
pub use calibration::{
    BrownConradyDistortion, CalibrationProfile, ImageSize, Intrinsics, ScaledCalibration,
};
pub use contour::{MmPolygon, pixels_to_mm, trace_outer_contour_px};
pub use grid_detect::{DetectedLine, GridDetectionDebug, GridDetectionResult, detect_grid};
pub use homography::{Homography, RectifiedBounds, compute_rectified_bounds};
pub use image_io::{ExifOrientation, LoadedImage, apply_orientation, load_image_from_bytes};
pub use metadata::{
    HomographyMatrix, ImageMetadata, OutlineMetadata, ReferenceBoardMetadata, ScaleMetadata,
    TransformMetadata,
};
pub use pipeline::{
    DetectBoardOutcome, OutlineBundle, OutlineOptions, RectifyOptions, RectifyOutcome,
    RectifyProgressEvent, RectifyProgressStatus, RectifyProgressStep, detect_board_in_memory,
    rectify_in_memory, rectify_in_memory_with_progress,
};

#[cfg(not(target_family = "wasm"))]
pub use image_io::load_image;

#[cfg(not(target_family = "wasm"))]
pub use pipeline::{
    BoardDetectionRequest, BoardDetectionRunResult, OutlineOutput, RectifyRequest,
    RectifyRunResult, run_board_detection_checkpoint, run_rectify,
};

pub use quality::{QualityMetrics, QualityReport, QualityStatus, assess_quality};
pub use segment::{SegmentationOptions, SegmentationResult, SegmentationStats, segment_piece};
pub use simplify::{rdp, rdp_closed, simplify_polygon};
pub use vector_export::{render_dxf, render_svg};

#[cfg(not(target_family = "wasm"))]
pub use vector_export::{write_dxf, write_outline_json, write_svg};
