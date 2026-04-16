//! Contour extraction and pixel-to-mm conversion.
//!
//! Uses the Suzuki-Abe outer-contour trace from `imageproc::contours` to
//! obtain an ordered, closed polygon of pixel coordinates for the
//! segmented piece, then converts them to millimetres using the
//! rectified-image bounds and pixel scale.

use anyhow::{Result, anyhow};
use image::GrayImage;
use imageproc::contours::{BorderType, find_contours};

use crate::homography::RectifiedBounds;

/// A polygon in board-mm coordinates. Points are in order around the
/// outline and the last point is **not** equal to the first (callers
/// should close the path when rendering).
#[derive(Debug, Clone)]
pub struct MmPolygon {
    pub points: Vec<[f64; 2]>,
}

impl MmPolygon {
    pub fn len(&self) -> usize {
        self.points.len()
    }
    pub fn is_empty(&self) -> bool {
        self.points.is_empty()
    }

    /// Signed area (shoelace). Positive if vertices wind
    /// counter-clockwise in a y-up coordinate system (which is the
    /// convention we use for DXF output). For an image-space polygon
    /// with y-down, positive signed area means clockwise when viewed
    /// in the usual image orientation.
    pub fn signed_area(&self) -> f64 {
        if self.points.len() < 3 {
            return 0.0;
        }
        let mut s = 0.0;
        for i in 0..self.points.len() {
            let [x1, y1] = self.points[i];
            let [x2, y2] = self.points[(i + 1) % self.points.len()];
            s += x1 * y2 - x2 * y1;
        }
        s * 0.5
    }

    pub fn area_abs(&self) -> f64 {
        self.signed_area().abs()
    }

    pub fn perimeter(&self) -> f64 {
        if self.points.len() < 2 {
            return 0.0;
        }
        let mut p = 0.0;
        for i in 0..self.points.len() {
            let [x1, y1] = self.points[i];
            let [x2, y2] = self.points[(i + 1) % self.points.len()];
            let dx = x2 - x1;
            let dy = y2 - y1;
            p += (dx * dx + dy * dy).sqrt();
        }
        p
    }

    pub fn bbox(&self) -> Option<[f64; 4]> {
        if self.points.is_empty() {
            return None;
        }
        let mut min_x = f64::INFINITY;
        let mut min_y = f64::INFINITY;
        let mut max_x = f64::NEG_INFINITY;
        let mut max_y = f64::NEG_INFINITY;
        for &[x, y] in &self.points {
            if x < min_x { min_x = x; }
            if y < min_y { min_y = y; }
            if x > max_x { max_x = x; }
            if y > max_y { max_y = y; }
        }
        Some([min_x, min_y, max_x, max_y])
    }
}

/// Trace the outer contour of the largest-foreground region in `mask` and
/// return the ordered pixel polygon.
///
/// `mask` is treated as binary: any pixel > 0 is foreground. A one-pixel
/// zero border is added internally so the trace never touches the image
/// edge (which avoids Suzuki-Abe edge artefacts).
pub fn trace_outer_contour_px(mask: &GrayImage) -> Result<Vec<[f64; 2]>> {
    if mask.width() < 3 || mask.height() < 3 {
        return Err(anyhow!(
            "mask is too small to trace ({}×{})",
            mask.width(),
            mask.height()
        ));
    }

    // Pad with a 1-pixel zero border.
    let pw = mask.width() + 2;
    let ph = mask.height() + 2;
    let mut padded = GrayImage::new(pw, ph);
    for y in 0..mask.height() {
        for x in 0..mask.width() {
            let v = mask.get_pixel(x, y).0[0];
            padded.put_pixel(x + 1, y + 1, image::Luma([v]));
        }
    }

    let contours = find_contours::<i32>(&padded);

    // Suzuki-Abe emits outer borders and hole borders. We want the outer
    // border with the largest point count — that's our piece. (Tiny
    // single-pixel contours on speckle are filtered out earlier by the
    // segmentation stage, but we defend against them here too.)
    let best = contours
        .iter()
        .filter(|c| c.border_type == BorderType::Outer)
        .max_by_key(|c| c.points.len())
        .ok_or_else(|| anyhow!("no outer contour found in mask"))?;

    if best.points.len() < 4 {
        return Err(anyhow!(
            "outer contour has only {} points — piece is degenerate",
            best.points.len()
        ));
    }

    let mut out = Vec::with_capacity(best.points.len());
    for p in &best.points {
        // Undo the 1-pixel pad; pixel centres are treated as integer coords.
        let x = (p.x as f64) - 1.0;
        let y = (p.y as f64) - 1.0;
        out.push([x, y]);
    }
    Ok(out)
}

