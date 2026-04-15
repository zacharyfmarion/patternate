use std::f32::consts::{FRAC_PI_2, PI};

use image::{GrayImage, Rgb, RgbImage, imageops};
use imageproc::drawing::draw_line_segment_mut;
use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize)]
pub struct DetectedLine {
    pub normal_angle_rad: f32,
    pub rho_px: f32,
    pub support: f32,
}

#[derive(Debug, Serialize)]
pub struct GridDetectionDebug {
    pub working_width_px: u32,
    pub working_height_px: u32,
    pub edge_threshold: f32,
    pub edge_point_count: usize,
    pub family_a_angle_rad: f32,
    pub family_b_angle_rad: f32,
    pub family_a_lines: Vec<DetectedLine>,
    pub family_b_lines: Vec<DetectedLine>,
    pub confidence: f32,
}

#[derive(Debug)]
pub struct GridDetectionResult {
    pub debug: GridDetectionDebug,
    pub overlay: RgbImage,
}

#[derive(Clone, Copy)]
struct EdgePoint {
    x: f32,
    y: f32,
    magnitude: f32,
    normal_angle_rad: f32,
}

pub fn detect_grid(image: &RgbImage) -> GridDetectionResult {
    let (working, scale_to_working) = resize_for_detection(image, 1600);
    let grayscale = imageops::grayscale(&working);
    let edges = sobel_edges(&grayscale);

    let magnitudes: Vec<f32> = edges.iter().map(|edge| edge.magnitude).collect();
    let threshold = percentile(&magnitudes, 0.92).max(8.0);
    let edge_points: Vec<EdgePoint> = edges
        .into_iter()
        .filter(|edge| edge.magnitude >= threshold)
        .collect();

    let orientation_histogram = build_orientation_histogram(&edge_points, 180);
    let family_a_angle = peak_angle(&orientation_histogram);
    let family_b_angle = orthogonal_peak_angle(&orientation_histogram, family_a_angle);

    let family_a_lines = detect_line_family(&edge_points, family_a_angle, working.width(), working.height());
    let family_b_lines = detect_line_family(&edge_points, family_b_angle, working.width(), working.height());

    let overlay = draw_overlay(
        image,
        scale_to_working,
        &family_a_lines,
        &family_b_lines,
        [255, 96, 64],
        [64, 224, 255],
    );

    let edge_support = (edge_points.len() as f32 / (working.width() * working.height()) as f32).min(1.0);
    let line_balance = if family_a_lines.is_empty() || family_b_lines.is_empty() {
        0.0
    } else {
        (family_a_lines.len().min(family_b_lines.len()) as f32
            / family_a_lines.len().max(family_b_lines.len()) as f32)
            .min(1.0)
    };
    let confidence = (0.5 * edge_support + 0.25 * (family_a_lines.len().min(8) as f32 / 8.0)
        + 0.25 * (family_b_lines.len().min(8) as f32 / 8.0))
        * line_balance.max(0.5);

    GridDetectionResult {
        debug: GridDetectionDebug {
            working_width_px: working.width(),
            working_height_px: working.height(),
            edge_threshold: threshold,
            edge_point_count: edge_points.len(),
            family_a_angle_rad: family_a_angle,
            family_b_angle_rad: family_b_angle,
            family_a_lines,
            family_b_lines,
            confidence: confidence.min(1.0),
        },
        overlay,
    }
}

fn resize_for_detection(image: &RgbImage, max_dimension: u32) -> (RgbImage, f32) {
    let longest = image.width().max(image.height());
    if longest <= max_dimension {
        return (image.clone(), 1.0);
    }

    let scale = max_dimension as f32 / longest as f32;
    let resized = imageops::resize(
        image,
        ((image.width() as f32) * scale).round() as u32,
        ((image.height() as f32) * scale).round() as u32,
        imageops::FilterType::Triangle,
    );
    (resized, scale)
}

fn sobel_edges(image: &GrayImage) -> Vec<EdgePoint> {
    let mut edges = Vec::with_capacity((image.width() * image.height()) as usize);
    if image.width() < 3 || image.height() < 3 {
        return edges;
    }

    for y in 1..image.height() - 1 {
        for x in 1..image.width() - 1 {
            let sample = |xx: u32, yy: u32| image.get_pixel(xx, yy)[0] as f32;

            let gx = -sample(x - 1, y - 1)
                + sample(x + 1, y - 1)
                - 2.0 * sample(x - 1, y)
                + 2.0 * sample(x + 1, y)
                - sample(x - 1, y + 1)
                + sample(x + 1, y + 1);

            let gy = sample(x - 1, y - 1)
                + 2.0 * sample(x, y - 1)
                + sample(x + 1, y - 1)
                - sample(x - 1, y + 1)
                - 2.0 * sample(x, y + 1)
                - sample(x + 1, y + 1);

            let magnitude = (gx * gx + gy * gy).sqrt();
            if magnitude > 0.0 {
                edges.push(EdgePoint {
                    x: x as f32,
                    y: y as f32,
                    magnitude,
                    normal_angle_rad: wrap_pi(gy.atan2(gx)),
                });
            }
        }
    }

    edges
}

