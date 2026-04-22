//! Pattern piece segmentation in the rectified image.
//!
//! Given a rectified RGB image (1 pixel = `1 / pixels_per_mm` millimetres)
//! and the known location of the reference board inside that image, this
//! module produces a binary mask of the largest foreground region that is
//! plausibly the pattern piece.
//!
//! The approach is deliberately classical-CV and deterministic so the
//! pipeline stays pure-Rust and WASM-compatible:
//!
//! 1. Build a board-exclusion mask in pixel coordinates, covering the
//!    printed board plus a configurable margin (default: the board spec's
//!    quiet zone).
//! 2. Estimate a robust background colour from the non-excluded pixels by
//!    taking the per-channel median. This works equally well for dark
//!    pieces on light mats and light pieces on dark mats.
//! 3. Compute a scalar "distance-from-background" image (Euclidean RGB
//!    distance, clipped to `u8`).
//! 4. Otsu-threshold the distance image (samples outside the board only)
//!    to pick a foreground cut.
//! 5. Morphological opening then closing at a radius specified in
//!    millimetres to remove mat-texture speckle and close small gaps.
//! 6. Connected-component labelling; choose the largest component that
//!    passes a minimum-area filter and doesn't hug the image border.

use anyhow::{Context, Result, anyhow};
use image::{GrayImage, Luma, RgbImage};
use imageproc::{
    contrast::{otsu_level, threshold, ThresholdType},
    definitions::Image,
    distance_transform::Norm,
    morphology::{close_mut, open_mut},
    region_labelling::{connected_components, Connectivity},
};

use crate::homography::RectifiedBounds;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Rectangular region in rectified-image pixel coordinates. Inclusive on
/// `min_*` and exclusive on `max_*`. Clamped to image bounds on construction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PixelRect {
    pub min_x: u32,
    pub min_y: u32,
    pub max_x: u32,
    pub max_y: u32,
}

impl PixelRect {
    pub fn width(&self) -> u32 {
        self.max_x.saturating_sub(self.min_x)
    }
    pub fn height(&self) -> u32 {
        self.max_y.saturating_sub(self.min_y)
    }
    pub fn is_empty(&self) -> bool {
        self.width() == 0 || self.height() == 0
    }
}

#[derive(Debug, Clone)]
pub struct SegmentationOptions {
    pub pixels_per_mm: f64,
    pub bounds: RectifiedBounds,
    pub board_width_mm: f64,
    pub board_height_mm: f64,
    /// Additional margin (mm) to exclude around the board rectangle.
    pub board_margin_mm: f64,
    /// Opening radius (mm) — removes isolated foreground noise.
    pub open_radius_mm: f64,
    /// Closing radius (mm) — fills small holes / gaps.
    pub close_radius_mm: f64,
    /// Reject any candidate component below this area.
    pub min_piece_area_mm2: f64,
    /// Reject components where a very large fraction of pixels
    /// are on the image border (useful for filtering letterboxed fills).
    pub max_border_fraction: f64,
}