/// Convert an ordered pixel polygon (from `trace_outer_contour_px`) into
/// millimetre coordinates using the rectified-image bounds and scale.
///
/// Pixel `(0,0)` represents the pixel at board-mm `(bounds.min_x_mm,
/// bounds.min_y_mm)`; a 0.5 half-pixel offset is added so the polygon is
/// aligned to pixel centres.
pub fn pixels_to_mm(
    pixel_points: &[[f64; 2]],
    bounds: &RectifiedBounds,
    pixels_per_mm: f64,
) -> MmPolygon {
    let inv = 1.0 / pixels_per_mm;
    let mut pts = Vec::with_capacity(pixel_points.len());
    for &[x, y] in pixel_points {
        let mm_x = bounds.min_x_mm + (x + 0.5) * inv;
        let mm_y = bounds.min_y_mm + (y + 0.5) * inv;
        pts.push([mm_x, mm_y]);
    }
    MmPolygon { points: pts }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use image::Luma;

    fn solid_rect_mask(w: u32, h: u32, x0: u32, y0: u32, x1: u32, y1: u32) -> GrayImage {
        let mut m = GrayImage::from_pixel(w, h, Luma([0u8]));
        for y in y0..y1 {
            for x in x0..x1 {
                m.put_pixel(x, y, Luma([255]));
            }
        }
        m
    }

    #[test]
    fn traces_a_rectangle() {
        let mask = solid_rect_mask(20, 20, 5, 5, 15, 15);
        let pts = trace_outer_contour_px(&mask).unwrap();
        // Rectangle perimeter at 10×10 with 1-pixel tracing → ~36 points.
        assert!(pts.len() >= 20 && pts.len() <= 50, "got {}", pts.len());

        // Verify corner presence (approximate).
        let has = |x: f64, y: f64| pts.iter().any(|p| (p[0] - x).abs() < 0.5 && (p[1] - y).abs() < 0.5);
        assert!(has(5.0, 5.0));
        assert!(has(14.0, 5.0));
        assert!(has(5.0, 14.0));
        assert!(has(14.0, 14.0));
    }

    #[test]
    fn pixels_to_mm_respects_bounds_and_scale() {
        let bounds = RectifiedBounds {
            min_x_mm: -10.0,
            min_y_mm: -5.0,
            max_x_mm: 90.0,
            max_y_mm: 45.0,
        };
        let pts = vec![[0.0, 0.0], [100.0, 50.0]];
        let mm = pixels_to_mm(&pts, &bounds, 10.0);
        assert!((mm.points[0][0] - (-9.95)).abs() < 1e-9);
        assert!((mm.points[0][1] - (-4.95)).abs() < 1e-9);
        assert!((mm.points[1][0] - 0.05).abs() < 1e-9);
        assert!((mm.points[1][1] - 0.05).abs() < 1e-9);
    }

    #[test]
    fn signed_area_of_square_is_positive_ccw() {
        let poly = MmPolygon {
            points: vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]],
        };
        assert!((poly.signed_area() - 100.0).abs() < 1e-9);
        assert!((poly.perimeter() - 40.0).abs() < 1e-9);
        let bbox = poly.bbox().unwrap();
        assert_eq!(bbox, [0.0, 0.0, 10.0, 10.0]);
    }
}