fn build_orientation_histogram(edge_points: &[EdgePoint], bins: usize) -> Vec<f32> {
    let mut histogram = vec![0.0_f32; bins];
    for edge in edge_points {
        let bin = ((edge.normal_angle_rad / PI) * bins as f32).floor() as usize % bins;
        histogram[bin] += edge.magnitude;
    }

    smooth_circular_histogram(&histogram, 2)
}

fn peak_angle(histogram: &[f32]) -> f32 {
    let peak_bin = histogram
        .iter()
        .enumerate()
        .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap())
        .map(|(index, _)| index)
        .unwrap_or(0);
    ((peak_bin as f32 + 0.5) / histogram.len() as f32) * PI
}

fn orthogonal_peak_angle(histogram: &[f32], reference_angle: f32) -> f32 {
    let mut best_angle = (reference_angle + FRAC_PI_2) % PI;
    let mut best_score = -1.0_f32;
    let sigma = 20.0_f32.to_radians();

    for (index, value) in histogram.iter().enumerate() {
        let angle = ((index as f32 + 0.5) / histogram.len() as f32) * PI;
        let orth_error = (angular_distance(angle, reference_angle) - FRAC_PI_2).abs();
        let weight = (-0.5 * (orth_error / sigma).powi(2)).exp();
        let score = *value * weight;
        if score > best_score {
            best_score = score;
            best_angle = angle;
        }
    }

    best_angle
}

fn detect_line_family(
    edge_points: &[EdgePoint],
    family_angle: f32,
    width: u32,
    height: u32,
) -> Vec<DetectedLine> {
    let tolerance = 12.0_f32.to_radians();
    let diagonal = ((width * width + height * height) as f32).sqrt();
    let histogram_len = diagonal.ceil() as usize * 2 + 1;
    let mut histogram = vec![0.0_f32; histogram_len];

    for edge in edge_points {
        if angular_distance(edge.normal_angle_rad, family_angle) > tolerance {
            continue;
        }

        let rho = edge.x * family_angle.cos() + edge.y * family_angle.sin();
        let index = (rho + diagonal).round() as isize;
        if index >= 0 && (index as usize) < histogram_len {
            histogram[index as usize] += edge.magnitude;
        }
    }

    let smoothed = smooth_linear_histogram(&histogram, 4);
    let peak_threshold = smoothed
        .iter()
        .copied()
        .fold(0.0_f32, f32::max)
        * 0.25;

    let mut lines = Vec::new();
    let mut last_peak: Option<usize> = None;
    for index in 1..smoothed.len().saturating_sub(1) {
        let value = smoothed[index];
        if value < peak_threshold || value < smoothed[index - 1] || value < smoothed[index + 1] {
            continue;
        }

        if let Some(prev) = last_peak {
            if index.saturating_sub(prev) < 8 {
                if value > smoothed[prev] {
                    lines.pop();
                    last_peak = Some(index);
                } else {
                    continue;
                }
            } else {
                last_peak = Some(index);
            }
        } else {
            last_peak = Some(index);
        }

        lines.push(DetectedLine {
            normal_angle_rad: family_angle,
            rho_px: index as f32 - diagonal,
            support: value,
        });
    }

    lines
}

fn draw_overlay(
    image: &RgbImage,
    scale_to_working: f32,
    family_a_lines: &[DetectedLine],
    family_b_lines: &[DetectedLine],
    family_a_color: [u8; 3],
    family_b_color: [u8; 3],
) -> RgbImage {
    let mut overlay = image.clone();

    for pixel in overlay.pixels_mut() {
        pixel.0 = [
            ((pixel[0] as f32) * 0.55) as u8,
            ((pixel[1] as f32) * 0.55) as u8,
            ((pixel[2] as f32) * 0.55) as u8,
        ];
    }

    for line in family_a_lines {
        draw_polar_line_mut(&mut overlay, scale_line(line, scale_to_working), Rgb(family_a_color));
    }
    for line in family_b_lines {
        draw_polar_line_mut(&mut overlay, scale_line(line, scale_to_working), Rgb(family_b_color));
    }

    overlay
}

