//! End-to-end outline extraction integration tests.
//!
//! Each test drives `run_rectify` against a scene from the synthetic
//! `examples/photos/synthetic_pattern_set/` and asserts:
//! - Outline outputs (SVG, DXF, JSON, piece mask) all exist.
//! - Simplified vertex count is sensible (>= 3, <= raw count).
//! - Bidirectional Hausdorff distance from the extracted polygon to
//!   the ground-truth polygon (both in board-mm coordinates) is
//!   below the per-scene tolerance.
//! - Signed-area error is below the per-scene tolerance.
//! - SVG and DXF files contain the minimum syntactic markers we expect.
//!
//! The synthetic set is checked into the repo, so these tests are
//! deterministic and offline.

use std::{fs, path::{Path, PathBuf}};

use rectify_core::{
    BoardSpecSource, OutlineOptions, RectifyRequest, run_rectify,
};
use serde_json::Value;

#[derive(Debug, Clone, Copy)]
struct Tolerance {
    hausdorff_mm: f64,
    area_frac: f64,
}

fn scene_path(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(format!("../examples/photos/synthetic_pattern_set/{name}.png"))
}

fn sidecar_path(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(format!("../examples/photos/synthetic_pattern_set/{name}.json"))
}

fn unique_tmp(prefix: &str) -> PathBuf {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ns = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("{prefix}-{ns}"))
}

fn load_ground_truth(name: &str) -> Vec<[f64; 2]> {
    let sidecar: Value =
        serde_json::from_str(&fs::read_to_string(sidecar_path(name)).unwrap()).unwrap();
    sidecar["ground_truth_polygon_board_mm"]
        .as_array()
        .expect("ground_truth_polygon_board_mm must exist")
        .iter()
        .map(|p| {
            let arr = p.as_array().unwrap();
            [arr[0].as_f64().unwrap(), arr[1].as_f64().unwrap()]
        })
        .collect()
}

fn load_outline_polygon(path: &Path) -> Vec<[f64; 2]> {
    let outline: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    outline["polygon_mm"]
        .as_array()
        .expect("polygon_mm must exist")
        .iter()
        .map(|p| {
            let arr = p.as_array().unwrap();
            [arr[0].as_f64().unwrap(), arr[1].as_f64().unwrap()]
        })
        .collect()
}

/// Shoelace formula for signed polygon area. Returns the absolute
/// value in the same unit² as the input coordinates.
fn polygon_area_abs(poly: &[[f64; 2]]) -> f64 {
    if poly.len() < 3 {
        return 0.0;
    }
    let mut sum = 0.0;
    for i in 0..poly.len() {
        let a = poly[i];
        let b = poly[(i + 1) % poly.len()];
        sum += a[0] * b[1] - b[0] * a[1];
    }
    (sum * 0.5).abs()
}

/// Perpendicular distance from point `p` to segment `a-b`.
fn point_to_segment_sq(p: [f64; 2], a: [f64; 2], b: [f64; 2]) -> f64 {
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    let len_sq = dx * dx + dy * dy;
    if len_sq < 1e-12 {
        let ex = p[0] - a[0];
        let ey = p[1] - a[1];
        return ex * ex + ey * ey;
    }
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len_sq;
    let tc = t.clamp(0.0, 1.0);
    let cx = a[0] + tc * dx;
    let cy = a[1] + tc * dy;
    let ex = p[0] - cx;
    let ey = p[1] - cy;
    ex * ex + ey * ey
}

fn min_distance_to_polygon(p: [f64; 2], poly: &[[f64; 2]]) -> f64 {
    let n = poly.len();
    if n < 2 {
        return f64::INFINITY;
    }
    let mut best = f64::INFINITY;
    for i in 0..n {
        let a = poly[i];
        let b = poly[(i + 1) % n];
        let d = point_to_segment_sq(p, a, b);
        if d < best {
            best = d;
        }
    }
    best.sqrt()
}

/// Bidirectional Hausdorff distance between two closed polygons,
/// measured as point-to-edge distance (so densely-sampled ground
/// truths don't unfairly penalise sparse extracted polygons).
fn hausdorff(a: &[[f64; 2]], b: &[[f64; 2]]) -> f64 {
    let a_to_b = a
        .iter()
        .map(|&p| min_distance_to_polygon(p, b))
        .fold(0.0_f64, f64::max);
    let b_to_a = b
        .iter()
        .map(|&p| min_distance_to_polygon(p, a))
        .fold(0.0_f64, f64::max);
    a_to_b.max(b_to_a)
}