impl SegmentationOptions {
    pub fn default_for_scale(
        pixels_per_mm: f64,
        bounds: RectifiedBounds,
        board_width_mm: f64,
        board_height_mm: f64,
        board_margin_mm: f64,
        min_piece_area_mm2: f64,
    ) -> Self {
        Self {
            pixels_per_mm,
            bounds,
            board_width_mm,
            board_height_mm,
            board_margin_mm,
            open_radius_mm: 0.6,
            close_radius_mm: 1.2,
            min_piece_area_mm2,
            max_border_fraction: 0.5,
        }
    }
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
pub struct SegmentationStats {
    pub background_rgb: [u8; 3],
    pub otsu_threshold: u8,
    pub component_count: u32,
    pub piece_area_mm2: f64,
    pub piece_pixel_count: u32,
}

#[derive(Debug, Clone)]
pub struct SegmentationResult {
    pub mask: GrayImage,
    pub board_exclusion: GrayImage,
    pub distance_image: GrayImage,
    pub piece_bbox_px: PixelRect,
    pub stats: SegmentationStats,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

pub fn segment_piece(image: &RgbImage, opts: &SegmentationOptions) -> Result<SegmentationResult> {
    segment_piece_with_validity(image, None, opts)
}

/// Same as [`segment_piece`] but also accepts an optional validity mask
/// (255 = valid pixel, 0 = out-of-bounds). When provided, out-of-bounds
/// pixels are excluded from background estimation and foreground
/// classification alike — important for warped rectified images where
/// the black fill around the board paper can otherwise dominate either
/// statistic.
pub fn segment_piece_with_validity(
    image: &RgbImage,
    validity: Option<&GrayImage>,
    opts: &SegmentationOptions,
) -> Result<SegmentationResult> {
    if image.width() == 0 || image.height() == 0 {
        return Err(anyhow!("segmentation received an empty image"));
    }
    if !opts.pixels_per_mm.is_finite() || opts.pixels_per_mm <= 0.0 {
        return Err(anyhow!(
            "pixels_per_mm must be positive, got {}",
            opts.pixels_per_mm
        ));
    }
    if let Some(v) = validity {
        if v.width() != image.width() || v.height() != image.height() {
            return Err(anyhow!(
                "validity mask size {}×{} does not match image size {}×{}",
                v.width(),
                v.height(),
                image.width(),
                image.height()
            ));
        }
    }

    // The "exclusion" mask marks every pixel that must not be considered
    // part of the piece — the known board rectangle + (optionally) any
    // out-of-bounds pixels from a rectification warp + any "paper" pixels
    // that are contiguous with the printed board (e.g. the white paper
    // surrounding the lattice on Letter/A4 printouts).
    let mut exclusion = build_board_exclusion_mask(image.width(), image.height(), opts);
    if let Some(v) = validity {
        merge_invalid_into_exclusion(&mut exclusion, v);
    }
    let paper_fallback = flood_fill_board_paper(image, &mut exclusion, opts);

    // Two-pass background estimation:
    //
    // Pass 1 uses the median RGB of the entire non-excluded region as a
    // rough background. This is imprecise when the piece is large
    // enough to pull the median toward its own colour, but it's good
    // enough to pick out a conservative super-set of the piece.
    //
    // We then exclude that rough piece mask from the non-excluded set
    // and recompute the background. The second pass converges on the
    // true mat colour even when the piece occupies as much as half of
    // the unmasked area (see the `notched` scene, where a large brown
    // pentagon sits on a near-white mat with substantial room to the
    // right of the board).
    //
    // Smooth lighting variation (vignettes, hotspots) is flattened
    // separately via `normalise_illumination` when — and only when —
    // the local luminance field has a strong gradient restricted to
    // the background region. That check is applied AFTER pass 1 so
    // the piece itself doesn't count toward the gradient estimate.
    // Pass-1 background estimation.
    //
    // Preferred signal is the median of non-excluded pixels — that
    // captures the mat colour even when the mat and the printed paper
    // are distinct (the common real-world case). But when the mat is
    // indistinguishable from the paper, the flood fill absorbs the
    // entire mat and the only pixels left are piece pixels; in that
    // case the median collapses onto the piece colour and segmentation
    // implodes. We detect that regime via the remaining non-excluded
    // area and fall back on the paper colour sampled from the quiet
    // zone.
    let mut non_excluded_count: u64 = 0;
    for p in exclusion.pixels() {
        if p.0[0] == 0 {
            non_excluded_count += 1;
        }
    }
    let total_pixels = (image.width() as u64) * (image.height() as u64);
    let non_excluded_ratio = non_excluded_count as f64 / total_pixels.max(1) as f64;

    let background1 = if non_excluded_ratio < 0.15 {
        paper_fallback
            .or_else(|| robust_background_color(image, &exclusion))
            .context("failed to estimate background colour (no non-board pixels)")?
    } else {
        robust_background_color(image, &exclusion)
            .or(paper_fallback)
            .context("failed to estimate background colour (no non-board pixels)")?
    };
    let distance1 = rgb_distance_image(image, background1);
    let otsu_input1 = mask_out(&distance1, &exclusion);
    let otsu1 = otsu_level(&otsu_input1).max(16);
    let mut rough_fg = threshold(&distance1, otsu1, ThresholdType::Binary);
    zero_where_excluded(&mut rough_fg, &exclusion);
    // Dilate rough_fg a few millimetres so the neighbourhood right
    // around the piece (slight shadows, anti-aliased edges) is also
    // kept out of the pass-2 background estimate.
    let dilate_k = mm_to_kernel_k(2.0, opts.pixels_per_mm);
    if dilate_k > 0 {
        imageproc::morphology::dilate_mut(&mut rough_fg, Norm::L1, dilate_k);
    }

    let mut exclusion_pass2 = exclusion.clone();
    for y in 0..exclusion_pass2.height() {
        for x in 0..exclusion_pass2.width() {
            if rough_fg.get_pixel(x, y).0[0] != 0 {
                exclusion_pass2.put_pixel(x, y, Luma([255]));
            }
        }
    }

    // Flatten smooth lighting variation on the refined background area
    // (without the piece contaminating the luminance field).
    let normalised_image = normalise_illumination(
        image,
        &exclusion_pass2,
        opts.pixels_per_mm,
        180.0,
    );

    let background = robust_background_color(&normalised_image, &exclusion_pass2)
        .unwrap_or(background1);

    // Per-pixel foreground score: combine absolute RGB distance with a
    // chromaticity (normalised-RGB) distance and take the MIN.
    //
    // RGB distance is sensitive to both hue and brightness — great for
    // detecting a coloured piece on a similar-hue mat, but also fires on
    // smooth lighting variation (hotspots, shadows) that shifts
    // brightness without changing hue.
    //
    // Chromaticity = (R/S, G/S, B/S) where S = R+G+B, is lighting
    // invariant under white light: scaling (R,G,B) by a brightness
    // factor leaves chromaticity unchanged. Pure-brightness shifts
    // (hotspots, uniform shadows) therefore score ~0 on chromaticity.
    //
    // Taking the min means a pixel only scores high if BOTH signals
    // agree it's far from background — i.e. it has both a brightness
    // AND a hue difference (real pattern piece), not just one (lighting
    // artefact). Pieces in all test scenes have appreciable hue
    // difference from their mats, so this keeps them in while zeroing
    // hotspots.
    let rgb_dist = rgb_distance_image(&normalised_image, background);
    let chrom_dist = chromaticity_distance_image(&normalised_image, background);
    let distance_image = combine_distance_min(&rgb_dist, &chrom_dist);

    let otsu_input = mask_out(&distance_image, &exclusion);
    let otsu = otsu_level(&otsu_input);

    // Floor the threshold to avoid taking too much texture as foreground
    // in low-contrast scenes.
    let otsu = otsu.max(16);

    let mut foreground = threshold(&distance_image, otsu, ThresholdType::Binary);
    zero_where_excluded(&mut foreground, &exclusion);

    let open_k = mm_to_kernel_k(opts.open_radius_mm, opts.pixels_per_mm);
    let close_k = mm_to_kernel_k(opts.close_radius_mm, opts.pixels_per_mm);
    if open_k > 0 {
        open_mut(&mut foreground, Norm::L1, open_k);
    }
    if close_k > 0 {
        close_mut(&mut foreground, Norm::L1, close_k);
    }

    // Re-exclude after closing (dilation may have bled in).
    zero_where_excluded(&mut foreground, &exclusion);

    #[cfg(not(target_family = "wasm"))]
    {
        if let Ok(path) = std::env::var("RECTIFY_DEBUG_SEG_DIR") {
            let p = std::path::Path::new(&path);
            let _ = std::fs::create_dir_all(p);
            let _ = exclusion.save(p.join("dbg_exclusion.png"));
            let _ = foreground.save(p.join("dbg_foreground.png"));
            let _ = distance_image.save(p.join("dbg_distance.png"));
        }
    }

    let labels: Image<Luma<u32>> =
        connected_components(&foreground, Connectivity::Four, Luma([0u8]));

    let chosen = choose_piece_component(&labels, &exclusion, opts, image.width(), image.height())?;

    let mut piece_mask = GrayImage::from_pixel(image.width(), image.height(), Luma([0u8]));
    for y in 0..labels.height() {
        for x in 0..labels.width() {
            if labels.get_pixel(x, y).0[0] == chosen.label {
                piece_mask.put_pixel(x, y, Luma([255]));
            }
        }
    }

    let px_per_mm2 = opts.pixels_per_mm * opts.pixels_per_mm;
    let piece_area_mm2 = chosen.pixel_count as f64 / px_per_mm2;

    Ok(SegmentationResult {
        mask: piece_mask,
        board_exclusion: exclusion,
        distance_image,
        piece_bbox_px: chosen.bbox,
        stats: SegmentationStats {
            background_rgb: background,
            otsu_threshold: otsu,
            component_count: labels_max_label(&labels),
            piece_area_mm2,
            piece_pixel_count: chosen.pixel_count,
        },
    })
}

fn merge_invalid_into_exclusion(exclusion: &mut GrayImage, validity: &GrayImage) {
    for y in 0..exclusion.height() {
        for x in 0..exclusion.width() {
            if validity.get_pixel(x, y).0[0] == 0 {
                exclusion.put_pixel(x, y, Luma([255]));
            }
        }
    }
}

/// Flood-fill the visible "board paper" around the printed lattice and
/// merge those pixels into the exclusion mask.
///
/// The printable `refboard_v1` asset is a large white sheet with the
/// lattice in the middle; real-world captures often include a cutting
/// mat or table surface beyond the paper. If the user's pattern piece
/// sits on *that* secondary surface, the paper and the mat form a
/// bimodal background that breaks simple global-median colour
/// estimation. By explicitly carving the paper out up-front we reduce
/// the problem to a single-surface background.
fn flood_fill_board_paper(
    image: &RgbImage,
    exclusion: &mut GrayImage,
    opts: &SegmentationOptions,
) -> Option<[u8; 3]> {
    let ppm = opts.pixels_per_mm;
    let min_x_mm = opts.bounds.min_x_mm;
    let min_y_mm = opts.bounds.min_y_mm;
    let w = image.width();
    let h = image.height();

    // The board-exclusion rectangle already covers [−margin,
    // board_w+margin] × [−margin, board_h+margin]. Paper *outside* that
    // rectangle (but still on the physical printout) is what we want to
    // flood away. So we need:
    //   • a reliable estimate of the paper colour, sampled from pixels
    //     we KNOW are paper: a thin band inside the board-margin
    //     (the quiet zone), since the printed asset guarantees that
    //     annulus is white;
    //   • flood-fill SEEDS placed just OUTSIDE the board-margin
    //     rectangle, so they can actually propagate into the surrounding
    //     paper region (seeds inside the exclusion don't help — the
    //     propagation respects exclusion).
    let margin = opts.board_margin_mm.max(2.0);

    // --- Paper colour sampling (inside the quiet zone) -----------------
    let inner_samples_mm: Vec<(f64, f64)> = {
        let mut v = Vec::new();
        let step_mm = 5.0;
        // Top edge strip, y = -margin/2 (2-4 mm above the lattice)
        let mut x = 5.0;
        while x <= opts.board_width_mm - 5.0 {
            v.push((x, -margin * 0.5));
            v.push((x, opts.board_height_mm + margin * 0.5));
            x += step_mm;
        }
        let mut y = 5.0;
        while y <= opts.board_height_mm - 5.0 {
            v.push((-margin * 0.5, y));
            v.push((opts.board_width_mm + margin * 0.5, y));
            y += step_mm;
        }
        v
    };

    let mut paper_samples: Vec<[f64; 3]> = Vec::new();
    for (mx, my) in &inner_samples_mm {
        let x = ((mx - min_x_mm) * ppm).round();
        let y = ((my - min_y_mm) * ppm).round();
        if x < 0.0 || y < 0.0 || x >= w as f64 || y >= h as f64 {
            continue;
        }
        let (sx, sy) = (x as u32, y as u32);
        // Don't sample where the warp produced invalid pixels.
        if exclusion.get_pixel(sx, sy).0[0] != 0 {
            // Warp-invalid pixels are already in exclusion, but board
            // rectangle is also in exclusion — the quiet-zone strip is
            // at the edge of the board rectangle, so these samples live
            // INSIDE the exclusion by design. We still want to sample
            // the pixel colour (which is just regular image content),
            // so we don't skip them here.
        }
        if let Some(avg) = sample_3x3_mean(image, sx, sy) {
            paper_samples.push(avg);
        }
    }
    if paper_samples.is_empty() {
        return None;
    }
    let paper_color = median_rgb(&paper_samples);

    // --- Seed placement OUTSIDE the board-margin rectangle ------------
    // We place seeds at the midpoints of each of the four sides of the
    // board rectangle, stepped a few mm *past* the margin. If the seed
    // is out-of-image or already in exclusion (e.g. the warp clipped the
    // paper on that side), we just skip it; the other seeds will still
    // drive the fill.
    let outer_offset_mm = margin + 3.0;
    let outer_seeds_mm: [(f64, f64); 4] = [
        (opts.board_width_mm * 0.5, -outer_offset_mm),
        (opts.board_width_mm * 0.5, opts.board_height_mm + outer_offset_mm),
        (-outer_offset_mm, opts.board_height_mm * 0.5),
        (opts.board_width_mm + outer_offset_mm, opts.board_height_mm * 0.5),
    ];

    // Tolerance: how far from paper colour a pixel can drift and still
    // be considered part of the paper. The paper is meant to be a
    // uniform near-white sheet, so we keep this fairly tight — the
    // flood only needs to cover genuine paper, not "anything lighter
    // than the mat". Too-loose a tolerance will eat light-coloured
    // pattern pieces (see `light_on_dark` scene) when the piece's hue
    // happens to overlap the paper's colour distribution.
    //
    // Concretely, we want pixels within ~22 RGB units per channel.
    // That's still generous for JPEG noise, mild shadowing, and
    // subpixel-resample blur, but excludes a cream-coloured piece on a
    // dark mat from being swallowed when paper and piece are visually
    // close.
    let tolerance_sq: i32 = 22 * 22 * 3;

    // Spatial bound: the paper surrounding a printed reference board
    // never extends more than ~100 mm beyond the board rectangle (A4
    // and US-Letter both fit inside `board_size + 2 × 50mm`). Bounding
    // the flood fill prevents it from swallowing a same-coloured
    // "mat" that extends far past the paper in scenes where the paper
    // and mat happen to share a hue (see `dark_on_light` scene: the
    // entire canvas is light, and an unbounded flood would eat the
    // mat, making the pattern piece dominate the non-excluded region
    // and poisoning the median background estimate).
    let flood_bound_mm = 110.0_f64;
    let bound_x0_mm = -margin - flood_bound_mm;
    let bound_y0_mm = -margin - flood_bound_mm;
    let bound_x1_mm = opts.board_width_mm + margin + flood_bound_mm;
    let bound_y1_mm = opts.board_height_mm + margin + flood_bound_mm;
    let in_bounds_mm = |x: u32, y: u32| -> bool {
        let mx = min_x_mm + (x as f64) / ppm;
        let my = min_y_mm + (y as f64) / ppm;
        mx >= bound_x0_mm && mx <= bound_x1_mm && my >= bound_y0_mm && my <= bound_y1_mm
    };

    let mut visited = vec![false; (w * h) as usize];
    let mut queue: std::collections::VecDeque<(u32, u32)> =
        std::collections::VecDeque::with_capacity(1024);

    let push_seed = |sx: u32, sy: u32, visited: &mut [bool], queue: &mut std::collections::VecDeque<(u32, u32)>, exclusion: &GrayImage| {
        let idx = (sy * w + sx) as usize;
        if visited[idx] {
            return;
        }
        if exclusion.get_pixel(sx, sy).0[0] != 0 {
            return;
        }
        if !in_bounds_mm(sx, sy) {
            return;
        }
        if color_distance_sq(image.get_pixel(sx, sy).0, paper_color) > tolerance_sq {
            return;
        }
        visited[idx] = true;
        queue.push_back((sx, sy));
    };

    for (mx, my) in &outer_seeds_mm {
        let x = ((mx - min_x_mm) * ppm).round();
        let y = ((my - min_y_mm) * ppm).round();
        if x < 0.0 || y < 0.0 || x >= w as f64 || y >= h as f64 {
            continue;
        }
        push_seed(x as u32, y as u32, &mut visited, &mut queue, exclusion);
    }

    // Belt-and-suspenders: also seed every on-image pixel that is
    // immediately adjacent to the board-exclusion rectangle on its
    // outside border — this guarantees we catch the paper even when the
    // four midpoint seeds happen to miss (e.g. the quiet-zone band is
    // obscured by an occluder on one side).
    let bx0 = (((-margin) - min_x_mm) * ppm).floor().max(0.0) as u32;
    let by0 = (((-margin) - min_y_mm) * ppm).floor().max(0.0) as u32;
    let bx1 = (((opts.board_width_mm + margin) - min_x_mm) * ppm)
        .ceil()
        .min(w as f64) as u32;
    let by1 = (((opts.board_height_mm + margin) - min_y_mm) * ppm)
        .ceil()
        .min(h as f64) as u32;
    // Top and bottom rows just outside the rectangle.
    if by0 > 0 {
        let y = by0 - 1;
        for x in bx0..bx1 {
            push_seed(x, y, &mut visited, &mut queue, exclusion);
        }
    }
    if by1 < h {
        let y = by1;
        for x in bx0..bx1 {
            push_seed(x, y, &mut visited, &mut queue, exclusion);
        }
    }
    if bx0 > 0 {
        let x = bx0 - 1;
        for y in by0..by1 {
            push_seed(x, y, &mut visited, &mut queue, exclusion);
        }
    }
    if bx1 < w {
        let x = bx1;
        for y in by0..by1 {
            push_seed(x, y, &mut visited, &mut queue, exclusion);
        }
    }

    while let Some((x, y)) = queue.pop_front() {
        exclusion.put_pixel(x, y, Luma([255]));
        for (nx, ny) in neighbors4(x, y, w, h) {
            let nidx = (ny * w + nx) as usize;
            if visited[nidx] {
                continue;
            }
            if exclusion.get_pixel(nx, ny).0[0] != 0 {
                visited[nidx] = true;
                continue;
            }
            if !in_bounds_mm(nx, ny) {
                visited[nidx] = true;
                continue;
            }
            if color_distance_sq(image.get_pixel(nx, ny).0, paper_color) <= tolerance_sq {
                visited[nidx] = true;
                queue.push_back((nx, ny));
            }
        }
    }

    Some(paper_color)
}

fn sample_3x3_mean(image: &RgbImage, x: u32, y: u32) -> Option<[f64; 3]> {
    let w = image.width() as i64;
    let h = image.height() as i64;
    let mut sum = [0.0f64; 3];
    let mut count = 0.0f64;
    for dy in -1..=1i64 {
        for dx in -1..=1i64 {
            let xx = x as i64 + dx;
            let yy = y as i64 + dy;
            if xx < 0 || yy < 0 || xx >= w || yy >= h {
                continue;
            }
            let p = image.get_pixel(xx as u32, yy as u32).0;
            sum[0] += p[0] as f64;
            sum[1] += p[1] as f64;
            sum[2] += p[2] as f64;
            count += 1.0;
        }
    }
    if count == 0.0 {
        None
    } else {
        Some([sum[0] / count, sum[1] / count, sum[2] / count])
    }
}

fn median_rgb(samples: &[[f64; 3]]) -> [u8; 3] {
    let mut per_channel: [Vec<f64>; 3] =
        [Vec::with_capacity(samples.len()), Vec::with_capacity(samples.len()), Vec::with_capacity(samples.len())];
    for s in samples {
        per_channel[0].push(s[0]);
        per_channel[1].push(s[1]);
        per_channel[2].push(s[2]);
    }
    let mut out = [0u8; 3];
    for (i, ch) in per_channel.iter_mut().enumerate() {
        ch.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let m = ch[ch.len() / 2];
        out[i] = m.round().clamp(0.0, 255.0) as u8;
    }
    out
}

fn color_distance_sq(a: [u8; 3], b: [u8; 3]) -> i32 {
    let dr = a[0] as i32 - b[0] as i32;
    let dg = a[1] as i32 - b[1] as i32;
    let db = a[2] as i32 - b[2] as i32;
    dr * dr + dg * dg + db * db
}

fn neighbors4(x: u32, y: u32, w: u32, h: u32) -> impl Iterator<Item = (u32, u32)> {
    let mut out = Vec::with_capacity(4);
    if x > 0 {
        out.push((x - 1, y));
    }
    if x + 1 < w {
        out.push((x + 1, y));
    }
    if y > 0 {
        out.push((x, y - 1));
    }
    if y + 1 < h {
        out.push((x, y + 1));
    }
    out.into_iter()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn build_board_exclusion_mask(width: u32, height: u32, opts: &SegmentationOptions) -> GrayImage {
    let mut mask = GrayImage::from_pixel(width, height, Luma([0u8]));

    let ppm = opts.pixels_per_mm;
    let min_x_mm = opts.bounds.min_x_mm;
    let min_y_mm = opts.bounds.min_y_mm;
    let margin = opts.board_margin_mm;

    // Board corners in rectified-pixel coordinates.
    let bx0 = ((-margin - min_x_mm) * ppm).floor();
    let by0 = ((-margin - min_y_mm) * ppm).floor();
    let bx1 = (((opts.board_width_mm + margin) - min_x_mm) * ppm).ceil();
    let by1 = (((opts.board_height_mm + margin) - min_y_mm) * ppm).ceil();

    let x0 = bx0.clamp(0.0, width as f64) as u32;
    let y0 = by0.clamp(0.0, height as f64) as u32;
    let x1 = bx1.clamp(0.0, width as f64) as u32;
    let y1 = by1.clamp(0.0, height as f64) as u32;

    for y in y0..y1 {
        for x in x0..x1 {
            mask.put_pixel(x, y, Luma([255]));
        }
    }

    mask
}

fn robust_background_color(image: &RgbImage, exclusion: &GrayImage) -> Option<[u8; 3]> {
    let stride = 4.max(((image.width() as f64 * image.height() as f64 / 20_000.0).sqrt()) as u32);

    let mut r_hist = [0u32; 256];
    let mut g_hist = [0u32; 256];
    let mut b_hist = [0u32; 256];
    let mut total = 0u32;

    for y in (0..image.height()).step_by(stride as usize) {
        for x in (0..image.width()).step_by(stride as usize) {
            if exclusion.get_pixel(x, y).0[0] != 0 {
                continue;
            }
            let p = image.get_pixel(x, y).0;
            r_hist[p[0] as usize] += 1;
            g_hist[p[1] as usize] += 1;
            b_hist[p[2] as usize] += 1;
            total += 1;
        }
    }

    if total == 0 {
        return None;
    }

    Some([
        histogram_median(&r_hist, total),
        histogram_median(&g_hist, total),
        histogram_median(&b_hist, total),
    ])
}

fn histogram_median(hist: &[u32; 256], total: u32) -> u8 {
    let half = total / 2;
    let mut running = 0u32;
    for (idx, &count) in hist.iter().enumerate() {
        running += count;
        if running >= half {
            return idx as u8;
        }
    }
    255
}

/// Flatten smooth illumination variation across the non-excluded area
/// of `image`. For every pixel we estimate a local luminance L(x,y)
/// using a big box blur, then rescale each RGB channel so the local
/// luminance matches the global median of L.
///
/// This preserves small/sharp-edged foreground objects (the pattern
/// piece) while removing large-scale brightness trends caused by
/// vignettes, hotspots, or glancing lights. The blur uses only
/// non-excluded pixels so paper/board pixels don't pollute the
/// estimate (they'd otherwise pull the field toward white).
fn normalise_illumination(
    image: &RgbImage,
    exclusion: &GrayImage,
    pixels_per_mm: f64,
    window_mm: f64,
) -> RgbImage {
    let w = image.width() as usize;
    let h = image.height() as usize;
    if w == 0 || h == 0 {
        return image.clone();
    }

    // Luminance (mean of RGB, u16 to avoid precision loss pre-blur).
    let mut y_plane = vec![0u16; w * h];
    for (x, y, p) in image.enumerate_pixels() {
        y_plane[(y as usize) * w + (x as usize)] =
            ((p.0[0] as u16 + p.0[1] as u16 + p.0[2] as u16) + 1) / 3;
    }

    // Integral images for luminance and weight-mask (1 where pixel is
    // NOT excluded, 0 otherwise). Using u64 against overflow.
    let stride = w + 1;
    let mut ii_y = vec![0u64; stride * (h + 1)];
    let mut ii_w = vec![0u64; stride * (h + 1)];
    for y in 0..h {
        let mut row_y = 0u64;
        let mut row_w = 0u64;
        for x in 0..w {
            let is_bg = exclusion.get_pixel(x as u32, y as u32).0[0] == 0;
            if is_bg {
                row_y += y_plane[y * w + x] as u64;
                row_w += 1;
            }
            let here = (y + 1) * stride + (x + 1);
            let up = y * stride + (x + 1);
            ii_y[here] = ii_y[up] + row_y;
            ii_w[here] = ii_w[up] + row_w;
        }
    }

    let rect_sum = |ii: &[u64], x0: usize, y0: usize, x1: usize, y1: usize| -> u64 {
        let a = ii[(y1 + 1) * stride + (x1 + 1)];
        let b = ii[y0 * stride + (x1 + 1)];
        let c = ii[(y1 + 1) * stride + x0];
        let d = ii[y0 * stride + x0];
        a.saturating_sub(b).saturating_sub(c).saturating_add(d)
    };

    let radius = ((window_mm * pixels_per_mm * 0.5).round() as usize).max(8);

    // First pass: build local-luminance plane L(x,y) over ALL pixels;
    // for excluded pixels we still want a sensible L (to keep the
    // normalised image continuous), so we fall back on the nearest
    // non-excluded sum by growing the window when needed.
    let mut local_y = vec![0f32; w * h];
    let mut global_y_sum = 0u64;
    let mut global_y_count = 0u64;
    for y in 0..h {
        let mut y0 = y.saturating_sub(radius);
        let mut y1 = (y + radius).min(h - 1);
        for x in 0..w {
            let mut x0 = x.saturating_sub(radius);
            let mut x1 = (x + radius).min(w - 1);
            let mut cnt = rect_sum(&ii_w, x0, y0, x1, y1);
            // Expand window if nothing usable nearby (e.g., a huge
            // excluded island): retry with 2×, 4× radius, up to the
            // whole image. Cheap with integral images.
            let mut grow = 1;
            while cnt < 16 && grow < 8 {
                grow *= 2;
                let r2 = radius * grow;
                x0 = x.saturating_sub(r2);
                y0 = y.saturating_sub(r2);
                x1 = (x + r2).min(w - 1);
                y1 = (y + r2).min(h - 1);
                cnt = rect_sum(&ii_w, x0, y0, x1, y1);
            }
            if cnt == 0 {
                local_y[y * w + x] = 128.0;
            } else {
                let sum = rect_sum(&ii_y, x0, y0, x1, y1);
                let avg = sum as f32 / cnt as f32;
                local_y[y * w + x] = avg.max(1.0);
            }
            if exclusion.get_pixel(x as u32, y as u32).0[0] == 0 {
                global_y_sum += y_plane[y * w + x] as u64;
                global_y_count += 1;
            }
        }
    }

    if global_y_count == 0 {
        return image.clone();
    }
    let global_y = (global_y_sum as f32 / global_y_count as f32).max(1.0);

    // Decide whether lighting variation is significant enough to
    // warrant normalisation. We look at the ratio of the max to min of
    // the local-luminance field restricted to non-excluded pixels. A
    // ratio >= 1.35 is a real gradient; below that, most of the
    // apparent brightness change is noise and normalising just risks
    // amplifying it. In that regime we return the source image
    // unchanged — matches the "no-op" expectation for clean scenes.
    let mut min_l = f32::MAX;
    let mut max_l = 0f32;
    for y in 0..h {
        for x in 0..w {
            if exclusion.get_pixel(x as u32, y as u32).0[0] != 0 {
                continue;
            }
            let l = local_y[y * w + x];
            if l < min_l {
                min_l = l;
            }
            if l > max_l {
                max_l = l;
            }
        }
    }
    if !min_l.is_finite() || !max_l.is_finite() || min_l <= 0.0 {
        return image.clone();
    }
    let gradient_ratio = max_l / min_l;
    if gradient_ratio < 1.35 {
        return image.clone();
    }

    let mut out = RgbImage::new(w as u32, h as u32);
    for y in 0..h {
        for x in 0..w {
            let l = local_y[y * w + x];
            let scale = (global_y / l).clamp(0.5, 2.0);
            let p = image.get_pixel(x as u32, y as u32).0;
            let nr = (p[0] as f32 * scale).clamp(0.0, 255.0) as u8;
            let ng = (p[1] as f32 * scale).clamp(0.0, 255.0) as u8;
            let nb = (p[2] as f32 * scale).clamp(0.0, 255.0) as u8;
            out.put_pixel(x as u32, y as u32, image::Rgb([nr, ng, nb]));
        }
    }
    out
}

/// Chromaticity distance: Euclidean distance in normalised-RGB space
/// `(R/S, G/S, B/S)` where `S = R+G+B`. This representation is
/// invariant under multiplicative white-lighting changes, so uniform
/// brightness shifts (hotspots, vignettes, shadows) produce near-zero
/// distance while hue shifts (real pattern pieces) produce a positive
/// distance regardless of how bright the pixel happens to be.
///
/// We add a small constant to `S` to avoid divide-by-zero on very
/// dark pixels (chromaticity is undefined for pure black).
fn chromaticity_distance_image(image: &RgbImage, background: [u8; 3]) -> GrayImage {
    let mut out = GrayImage::new(image.width(), image.height());

    let bs = (background[0] as f32 + background[1] as f32 + background[2] as f32).max(1.0);
    let br = background[0] as f32 / bs;
    let bg = background[1] as f32 / bs;
    let bb = background[2] as f32 / bs;

    // Max possible distance in chromaticity space is sqrt(3) * (1 - 1/3) ≈
    // 1.155 when the pixel is a pure primary and background is pure white.
    // Empirically, realistic piece-vs-mat chromaticity distances fall in
    // the 0.05..0.25 range, so we pick a tighter normalisation so an
    // appreciable hue difference maps to an appreciable [0, 255] output.
    let scale = 255.0 / 0.40_f32;

    // Pure-black pixels (S < min_s) have undefined chromaticity. Keep
    // them at 0 rather than letting noise blow up.
    let min_s = 6.0_f32;

    for (x, y, p) in image.enumerate_pixels() {
        let s = p.0[0] as f32 + p.0[1] as f32 + p.0[2] as f32;
        if s < min_s {
            out.put_pixel(x, y, Luma([0]));
            continue;
        }
        let dr = (p.0[0] as f32 / s) - br;
        let dg = (p.0[1] as f32 / s) - bg;
        let db = (p.0[2] as f32 / s) - bb;
        let d = (dr * dr + dg * dg + db * db).sqrt();
        let v = (d * scale).min(255.0) as u8;
        out.put_pixel(x, y, Luma([v]));
    }

    out
}

/// Element-wise minimum of two distance images.
fn combine_distance_min(a: &GrayImage, b: &GrayImage) -> GrayImage {
    assert_eq!(a.dimensions(), b.dimensions());
    let mut out = GrayImage::new(a.width(), a.height());
    for y in 0..a.height() {
        for x in 0..a.width() {
            let va = a.get_pixel(x, y).0[0];
            let vb = b.get_pixel(x, y).0[0];
            out.put_pixel(x, y, Luma([va.min(vb)]));
        }
    }
    out
}

fn rgb_distance_image(image: &RgbImage, background: [u8; 3]) -> GrayImage {
    let mut out = GrayImage::new(image.width(), image.height());
    let br = background[0] as i32;
    let bg = background[1] as i32;
    let bb = background[2] as i32;

    // Max possible Euclidean distance: sqrt(3 * 255^2) ≈ 441.67. We normalise
    // to [0, 255] so Otsu operates in the usual range.
    let scale = 255.0 / 441.672_95_f32;

    for (x, y, p) in image.enumerate_pixels() {
        let dr = p.0[0] as i32 - br;
        let dg = p.0[1] as i32 - bg;
        let db = p.0[2] as i32 - bb;
        let d = ((dr * dr + dg * dg + db * db) as f32).sqrt();
        let v = (d * scale).min(255.0) as u8;
        out.put_pixel(x, y, Luma([v]));
    }

    out
}

fn mask_out(distance: &GrayImage, exclusion: &GrayImage) -> GrayImage {
    let mut out = distance.clone();
    for (x, y, p) in exclusion.enumerate_pixels() {
        if p.0[0] != 0 {
            out.put_pixel(x, y, Luma([0]));
        }
    }
    out
}

fn zero_where_excluded(mask: &mut GrayImage, exclusion: &GrayImage) {
    for y in 0..mask.height() {
        for x in 0..mask.width() {
            if exclusion.get_pixel(x, y).0[0] != 0 {
                mask.put_pixel(x, y, Luma([0]));
            }
        }
    }
}

fn mm_to_kernel_k(radius_mm: f64, pixels_per_mm: f64) -> u8 {
    let r = (radius_mm * pixels_per_mm).round();
    if r.is_finite() && r > 0.0 {
        r.min(50.0) as u8
    } else {
        0
    }
}

#[derive(Debug, Clone, Copy)]
struct Candidate {
    label: u32,
    pixel_count: u32,
    bbox: PixelRect,
}

fn choose_piece_component(
    labels: &Image<Luma<u32>>,
    exclusion: &GrayImage,
    opts: &SegmentationOptions,
    img_w: u32,
    img_h: u32,
) -> Result<Candidate> {
    let max_label = labels_max_label(labels);
    if max_label == 0 {
        return Err(anyhow!("no foreground components after segmentation"));
    }

    let mut counts = vec![0u32; (max_label + 1) as usize];
    let mut min_x = vec![u32::MAX; (max_label + 1) as usize];
    let mut min_y = vec![u32::MAX; (max_label + 1) as usize];
    let mut max_x = vec![0u32; (max_label + 1) as usize];
    let mut max_y = vec![0u32; (max_label + 1) as usize];
    let mut border = vec![0u32; (max_label + 1) as usize];

    for y in 0..labels.height() {
        for x in 0..labels.width() {
            let lbl = labels.get_pixel(x, y).0[0];
            if lbl == 0 {
                continue;
            }
            let i = lbl as usize;
            counts[i] += 1;
            if x < min_x[i] { min_x[i] = x; }
            if y < min_y[i] { min_y[i] = y; }
            if x > max_x[i] { max_x[i] = x; }
            if y > max_y[i] { max_y[i] = y; }
            if x == 0 || y == 0 || x + 1 == img_w || y + 1 == img_h {
                border[i] += 1;
            }
        }
    }

    let excl_bbox = exclusion_bbox(exclusion);

    let px_per_mm2 = opts.pixels_per_mm * opts.pixels_per_mm;
    let min_pixels = (opts.min_piece_area_mm2 * px_per_mm2).ceil() as u32;

    let mut best: Option<Candidate> = None;

    for lbl in 1..=max_label {
        let i = lbl as usize;
        if counts[i] < min_pixels {
            continue;
        }
        let border_fraction = border[i] as f64 / counts[i] as f64;
        if border_fraction > opts.max_border_fraction {
            continue;
        }
        let bbox = PixelRect {
            min_x: min_x[i],
            min_y: min_y[i],
            max_x: max_x[i] + 1,
            max_y: max_y[i] + 1,
        };
        // Reject components whose bbox fully contains the board exclusion
        // rectangle: those are almost always the board's paper wrapper,
        // not the pattern piece.
        if let Some(eb) = excl_bbox {
            if bbox.min_x <= eb.min_x
                && bbox.min_y <= eb.min_y
                && bbox.max_x >= eb.max_x
                && bbox.max_y >= eb.max_y
            {
                continue;
            }
        }
        let cand = Candidate {
            label: lbl,
            pixel_count: counts[i],
            bbox,
        };
        match best {
            None => best = Some(cand),
            Some(b) if cand.pixel_count > b.pixel_count => best = Some(cand),
            _ => {}
        }
    }

    best.ok_or_else(|| {
        anyhow!(
            "no foreground component passed size/border/board filters \
             (min area = {:.2} mm², max border fraction = {:.2}, components = {})",
            opts.min_piece_area_mm2,
            opts.max_border_fraction,
            max_label
        )
    })
}

fn exclusion_bbox(exclusion: &GrayImage) -> Option<PixelRect> {
    let mut min_x = u32::MAX;
    let mut min_y = u32::MAX;
    let mut max_x = 0u32;
    let mut max_y = 0u32;
    let mut any = false;
    for y in 0..exclusion.height() {
        for x in 0..exclusion.width() {
            if exclusion.get_pixel(x, y).0[0] != 0 {
                any = true;
                if x < min_x { min_x = x; }
                if y < min_y { min_y = y; }
                if x > max_x { max_x = x; }
                if y > max_y { max_y = y; }
            }
        }
    }
    if !any {
        return None;
    }
    Some(PixelRect {
        min_x,
        min_y,
        max_x: max_x + 1,
        max_y: max_y + 1,
    })
}

fn labels_max_label(labels: &Image<Luma<u32>>) -> u32 {
    let mut max = 0u32;
    for p in labels.pixels() {
        if p.0[0] > max {
            max = p.0[0];
        }
    }
    max
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage};

    fn bounds_for(width_mm: f64, height_mm: f64) -> RectifiedBounds {
        RectifiedBounds {
            min_x_mm: 0.0,
            min_y_mm: 0.0,
            max_x_mm: width_mm,
            max_y_mm: height_mm,
        }
    }

    #[test]
    fn segments_dark_square_on_light_background() {
        let w = 200u32;
        let h = 160u32;
        let mut img = RgbImage::from_pixel(w, h, Rgb([235, 232, 228]));
        // Dark square in the lower-right (clear of the fake "board").
        for y in 80..140 {
            for x in 120..180 {
                img.put_pixel(x, y, Rgb([40, 48, 70]));
            }
        }

        let opts = SegmentationOptions::default_for_scale(
            4.0,                 // 4 px/mm → image is 50 × 40 mm
            bounds_for(50.0, 40.0),
            20.0,                // fake board is 20×15 mm starting at origin
            15.0,
            0.0,
            10.0,
        );
        let result = segment_piece(&img, &opts).unwrap();

        assert!(result.stats.piece_area_mm2 > 200.0 && result.stats.piece_area_mm2 < 260.0);
        assert_eq!(result.piece_bbox_px.min_x, 120);
        assert_eq!(result.piece_bbox_px.min_y, 80);
    }

    #[test]
    fn board_exclusion_removes_board_from_candidates() {
        let w = 100u32;
        let h = 80u32;
        // A fully dark image — without masking, the entire image would be
        // "foreground" and the segment would match the whole frame. With the
        // board mask covering most of the image, the largest remaining
        // candidate should be a small strip on the right.
        let mut img = RgbImage::from_pixel(w, h, Rgb([230, 230, 230]));
        // "dark strip" next to the fake board. Slight blue tint so the
        // strip is distinguishable from the neutral mat on both
        // brightness AND chromaticity — real-world pattern fabric
        // always has at least a little colour cast.
        for y in 20..60 {
            for x in 70..95 {
                img.put_pixel(x, y, Rgb([30, 38, 55]));
            }
        }

        let opts = SegmentationOptions::default_for_scale(
            2.0,
            bounds_for(50.0, 40.0),
            30.0, // board covers mm (0..30)×(0..40) → px (0..60)×(0..80)
            40.0,
            0.0,
            5.0,
        );
        let result = segment_piece(&img, &opts).unwrap();
        // Piece should start at or after the board's right edge (60 px).
        assert!(
            result.piece_bbox_px.min_x >= 60,
            "piece bbox leaked into board region: {:?}",
            result.piece_bbox_px
        );
    }

    #[test]
    fn rejects_when_no_foreground() {
        let img = RgbImage::from_pixel(40, 30, Rgb([200, 200, 200]));
        let opts = SegmentationOptions::default_for_scale(
            2.0,
            bounds_for(20.0, 15.0),
            10.0,
            10.0,
            0.0,
            1.0,
        );
        let err = segment_piece(&img, &opts).unwrap_err();
        let s = err.to_string();
        assert!(s.contains("no foreground"), "got: {s}");
    }
}