fn scale_line(line: &DetectedLine, scale_to_working: f32) -> DetectedLine {
    if scale_to_working == 0.0 || (scale_to_working - 1.0).abs() < f32::EPSILON {
        return *line;
    }

    DetectedLine {
        normal_angle_rad: line.normal_angle_rad,
        rho_px: line.rho_px / scale_to_working,
        support: line.support,
    }
}

fn draw_polar_line_mut(image: &mut RgbImage, line: DetectedLine, color: Rgb<u8>) {
    if let Some((start, end)) = clip_line_to_image(image.width(), image.height(), line) {
        draw_line_segment_mut(image, start, end, color);
    }
}

fn clip_line_to_image(
    width: u32,
    height: u32,
    line: DetectedLine,
) -> Option<((f32, f32), (f32, f32))> {
    let nx = line.normal_angle_rad.cos();
    let ny = line.normal_angle_rad.sin();
    let mut points = Vec::new();
    let w = width.saturating_sub(1) as f32;
    let h = height.saturating_sub(1) as f32;

    if ny.abs() > 1e-4 {
        let y_at_x0 = line.rho_px / ny;
        if (0.0..=h).contains(&y_at_x0) {
            points.push((0.0, y_at_x0));
        }
        let y_at_xw = (line.rho_px - nx * w) / ny;
        if (0.0..=h).contains(&y_at_xw) {
            points.push((w, y_at_xw));
        }
    }

    if nx.abs() > 1e-4 {
        let x_at_y0 = line.rho_px / nx;
        if (0.0..=w).contains(&x_at_y0) {
            points.push((x_at_y0, 0.0));
        }
        let x_at_yh = (line.rho_px - ny * h) / nx;
        if (0.0..=w).contains(&x_at_yh) {
            points.push((x_at_yh, h));
        }
    }

    points.dedup_by(|a, b| (a.0 - b.0).abs() < 1e-2 && (a.1 - b.1).abs() < 1e-2);
    if points.len() >= 2 {
        Some((points[0], points[1]))
    } else {
        None
    }
}

fn smooth_circular_histogram(values: &[f32], radius: usize) -> Vec<f32> {
    let len = values.len();
    let mut out = vec![0.0_f32; len];
    for (index, slot) in out.iter_mut().enumerate() {
        let mut total = 0.0;
        let mut count = 0.0;
        for offset in -(radius as isize)..=(radius as isize) {
            let wrapped = ((index as isize + offset).rem_euclid(len as isize)) as usize;
            total += values[wrapped];
            count += 1.0;
        }
        *slot = total / count;
    }
    out
}

fn smooth_linear_histogram(values: &[f32], radius: usize) -> Vec<f32> {
    let mut out = vec![0.0_f32; values.len()];
    for (index, slot) in out.iter_mut().enumerate() {
        let start = index.saturating_sub(radius);
        let end = (index + radius + 1).min(values.len());
        let window = &values[start..end];
        *slot = window.iter().sum::<f32>() / window.len() as f32;
    }
    out
}

fn percentile(values: &[f32], quantile: f32) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let index = ((sorted.len() - 1) as f32 * quantile.clamp(0.0, 1.0)).round() as usize;
    sorted[index]
}

fn angular_distance(a: f32, b: f32) -> f32 {
    let delta = (a - b).abs().rem_euclid(PI);
    delta.min(PI - delta)
}

fn wrap_pi(angle: f32) -> f32 {
    angle.rem_euclid(PI)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn synthetic_grid(width: u32, height: u32, spacing: u32) -> RgbImage {
        let mut image = RgbImage::from_pixel(width, height, Rgb([250, 250, 250]));
        for x in (spacing..width).step_by(spacing as usize) {
            for y in 0..height {
                image.put_pixel(x, y, Rgb([20, 20, 20]));
            }
        }
        for y in (spacing..height).step_by(spacing as usize) {
            for x in 0..width {
                image.put_pixel(x, y, Rgb([20, 20, 20]));
            }
        }
        image
    }

    #[test]
    fn detects_two_grid_families_in_synthetic_image() {
        let image = synthetic_grid(320, 240, 40);
        let result = detect_grid(&image);

        assert!(result.debug.family_a_lines.len() >= 4);
        assert!(result.debug.family_b_lines.len() >= 3);

        let orthogonality = angular_distance(
            result.debug.family_a_angle_rad,
            result.debug.family_b_angle_rad,
        );
        assert!((orthogonality - FRAC_PI_2).abs() < 0.25);
        assert!(result.debug.confidence > 0.2);
    }
}
