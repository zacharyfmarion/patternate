//! Polygon simplification utilities.
//!
//! Ships a Ramer–Douglas–Peucker implementation that operates on `f64`
//! (x, y) points in arbitrary units, and a Chaikin corner-cutting pass
//! reserved for the `--smooth` flag.
//!
//! The module is deliberately independent of `image` / `imageproc` so it
//! can be exercised in pure-Rust unit tests and reused in future WASM
//! frontends.

use crate::contour::MmPolygon;

/// Apply Ramer–Douglas–Peucker simplification to an open polyline.
///
/// `epsilon` is the maximum allowed perpendicular distance between the
/// simplified polyline and the original. Points within `epsilon` of an
/// approximating chord are discarded.
///
/// Returns a `Vec` containing at least the first and last input points.
pub fn rdp(points: &[[f64; 2]], epsilon: f64) -> Vec<[f64; 2]> {
    if points.len() < 3 {
        return points.to_vec();
    }
    let n = points.len();
    let mut keep = vec![false; n];
    keep[0] = true;
    keep[n - 1] = true;

    rdp_recurse(points, 0, n - 1, epsilon, &mut keep);

    points
        .iter()
        .enumerate()
        .filter_map(|(i, p)| if keep[i] { Some(*p) } else { None })
        .collect()
}

fn rdp_recurse(points: &[[f64; 2]], i0: usize, i1: usize, eps: f64, keep: &mut [bool]) {
    if i1 <= i0 + 1 {
        return;
    }
    let [x1, y1] = points[i0];
    let [x2, y2] = points[i1];
    let dx = x2 - x1;
    let dy = y2 - y1;
    let seg_len2 = dx * dx + dy * dy;

    let mut max_d2 = -1.0_f64;
    let mut max_i = i0;

    for i in (i0 + 1)..i1 {
        let [px, py] = points[i];
        let d2 = if seg_len2 == 0.0 {
            let ex = px - x1;
            let ey = py - y1;
            ex * ex + ey * ey
        } else {
            let num = (dy * px - dx * py + x2 * y1 - y2 * x1).abs();
            (num * num) / seg_len2
        };
        if d2 > max_d2 {
            max_d2 = d2;
            max_i = i;
        }
    }

    if max_d2 > eps * eps {
        keep[max_i] = true;
        rdp_recurse(points, i0, max_i, eps, keep);
        rdp_recurse(points, max_i, i1, eps, keep);
    }
}

/// Close-aware RDP variant for closed polygons. Duplicates the first
/// point to the end, runs RDP, and drops the trailing duplicate so
/// downstream consumers see a clean ordered vertex list.
pub fn rdp_closed(points: &[[f64; 2]], epsilon: f64) -> Vec<[f64; 2]> {
    if points.len() < 4 {
        return points.to_vec();
    }
    let mut closed = points.to_vec();
    closed.push(points[0]);
    let mut simplified = rdp(&closed, epsilon);
    if simplified.len() > 1 && simplified.first() == simplified.last() {
        simplified.pop();
    }
    simplified
}

/// Simplify an `MmPolygon` in place, preserving closure semantics.
pub fn simplify_polygon(polygon: &MmPolygon, tolerance_mm: f64) -> MmPolygon {
    MmPolygon {
        points: rdp_closed(&polygon.points, tolerance_mm.max(0.0)),
    }
}

/// Chaikin corner-cutting smoothing. `iterations` rounds of cutting
/// progressively approximate a quadratic B-spline. Kept as a building
/// block for the future `--smooth` flag; `iterations == 0` returns
/// the input unchanged.
pub fn chaikin_smooth_closed(points: &[[f64; 2]], iterations: u32) -> Vec<[f64; 2]> {
    if iterations == 0 || points.len() < 3 {
        return points.to_vec();
    }
    let mut current = points.to_vec();
    for _ in 0..iterations {
        let n = current.len();
        let mut next = Vec::with_capacity(n * 2);
        for i in 0..n {
            let a = current[i];
            let b = current[(i + 1) % n];
            next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
            next.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
        }
        current = next;
    }
    current
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rdp_preserves_collinear_noise_free_polyline() {
        let pts = vec![[0.0, 0.0], [1.0, 0.0], [2.0, 0.0], [3.0, 0.0], [4.0, 0.0]];
        let simplified = rdp(&pts, 0.01);
        assert_eq!(simplified, vec![[0.0, 0.0], [4.0, 0.0]]);
    }

    #[test]
    fn rdp_keeps_feature_point_above_tolerance() {
        let pts = vec![[0.0, 0.0], [1.0, 0.5], [2.0, 0.0]];
        let keep_big = rdp(&pts, 0.1);
        assert_eq!(keep_big.len(), 3);
        let drop_small = rdp(&pts, 1.0);
        assert_eq!(drop_small.len(), 2);
    }

    #[test]
    fn rdp_closed_drops_duplicate_end_and_simplifies_square() {
        // Square with interpolated midpoints on each edge.
        let pts = vec![
            [0.0, 0.0],
            [5.0, 0.0],
            [10.0, 0.0],
            [10.0, 5.0],
            [10.0, 10.0],
            [5.0, 10.0],
            [0.0, 10.0],
            [0.0, 5.0],
        ];
        let simplified = rdp_closed(&pts, 0.01);
        assert_eq!(simplified.len(), 4);
        // First/last should not be duplicates.
        assert_ne!(simplified.first(), simplified.last());
    }

    #[test]
    fn chaikin_noops_at_zero_iterations() {
        let pts = vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];
        assert_eq!(chaikin_smooth_closed(&pts, 0), pts);
    }

    #[test]
    fn chaikin_produces_more_points_with_smaller_area() {
        let pts = vec![[0.0, 0.0], [4.0, 0.0], [4.0, 4.0], [0.0, 4.0]];
        let smoothed = chaikin_smooth_closed(&pts, 2);
        assert!(smoothed.len() > pts.len());
    }
}
