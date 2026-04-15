//! Stage B: capture quality validation.
//!
//! Computes blur, exposure, board coverage, and homography confidence scores,
//! then classifies the capture as `ok`, `warning`, or `fail`.
//!
//! Hard-reject thresholds trigger an `Err` from `assess_quality`; soft
//! warnings are collected in `QualityReport::warnings`.

use image::{GrayImage, RgbImage};
use serde::Serialize;

use crate::board_detect::BoardDetectionSummary;

// ---------------------------------------------------------------------------
// Hard-reject thresholds
// ---------------------------------------------------------------------------

/// Laplacian variance below this → blur hard reject.
const BLUR_FAIL_THRESHOLD: f64 = 0.002;
/// Fraction of pixels in deepest shadow below this → ok (above → warn).
const EXPOSURE_SHADOW_WARN: f64 = 0.05;
/// Fraction of pixels blown out above this → warn.
const EXPOSURE_HIGHLIGHT_WARN: f64 = 0.05;
/// Minimum board coverage fraction of image area to avoid warning.
const BOARD_COVERAGE_WARN: f64 = 0.02;
/// Minimum board coverage to attempt rectification (hard reject).
const BOARD_COVERAGE_FAIL: f64 = 0.005;
/// Minimum ChArUco corner count for a stable homography.
const MIN_CHARUCO_CORNERS: usize = 6;
/// Board RMSE above this (px at working res) → hard reject.
const REPROJECTION_RMSE_FAIL: f64 = 5.0;
/// Board RMSE above this → soft warning.
const REPROJECTION_RMSE_WARN: f64 = 1.5;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum QualityStatus {
    Ok,
    Warning,
    Fail,
}

