use image::{GrayImage, Luma, Rgb, RgbImage};

use crate::homography::{Homography, RectifiedBounds};
use crate::undistort::bilinear_sample_rgb;

/// Warp `source` into a fronto-parallel rectified image.
///
/// For every output pixel `(out_x, out_y)`:
/// 1. Convert to board-mm coordinates:
///    `mm_x = bounds.min_x + out_x / pixels_per_mm`
///    `mm_y = bounds.min_y + out_y / pixels_per_mm`
/// 2. Map through `h_board_to_image` to get the source pixel.
/// 3. Bilinear-sample the source.
///
/// Out-of-bounds source samples are filled with black.
pub fn warp_image(
    source: &RgbImage,
    h_board_to_image: &Homography,
    bounds: &RectifiedBounds,
    pixels_per_mm: f64,
) -> RgbImage {
    warp_image_with_validity(source, h_board_to_image, bounds, pixels_per_mm).0
}

/// Same as `warp_image`, but also returns a `GrayImage` mask marking
/// every output pixel that was sampled from inside `source`. Valid
/// pixels are `255`, out-of-bounds pixels are `0`. Useful for downstream
/// stages that need to ignore the black fill (e.g. segmentation).
pub fn warp_image_with_validity(
    source: &RgbImage,
    h_board_to_image: &Homography,
    bounds: &RectifiedBounds,
    pixels_per_mm: f64,
) -> (RgbImage, GrayImage) {
    let (out_w, out_h) = bounds.output_size_px(pixels_per_mm);
    let mut output = RgbImage::new(out_w, out_h);
    let mut validity = GrayImage::new(out_w, out_h);

    let src_w = source.width() as f64;
    let src_h = source.height() as f64;

    for out_y in 0..out_h {
        for out_x in 0..out_w {
            let mm_x = bounds.min_x_mm + out_x as f64 / pixels_per_mm;
            let mm_y = bounds.min_y_mm + out_y as f64 / pixels_per_mm;

            let (src_x, src_y) = h_board_to_image.transform_point(mm_x, mm_y);

            let in_bounds = src_x >= 0.0 && src_x < src_w && src_y >= 0.0 && src_y < src_h;
            let pixel = if in_bounds {
                bilinear_sample_rgb(source, src_x, src_y)
            } else {
                Rgb([0u8, 0, 0])
            };

            output.put_pixel(out_x, out_y, pixel);
            validity.put_pixel(out_x, out_y, Luma([if in_bounds { 255 } else { 0 }]));
        }
    }

    (output, validity)
}

#[cfg(test)]
mod tests {
    use image::ImageBuffer;

    use super::*;
    use crate::homography::RectifiedBounds;

    fn identity_homography() -> Homography {
        Homography::from_rows([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]])
    }

    /// A small solid-color image — every pixel is the same, so any sampling
    /// strategy should reproduce it after a near-identity warp.
    fn solid_image(w: u32, h: u32, color: [u8; 3]) -> RgbImage {
        ImageBuffer::from_pixel(w, h, Rgb(color))
    }

    #[test]
    fn identity_warp_preserves_solid_color() {
        let src = solid_image(100, 80, [200, 100, 50]);
        let bounds = RectifiedBounds {
            min_x_mm: 0.0,
            min_y_mm: 0.0,
            max_x_mm: 100.0,
            max_y_mm: 80.0,
        };
        let h = identity_homography();
        let out = warp_image(&src, &h, &bounds, 1.0);
        assert_eq!(out.width(), 100);
        assert_eq!(out.height(), 80);
        // Interior pixels should match the source color.
        assert_eq!(out.get_pixel(50, 40).0, [200, 100, 50]);
    }

    #[test]
    fn out_of_bounds_source_fills_black() {
        // h maps output pixels to far-off-screen source coordinates.
        let shift = Homography::from_rows([
            [1.0, 0.0, 9999.0],
            [0.0, 1.0, 9999.0],
            [0.0, 0.0, 1.0],
        ]);
        let src = solid_image(10, 10, [255, 255, 255]);
        let bounds = RectifiedBounds {
            min_x_mm: 0.0,
            min_y_mm: 0.0,
            max_x_mm: 10.0,
            max_y_mm: 10.0,
        };
        let out = warp_image(&src, &shift, &bounds, 1.0);
        assert_eq!(out.get_pixel(5, 5).0, [0, 0, 0]);
    }

    #[test]
    fn uniform_scale_produces_correct_output_size() {
        // H scales board-mm by 2 (i.e. 1 mm → pixel 2 in source).
        let scale2 = Homography::from_rows([
            [2.0, 0.0, 0.0],
            [0.0, 2.0, 0.0],
            [0.0, 0.0, 1.0],
        ]);
        let src = solid_image(200, 160, [128, 64, 32]);
        let bounds = RectifiedBounds {
            min_x_mm: 0.0,
            min_y_mm: 0.0,
            max_x_mm: 100.0,
            max_y_mm: 80.0,
        };
        let out = warp_image(&src, &scale2, &bounds, 1.0);
        assert_eq!(out.width(), 100);
        assert_eq!(out.height(), 80);
        // All source pixels are the same color so any in-bounds sample works.
        assert_eq!(out.get_pixel(50, 40).0, [128, 64, 32]);
    }
}