fn run_scene(name: &str, tol: Tolerance) {
    let tmp = unique_tmp(&format!("rectify-outline-{name}"));
    fs::create_dir_all(&tmp).unwrap();
    let output_dir = tmp.join("out");

    let result = run_rectify(&RectifyRequest {
        input_path: scene_path(name),
        board_spec_source: BoardSpecSource::BuiltIn("refboard_v1".to_string()),
        output_dir: output_dir.clone(),
        pixels_per_mm: Some(10.0),
        outline: OutlineOptions::default(),
    })
    .unwrap_or_else(|e| panic!("rectify failed for {name}: {e:#}"));

    let outline = result
        .outline
        .as_ref()
        .unwrap_or_else(|| panic!("outline missing for {name}"));

    // File existence.
    assert!(
        outline.svg_path.exists(),
        "[{name}] missing SVG: {}",
        outline.svg_path.display()
    );
    assert!(
        outline.dxf_path.exists(),
        "[{name}] missing DXF: {}",
        outline.dxf_path.display()
    );
    assert!(
        outline.json_path.exists(),
        "[{name}] missing JSON: {}",
        outline.json_path.display()
    );
    assert!(
        outline.mask_debug_path.exists(),
        "[{name}] missing piece_mask.png: {}",
        outline.mask_debug_path.display()
    );

    // SVG sanity: mm units and a closed path.
    let svg = fs::read_to_string(&outline.svg_path).unwrap();
    assert!(
        svg.contains("<svg") && svg.contains("mm"),
        "[{name}] SVG missing <svg>/mm tags"
    );
    assert!(
        svg.contains(" Z") || svg.contains("z\""),
        "[{name}] SVG path not closed"
    );

    // DXF sanity: header and a closed LWPOLYLINE.
    let dxf = fs::read_to_string(&outline.dxf_path).unwrap();
    assert!(
        dxf.contains("LWPOLYLINE"),
        "[{name}] DXF missing LWPOLYLINE"
    );
    assert!(
        dxf.contains("EOF"),
        "[{name}] DXF missing EOF terminator"
    );

    // Vertex counts.
    let simplified = load_outline_polygon(&outline.json_path);
    assert!(
        simplified.len() >= 3,
        "[{name}] need at least 3 vertices, got {}",
        simplified.len()
    );
    assert!(
        outline.metadata.vertex_count_simplified <= outline.metadata.vertex_count_raw,
        "[{name}] simplified > raw: {} > {}",
        outline.metadata.vertex_count_simplified,
        outline.metadata.vertex_count_raw
    );

    // Accuracy.
    let gt = load_ground_truth(name);
    let haus = hausdorff(&simplified, &gt);
    assert!(
        haus <= tol.hausdorff_mm,
        "[{name}] Hausdorff {haus:.3} mm exceeds tolerance {:.3} mm",
        tol.hausdorff_mm
    );
    let gt_area = polygon_area_abs(&gt);
    let area = outline.metadata.area_mm2;
    let area_err = (area - gt_area).abs() / gt_area;
    assert!(
        area_err <= tol.area_frac,
        "[{name}] area error {:.2}% (got {:.1}, expected {:.1}) exceeds tolerance {:.2}%",
        area_err * 100.0,
        area,
        gt_area,
        tol.area_frac * 100.0,
    );

    fs::remove_dir_all(tmp).ok();
}

// Per-scene tolerances.
// Clean tier — straight edges, near-perfect conditions.
const CLEAN: Tolerance = Tolerance { hausdorff_mm: 0.8, area_frac: 0.02 };
// Curved tier — relaxed because simplification trades off vertex budget.
const CURVED: Tolerance = Tolerance { hausdorff_mm: 1.5, area_frac: 0.03 };
// Stress tier — hostile conditions (vignette/hotspot, rotated board).
const STRESS: Tolerance = Tolerance { hausdorff_mm: 1.8, area_frac: 0.04 };

#[test]
fn dark_on_light_outline_is_within_tolerance() {
    run_scene("dark_on_light", CLEAN);
}

#[test]
fn light_on_dark_outline_is_within_tolerance() {
    run_scene("light_on_dark", CLEAN);
}

#[test]
fn curved_outline_is_within_tolerance() {
    run_scene("curved", CURVED);
}

#[test]
fn notched_outline_is_within_tolerance() {
    run_scene("notched", CLEAN);
}

#[test]
fn near_occluder_outline_is_within_tolerance() {
    run_scene("near_occluder", CLEAN);
}

#[test]
fn rotated_board_outline_is_within_tolerance() {
    run_scene("rotated_board", STRESS);
}

#[test]
fn multi_lighting_outline_is_within_tolerance() {
    run_scene("multi_lighting", STRESS);
}
