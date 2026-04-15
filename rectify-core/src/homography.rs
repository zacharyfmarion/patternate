use anyhow::{Result, bail};

/// A 3×3 homography matrix stored in row-major order.
///
/// Maps homogeneous 2-D points: `p' = H * p` where `p = [x, y, 1]^T`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Homography([[f64; 3]; 3]);

impl Homography {
    /// Construct from a row-major 3×3 array (matches OpenCV / JSON layout).
    pub fn from_rows(rows: [[f64; 3]; 3]) -> Self {
        Self(rows)
    }

    pub fn rows(&self) -> &[[f64; 3]; 3] {
        &self.0
    }

    /// Apply the homography to a single point, returning `(x', y')`.
    pub fn transform_point(&self, x: f64, y: f64) -> (f64, f64) {
        let h = &self.0;
        let w = h[2][0] * x + h[2][1] * y + h[2][2];
        let x2 = (h[0][0] * x + h[0][1] * y + h[0][2]) / w;
        let y2 = (h[1][0] * x + h[1][1] * y + h[1][2]) / w;
        (x2, y2)
    }

    /// Compute the 3×3 matrix inverse.
    ///
    /// Returns an error if the matrix is singular (determinant near zero).
    pub fn inverse(&self) -> Result<Homography> {
        let m = &self.0;

        let a = m[0][0];
        let b = m[0][1];
        let c = m[0][2];
        let d = m[1][0];
        let e = m[1][1];
        let f = m[1][2];
        let g = m[2][0];
        let h = m[2][1];
        let i = m[2][2];

        let det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);

        if det.abs() < 1e-12 {
            bail!("homography matrix is singular (det = {det:.3e})");
        }

        let inv_det = 1.0 / det;

        Ok(Homography([
            [
                (e * i - f * h) * inv_det,
                (c * h - b * i) * inv_det,
                (b * f - c * e) * inv_det,
            ],
            [
                (f * g - d * i) * inv_det,
                (a * i - c * g) * inv_det,
                (c * d - a * f) * inv_det,
            ],
            [
                (d * h - e * g) * inv_det,
                (b * g - a * h) * inv_det,
                (a * e - b * d) * inv_det,
            ],
        ]))
    }
}

/// Axis-aligned bounding box in board-mm space after mapping all four image
/// corners through `H_image_to_board`.
#[derive(Debug, Clone, Copy)]
pub struct RectifiedBounds {
    pub min_x_mm: f64,
    pub min_y_mm: f64,
    pub max_x_mm: f64,
    pub max_y_mm: f64,
}

impl RectifiedBounds {
    pub fn width_mm(&self) -> f64 {
        self.max_x_mm - self.min_x_mm
    }

    pub fn height_mm(&self) -> f64 {
        self.max_y_mm - self.min_y_mm
    }

    /// Pixel dimensions at the requested scale.
    pub fn output_size_px(&self, pixels_per_mm: f64) -> (u32, u32) {
        let w = (self.width_mm() * pixels_per_mm).round() as u32;
        let h = (self.height_mm() * pixels_per_mm).round() as u32;
        (w.max(1), h.max(1))
    }
}

/// Project all four corners of an image through `h_image_to_board` and return
/// the axis-aligned bounding box of the results in board-mm space.
pub fn compute_rectified_bounds(
    image_width_px: u32,
    image_height_px: u32,
    h_image_to_board: &Homography,
) -> RectifiedBounds {
    let w = image_width_px as f64;
    let h = image_height_px as f64;

    let corners = [(0.0, 0.0), (w, 0.0), (w, h), (0.0, h)];

    let mut min_x = f64::MAX;
    let mut min_y = f64::MAX;
    let mut max_x = f64::MIN;
    let mut max_y = f64::MIN;

    for (cx, cy) in corners {
        let (bx, by) = h_image_to_board.transform_point(cx, cy);
        if bx < min_x { min_x = bx; }
        if bx > max_x { max_x = bx; }
        if by < min_y { min_y = by; }
        if by > max_y { max_y = by; }
    }

    RectifiedBounds { min_x_mm: min_x, min_y_mm: min_y, max_x_mm: max_x, max_y_mm: max_y }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity() -> Homography {
        Homography::from_rows([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]])
    }

    #[test]
    fn identity_transform_preserves_point() {
        let h = identity();
        let (x, y) = h.transform_point(3.0, 7.0);
        assert!((x - 3.0).abs() < 1e-10);
        assert!((y - 7.0).abs() < 1e-10);
    }

    #[test]
    fn identity_inverse_is_identity() {
        let h = identity();
        let inv = h.inverse().unwrap();
        let (x, y) = inv.transform_point(5.0, 9.0);
        assert!((x - 5.0).abs() < 1e-9);
        assert!((y - 9.0).abs() < 1e-9);
    }

    #[test]
    fn inverse_round_trips() {
        // Scale + translate homography.
        let h = Homography::from_rows([
            [2.0, 0.0, 10.0],
            [0.0, 3.0, 20.0],
            [0.0, 0.0, 1.0],
        ]);
        let inv = h.inverse().unwrap();
        let (x2, y2) = h.transform_point(5.0, 4.0);
        let (x3, y3) = inv.transform_point(x2, y2);
        assert!((x3 - 5.0).abs() < 1e-9, "x round-trip: {x3}");
        assert!((y3 - 4.0).abs() < 1e-9, "y round-trip: {y3}");
    }

    #[test]
    fn singular_matrix_returns_error() {
        let h = Homography::from_rows([
            [1.0, 2.0, 3.0],
            [2.0, 4.0, 6.0], // row 2 = 2 × row 1 → singular
            [0.0, 0.0, 1.0],
        ]);
        assert!(h.inverse().is_err());
    }

    #[test]
    fn output_size_rounds_correctly() {
        let bounds = RectifiedBounds {
            min_x_mm: 0.0,
            min_y_mm: 0.0,
            max_x_mm: 165.0,
            max_y_mm: 120.0,
        };
        let (w, h) = bounds.output_size_px(10.0);
        assert_eq!(w, 1650);
        assert_eq!(h, 1200);
    }

    #[test]
    fn bounds_from_identity_homography() {
        let h = identity();
        let bounds = compute_rectified_bounds(100, 80, &h);
        assert!((bounds.width_mm() - 100.0).abs() < 1e-9);
        assert!((bounds.height_mm() - 80.0).abs() < 1e-9);
    }
}