#[derive(Debug, Clone, Serialize)]
pub struct QualityMetrics {
    /// Normalised blur score in [0, 1]; higher = sharper.
    pub blur_score: f64,
    /// Normalised exposure score in [0, 1]; higher = better exposure.
    pub exposure_score: f64,
    /// Board coverage: board outline area / image area.
    pub board_coverage: f64,
    /// Detection confidence from the board detector.
    pub board_confidence: f64,
    /// Board reprojection RMSE in pixels at working resolution.
    pub board_reprojection_rmse_px: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct QualityReport {
    pub schema_version: u32,
    pub status: QualityStatus,
    pub warnings: Vec<String>,
    pub metrics: QualityMetrics,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Assess image quality and board detection quality.
///
/// Returns `Ok(QualityReport)` even when warnings are present.
/// Returns `Err` for hard rejects — the caller should abort rectification.
pub fn assess_quality(
    image: &RgbImage,
    detection: &BoardDetectionSummary,
) -> Result<QualityReport, QualityReport> {
    let gray = to_gray(image);
    let blur_score = compute_blur_score(&gray);
    let exposure_score = compute_exposure_score(&gray);
    let board_coverage = compute_board_coverage(image, detection);
    let board_confidence = detection.confidence as f64;
    let rmse = detection.board_reprojection_rmse_px.unwrap_or(0.0) as f64;

    let metrics = QualityMetrics {
        blur_score,
        exposure_score,
        board_coverage,
        board_confidence,
        board_reprojection_rmse_px: rmse,
    };

    let mut warnings: Vec<String> = Vec::new();
    let mut hard_fail: Option<String> = None;

    // --- Hard rejects ---
    if blur_score < BLUR_FAIL_THRESHOLD {
        hard_fail = Some(format!(
            "image too blurry (blur_score={blur_score:.4}, threshold={BLUR_FAIL_THRESHOLD})"
        ));
    }
    if detection.charuco_corner_count < MIN_CHARUCO_CORNERS {
        hard_fail = Some(format!(
            "too few ChArUco corners detected ({} < {})",
            detection.charuco_corner_count, MIN_CHARUCO_CORNERS
        ));
    }
    if board_coverage < BOARD_COVERAGE_FAIL {
        hard_fail = Some(format!(
            "board coverage too small ({board_coverage:.4} < {BOARD_COVERAGE_FAIL})"
        ));
    }
    if rmse > REPROJECTION_RMSE_FAIL {
        hard_fail = Some(format!(
            "board reprojection RMSE too high ({rmse:.2} px > {REPROJECTION_RMSE_FAIL} px)"
        ));
    }

    if let Some(reason) = hard_fail {
        let report = QualityReport {
            schema_version: 1,
            status: QualityStatus::Fail,
            warnings: vec![reason],
            metrics,
        };
        return Err(report);
    }

    // --- Soft warnings ---
    if board_coverage < BOARD_COVERAGE_WARN {
        warnings.push(format!(
            "board coverage is small ({board_coverage:.4}); geometry may be less stable"
        ));
    }
    if rmse > REPROJECTION_RMSE_WARN {
        warnings.push(format!(
            "board reprojection RMSE is elevated ({rmse:.2} px); check board flatness"
        ));
    }
    let shadow_frac = shadow_fraction(&gray);
    if shadow_frac > EXPOSURE_SHADOW_WARN {
        warnings.push(format!(
            "heavy shadows detected ({:.1}% of pixels near black)", shadow_frac * 100.0
        ));
    }
    let highlight_frac = highlight_fraction(&gray);
    if highlight_frac > EXPOSURE_HIGHLIGHT_WARN {
        warnings.push(format!(
            "highlight clipping detected ({:.1}% of pixels near white)", highlight_frac * 100.0
        ));
    }

    let status = if warnings.is_empty() {
        QualityStatus::Ok
    } else {
        QualityStatus::Warning
    };

    Ok(QualityReport { schema_version: 1, status, warnings, metrics })
}

// ---------------------------------------------------------------------------
// Metric implementations
// ---------------------------------------------------------------------------

/// Blur score via variance of Laplacian, normalised to [0, 1] with a soft cap.
///
/// A score of 1 means very sharp; near 0 means very blurry.
/// The normalisation constant is tuned so typical sharp phone photos score > 0.5.
fn compute_blur_score(gray: &GrayImage) -> f64 {
    let var = laplacian_variance(gray);
    // Soft normalisation: score = var / (var + k).  At k=2000, var=2000 → 0.5.
    let k = 2000.0_f64;
    var / (var + k)
}

/// Variance of a simple 3×3 Laplacian kernel applied to the image.
fn laplacian_variance(gray: &GrayImage) -> f64 {
    let w = gray.width() as usize;
    let h = gray.height() as usize;
    if w < 3 || h < 3 {
        return 0.0;
    }

    let pixels: Vec<f64> = gray.pixels().map(|p| p.0[0] as f64).collect();

    let mut sum = 0.0_f64;
    let mut sum_sq = 0.0_f64;
    let mut count = 0_usize;

    for y in 1..h - 1 {
        for x in 1..w - 1 {
            let idx = |dy: isize, dx: isize| -> f64 {
                pixels[((y as isize + dy) as usize) * w + (x as isize + dx) as usize]
            };
            // 3×3 Laplacian: centre×4 − 4 neighbours
            let lap = 4.0 * idx(0, 0)
                - idx(-1, 0)
                - idx(1, 0)
                - idx(0, -1)
                - idx(0, 1);
            sum += lap;
            sum_sq += lap * lap;
            count += 1;
        }
    }

    if count == 0 {
        return 0.0;
    }
    let mean = sum / count as f64;
    sum_sq / count as f64 - mean * mean
}

/// Exposure score in [0, 1]: penalises shadow and highlight clipping.
fn compute_exposure_score(gray: &GrayImage) -> f64 {
    let shadow = shadow_fraction(gray);
    let highlight = highlight_fraction(gray);
    // Each fraction above its threshold costs linearly up to 0.5 each.
    let s_penalty = (shadow / EXPOSURE_SHADOW_WARN).min(1.0) * 0.5;
    let h_penalty = (highlight / EXPOSURE_HIGHLIGHT_WARN).min(1.0) * 0.5;
    (1.0 - s_penalty - h_penalty).max(0.0)
}

fn shadow_fraction(gray: &GrayImage) -> f64 {
    let total = gray.pixels().count();
    if total == 0 {
        return 0.0;
    }
    let dark = gray.pixels().filter(|p| p.0[0] < 20).count();
    dark as f64 / total as f64
}

fn highlight_fraction(gray: &GrayImage) -> f64 {
    let total = gray.pixels().count();
    if total == 0 {
        return 0.0;
    }
    let bright = gray.pixels().filter(|p| p.0[0] > 235).count();
    bright as f64 / total as f64
}

/// Board coverage: shoelace area of the detected board outline / image area.
fn compute_board_coverage(image: &RgbImage, detection: &BoardDetectionSummary) -> f64 {
    let image_area = (image.width() * image.height()) as f64;
    if image_area == 0.0 {
        return 0.0;
    }
    let Some(ref outline) = detection.board_outline_image else {
        return 0.0;
    };
    if outline.len() < 3 {
        return 0.0;
    }
    let area = shoelace_area(outline);
    (area / image_area).clamp(0.0, 1.0)
}

/// Shoelace formula for the signed area of a polygon (returns absolute value).
fn shoelace_area(pts: &[[f32; 2]]) -> f64 {
    let n = pts.len();
    let mut area = 0.0_f64;
    for i in 0..n {
        let j = (i + 1) % n;
        area += pts[i][0] as f64 * pts[j][1] as f64;
        area -= pts[j][0] as f64 * pts[i][1] as f64;
    }
    area.abs() / 2.0
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use image::ImageBuffer;

    fn sharp_image(w: u32, h: u32) -> RgbImage {
        // High-contrast mid-tone checkerboard — sharp but no clipping.
        // Values 60/200 keep both shadow and highlight fractions near zero.
        ImageBuffer::from_fn(w, h, |x, y| {
            if (x + y) % 2 == 0 {
                image::Rgb([200u8, 200, 200])
            } else {
                image::Rgb([60u8, 60, 60])
            }
        })
    }

    fn blurry_image(w: u32, h: u32) -> RgbImage {
        // Solid grey — zero Laplacian variance.
        ImageBuffer::from_pixel(w, h, image::Rgb([128u8, 128, 128]))
    }

    fn minimal_detection(confidence: f32, corners: usize, rmse: f32) -> BoardDetectionSummary {
        BoardDetectionSummary {
            board_id: "refboard_v1".to_string(),
            marker_count: 44,
            charuco_corner_count: corners,
            confidence,
            board_outline_image: Some(vec![
                [100.0, 100.0],
                [500.0, 100.0],
                [500.0, 400.0],
                [100.0, 400.0],
            ]),
            board_reprojection_rmse_px: Some(rmse),
        }
    }

    #[test]
    fn sharp_image_has_high_blur_score() {
        let img = sharp_image(64, 64);
        let gray = to_gray(&img);
        let score = compute_blur_score(&gray);
        assert!(score > 0.5, "expected sharp score > 0.5, got {score}");
    }

    #[test]
    fn blurry_image_has_low_blur_score() {
        let img = blurry_image(64, 64);
        let gray = to_gray(&img);
        let score = compute_blur_score(&gray);
        assert!(score < BLUR_FAIL_THRESHOLD * 2.0, "expected near-zero blur score, got {score}");
    }

    #[test]
    fn blurry_image_fails_quality() {
        let img = blurry_image(100, 100);
        let det = minimal_detection(1.0, 20, 0.2);
        let result = assess_quality(&img, &det);
        assert!(result.is_err(), "expected hard reject for blurry image");
        assert_eq!(result.unwrap_err().status, QualityStatus::Fail);
    }

    #[test]
    fn sharp_good_detection_passes() {
        let img = sharp_image(200, 200);
        let det = minimal_detection(1.0, 20, 0.3);
        let report = assess_quality(&img, &det).expect("should pass quality");
        assert_eq!(report.status, QualityStatus::Ok);
        assert!(report.warnings.is_empty());
    }

    #[test]
    fn too_few_corners_hard_rejects() {
        let img = sharp_image(100, 100);
        let det = minimal_detection(1.0, 3, 0.2); // below MIN_CHARUCO_CORNERS
        let result = assess_quality(&img, &det);
        assert!(result.is_err());
        let rep = result.unwrap_err();
        assert_eq!(rep.status, QualityStatus::Fail);
        assert!(rep.warnings[0].contains("ChArUco"));
    }

    #[test]
    fn high_rmse_hard_rejects() {
        let img = sharp_image(100, 100);
        let det = minimal_detection(1.0, 20, REPROJECTION_RMSE_FAIL as f32 + 1.0);
        let result = assess_quality(&img, &det);
        assert!(result.is_err());
        assert!(result.unwrap_err().warnings[0].contains("RMSE"));
    }

    #[test]
    fn elevated_rmse_gives_warning_not_fail() {
        let img = sharp_image(200, 200);
        let det = minimal_detection(1.0, 20, REPROJECTION_RMSE_WARN as f32 + 0.5);
        let report = assess_quality(&img, &det).expect("should not hard-fail");
        assert_eq!(report.status, QualityStatus::Warning);
        assert!(report.warnings.iter().any(|w| w.contains("RMSE")));
    }

    #[test]
    fn shoelace_area_of_unit_square() {
        let pts = [[0.0_f32, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];
        let area = shoelace_area(&pts);
        assert!((area - 1.0).abs() < 1e-6);
    }

    #[test]
    fn metrics_are_serializable() {
        let img = sharp_image(64, 64);
        let det = minimal_detection(0.9, 20, 0.5);
        let report = assess_quality(&img, &det).unwrap();
        let json = serde_json::to_string(&report).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["schema_version"], 1);
        assert!(parsed["metrics"]["blur_score"].as_f64().unwrap() > 0.0);
    }
}
