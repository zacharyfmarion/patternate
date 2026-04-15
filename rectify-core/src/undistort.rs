use image::{Rgb, RgbImage};

use crate::calibration::{BrownConradyDistortion, Intrinsics};

pub fn undistort_image(
    input: &RgbImage,
    intrinsics: &Intrinsics,
    distortion: &BrownConradyDistortion,
) -> RgbImage {
    let mut output = RgbImage::new(input.width(), input.height());

    for y in 0..output.height() {
        for x in 0..output.width() {
            let (src_x, src_y) =
                map_ideal_pixel_to_distorted(x as f64, y as f64, intrinsics, distortion);
            let pixel = bilinear_sample_rgb(input, src_x, src_y);
            output.put_pixel(x, y, pixel);
        }
    }

    output
}

pub fn map_ideal_pixel_to_distorted(
    u: f64,
    v: f64,
    intrinsics: &Intrinsics,
    distortion: &BrownConradyDistortion,
) -> (f64, f64) {
    let x = (u - intrinsics.cx) / intrinsics.fx;
    let y = (v - intrinsics.cy) / intrinsics.fy;
    let (x_distorted, y_distorted) = distort_normalized_point(x, y, distortion);

    (
        x_distorted * intrinsics.fx + intrinsics.cx,
        y_distorted * intrinsics.fy + intrinsics.cy,
    )
}

pub fn distort_normalized_point(
    x: f64,
    y: f64,
    distortion: &BrownConradyDistortion,
) -> (f64, f64) {
    let r2 = x * x + y * y;
    let radial = 1.0
        + distortion.k1 * r2
        + distortion.k2 * r2 * r2
        + distortion.k3 * r2 * r2 * r2;

    let x_tangential = 2.0 * distortion.p1 * x * y + distortion.p2 * (r2 + 2.0 * x * x);
    let y_tangential = distortion.p1 * (r2 + 2.0 * y * y) + 2.0 * distortion.p2 * x * y;

    (x * radial + x_tangential, y * radial + y_tangential)
}

fn bilinear_sample_rgb(image: &RgbImage, x: f64, y: f64) -> Rgb<u8> {
    let max_x = image.width().saturating_sub(1) as f64;
    let max_y = image.height().saturating_sub(1) as f64;
    let x = x.clamp(0.0, max_x);
    let y = y.clamp(0.0, max_y);

    let x0 = x.floor() as u32;
    let y0 = y.floor() as u32;
    let x1 = (x0 + 1).min(image.width().saturating_sub(1));
    let y1 = (y0 + 1).min(image.height().saturating_sub(1));

    let wx = x - x0 as f64;
    let wy = y - y0 as f64;

    let p00 = image.get_pixel(x0, y0).0;
    let p10 = image.get_pixel(x1, y0).0;
    let p01 = image.get_pixel(x0, y1).0;
    let p11 = image.get_pixel(x1, y1).0;

    let mut out = [0_u8; 3];
    for channel in 0..3 {
        let top = p00[channel] as f64 * (1.0 - wx) + p10[channel] as f64 * wx;
        let bottom = p01[channel] as f64 * (1.0 - wx) + p11[channel] as f64 * wx;
        let value = top * (1.0 - wy) + bottom * wy;
        out[channel] = value.round().clamp(0.0, 255.0) as u8;
    }

    Rgb(out)
}

#[cfg(test)]
mod tests {
    use image::{ImageBuffer, Rgb};

    use super::*;
    use crate::calibration::{BrownConradyDistortion, DistortionModel};

    fn intrinsics() -> Intrinsics {
        Intrinsics {
            fx: 100.0,
            fy: 100.0,
            cx: 1.5,
            cy: 1.5,
        }
    }

    fn identity_distortion() -> BrownConradyDistortion {
        BrownConradyDistortion {
            model: DistortionModel::BrownConrady,
            k1: 0.0,
            k2: 0.0,
            k3: 0.0,
            p1: 0.0,
            p2: 0.0,
        }
    }

    #[test]
    fn identity_distortion_preserves_pixels() {
        let image = ImageBuffer::from_fn(4, 4, |x, y| {
            Rgb([(x * 10) as u8, (y * 20) as u8, (x + y) as u8])
        });

        let undistorted = undistort_image(&image, &intrinsics(), &identity_distortion());
        assert_eq!(undistorted, image);
    }

    #[test]
    fn center_pixel_maps_to_itself() {
        let distortion = BrownConradyDistortion {
            model: DistortionModel::BrownConrady,
            k1: -0.15,
            k2: 0.02,
            k3: 0.0,
            p1: 0.001,
            p2: -0.001,
        };

        let (u, v) = map_ideal_pixel_to_distorted(1.5, 1.5, &intrinsics(), &distortion);
        assert!((u - 1.5).abs() < 1e-9);
        assert!((v - 1.5).abs() < 1e-9);
    }
}

