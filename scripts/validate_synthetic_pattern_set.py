#!/usr/bin/env python3
"""Run the rectify CLI over every scene in synthetic_pattern_set and
compare the exported polygon against the ground-truth sidecar.

Reports per-scene:
  - pass/fail status
  - Hausdorff distance (mm) between exported and ground-truth polygons
  - Absolute area error (mm² and %)
  - Simplified vertex count

Exits non-zero if any scene fails the accuracy thresholds.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

# Thresholds (change here to tune acceptance bar).
CLEAN_HAUSDORFF_MM = 0.8
STRESS_HAUSDORFF_MM = 1.8
CLEAN_AREA_ERROR = 0.02
STRESS_AREA_ERROR = 0.04

STRESS_SCENES = {"multi_lighting", "light_on_dark", "curved"}


@dataclass
class SceneResult:
    name: str
    hausdorff_mm: float
    area_mm2: float
    gt_area_mm2: float
    area_err_frac: float
    vertex_count: int
    passed: bool
    note: str = ""


def run_rectify(input_img: Path, output_dir: Path) -> None:
    if output_dir.exists():
        shutil.rmtree(output_dir)
    subprocess.run(
        [
            "cargo",
            "run",
            "--release",
            "--quiet",
            "-p",
            "rectify-cli",
            "--",
            "rectify",
            "--input",
            str(input_img),
            "--output-dir",
            str(output_dir),
            "--pixels-per-mm",
            "10",
        ],
        check=True,
    )


def point_to_segment_dist(p, a, b) -> float:
    px, py = p
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    seg2 = dx * dx + dy * dy
    if seg2 == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
    cx = ax + t * dx
    cy = ay + t * dy
    return math.hypot(px - cx, py - cy)


def polygon_point_hausdorff(polygon_points, target_segments) -> float:
    """Max over `polygon_points` of min distance to any target segment."""
    worst = 0.0
    for p in polygon_points:
        best = min(point_to_segment_dist(p, a, b) for a, b in target_segments)
        if best > worst:
            worst = best
    return worst


def hausdorff_symmetric(poly_a, poly_b) -> float:
    segs_b = list(zip(poly_b, poly_b[1:] + poly_b[:1]))
    segs_a = list(zip(poly_a, poly_a[1:] + poly_a[:1]))
    a_to_b = polygon_point_hausdorff(poly_a, segs_b)
    b_to_a = polygon_point_hausdorff(poly_b, segs_a)
    return max(a_to_b, b_to_a)


def shoelace_area(points) -> float:
    s = 0.0
    n = len(points)
    for i in range(n):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return abs(s) * 0.5


def validate_scene(scene_name: str, scene_dir: Path) -> SceneResult:
    image_path = scene_dir / f"{scene_name}.png"
    sidecar_path = scene_dir / f"{scene_name}.json"
    sidecar = json.loads(sidecar_path.read_text())
    gt_poly = [tuple(p) for p in sidecar["ground_truth_polygon_board_mm"]]

    out_dir = Path("/tmp") / f"validate-{scene_name}"
    run_rectify(image_path, out_dir)

    outline_json = json.loads((out_dir / "outline.json").read_text())
    extracted = [tuple(p) for p in outline_json["polygon_mm"]]

    if not extracted:
        return SceneResult(
            scene_name, math.inf, 0.0, shoelace_area(gt_poly), math.inf, 0, False,
            "empty extracted polygon",
        )

    haus = hausdorff_symmetric(extracted, gt_poly)
    gt_area = shoelace_area(gt_poly)
    ex_area = shoelace_area(extracted)
    area_err = abs(ex_area - gt_area) / gt_area if gt_area > 0 else math.inf

    haus_tol = STRESS_HAUSDORFF_MM if scene_name in STRESS_SCENES else CLEAN_HAUSDORFF_MM
    area_tol = STRESS_AREA_ERROR if scene_name in STRESS_SCENES else CLEAN_AREA_ERROR

    passed = haus <= haus_tol and area_err <= area_tol
    note = "" if passed else f"(tol: haus≤{haus_tol} mm, area≤{area_tol*100:.0f}%)"

    return SceneResult(
        scene_name,
        haus,
        ex_area,
        gt_area,
        area_err,
        outline_json["vertex_count"],
        passed,
        note,
    )


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    scene_dir = repo_root / "examples" / "photos" / "synthetic_pattern_set"
    manifest = json.loads((scene_dir / "manifest.json").read_text())
    scenes = [s["name"] for s in manifest["scenes"]]

    results = []
    for name in scenes:
        print(f"\n=== {name} ===")
        try:
            res = validate_scene(name, scene_dir)
        except subprocess.CalledProcessError as e:
            print(f"  CLI failed: {e}")
            results.append(SceneResult(name, math.inf, 0.0, 0.0, math.inf, 0, False, "CLI failed"))
            continue
        except Exception as e:
            print(f"  validation failed: {e}")
            results.append(SceneResult(name, math.inf, 0.0, 0.0, math.inf, 0, False, str(e)))
            continue
        results.append(res)
        tag = "PASS" if res.passed else "FAIL"
        print(
            f"  [{tag}] Hausdorff = {res.hausdorff_mm:.3f} mm, "
            f"area = {res.area_mm2:.1f} (gt {res.gt_area_mm2:.1f}, err {res.area_err_frac*100:.2f}%), "
            f"verts = {res.vertex_count}  {res.note}"
        )

    passed = sum(1 for r in results if r.passed)
    print(f"\n{passed}/{len(results)} scenes passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
