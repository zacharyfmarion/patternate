//! Spike: validate calib-targets-charuco against refboard_v1 images
//!
//! Run with:
//!   cargo run --bin spike_charuco

use std::path::Path;

use calib_targets::charuco::{CharucoBoardSpec, CharucoParams};
use calib_targets::detect::detect_charuco;
use calib_targets_aruco::builtins;

// refboard_v1: 11 cols × 8 rows, 15 mm squares, 11 mm markers, DICT_5X5_100
fn board_spec() -> CharucoBoardSpec {
    CharucoBoardSpec {
        cols: 11,
        rows: 8,
        cell_size: 15.0,
        marker_size_rel: 11.0 / 15.0,
        dictionary: builtins::DICT_5X5_100.clone(),
        marker_layout: calib_targets::charuco::MarkerLayout::default(),
    }
}

fn try_detect(label: &str, img_path: &Path, px_per_square_hints: &[f32]) {
    println!("\n=== {label} ===");
    let gray = image::open(img_path)
        .unwrap_or_else(|_| panic!("failed to open {}", img_path.display()))
        .to_luma8();
    println!("Image: {}x{}", gray.width(), gray.height());

    let board = board_spec();

    // Build params with grid spacing tuned to actual image scale.
    // GridGraphParams::default() uses max_spacing_pix=50 which rejects corners
    // spaced > 50px apart — our images have 70–177px spacing.
    let make_params = |px_per_sq: f32| -> CharucoParams {
        let mut p = CharucoParams::for_board(&board);
        p.px_per_square = px_per_sq;
        p.chessboard.graph.min_spacing_pix = px_per_sq * 0.5;
        p.chessboard.graph.max_spacing_pix = px_per_sq * 1.5;
        p
    };

    // For each hint, try base config + sweep variants.
    let mut all_params: Vec<(f32, CharucoParams)> = Vec::new();
    for &hint in px_per_square_hints {
        all_params.push((hint, make_params(hint)));
        let sweep = CharucoParams::sweep_for_board(&board);
        for mut p in sweep {
            p.px_per_square = hint;
            p.chessboard.graph.min_spacing_pix = hint * 0.5;
            p.chessboard.graph.max_spacing_pix = hint * 1.5;
            all_params.push((hint, p));
        }
    }

    let mut succeeded = false;
    for (i, (hint, params)) in all_params.iter().enumerate() {
        match detect_charuco(&gray, params) {
            Ok(result) => {
                let corners = &result.detection.corners;
                let with_pos = corners.iter().filter(|c| c.target_position.is_some()).count();
                println!(
                    "  Config {i} (hint={hint}px/sq): OK — {} corners, {} with board-mm, {} markers",
                    corners.len(),
                    with_pos,
                    result.markers.len(),
                );
                for c in corners.iter().filter(|c| c.target_position.is_some()).take(3) {
                    let tp = c.target_position.unwrap();
                    println!(
                        "    img ({:.1},{:.1}) → board ({:.1}mm,{:.1}mm)  id={:?}",
                        c.position.x, c.position.y, tp.x, tp.y, c.id,
                    );
                }
                succeeded = true;
                break;
            }
            Err(e) => {
                println!("  Config {i} (hint={hint}px/sq): FAILED — {e:?}");
            }
        }
    }
    if !succeeded {
        println!("  All configs failed.");
    }
}

fn main() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");

    // 1. The printable board PNG itself (~177 px/square at 300 DPI)
    try_detect(
        "refboard_v1_letter.png (300 DPI)",
        &root.join("assets/refboard_v1/refboard_v1_letter.png"),
        &[177.0],
    );

    // Synthetic scenes: board PNG scaled by ~0.46, then perspective-warped (~0.87×).
    // Raw board squares: 177 * 0.46 ≈ 81px.  After perspective warp: ~70px.
    // Sweep a range in case perspective varies across scenes.
    let synthetic_hints: &[f32] = &[50.0, 65.0, 80.0, 95.0, 110.0];

    // 2. Synthetic scene — fronto-parallel, low stress
    try_detect(
        "synthetic easy",
        &root.join("examples/photos/synthetic_refboard_set/easy.png"),
        synthetic_hints,
    );

    // 3. Synthetic oblique
    try_detect(
        "synthetic oblique",
        &root.join("examples/photos/synthetic_refboard_set/oblique.png"),
        synthetic_hints,
    );

    // 4. Synthetic partial occlusion
    try_detect(
        "synthetic partial_occlusion",
        &root.join("examples/photos/synthetic_refboard_set/partial_occlusion.png"),
        synthetic_hints,
    );
}
