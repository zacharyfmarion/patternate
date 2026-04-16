#!/usr/bin/env python3
"""Generate synthetic pattern-piece capture scenes with ground-truth
polygons in board-mm coordinates.

Each scene is rendered on a flat "plane" in known millimetre
coordinates, then perspective-warped to simulate a handheld photograph.
The ground-truth piece polygon is written alongside each image.

Board-mm convention: origin = top-left corner of the printable board,
x-right, y-down, same frame used by the Rust pipeline's rectified
output.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, List, Tuple

import cv2
import numpy as np


# ---------------------------------------------------------------------------
# Physical constants (must match assets/refboard_v1/refboard_v1.json)
# ---------------------------------------------------------------------------

BOARD_WIDTH_MM = 11 * 15.0  # squares_x × square_size_mm
BOARD_HEIGHT_MM = 8 * 15.0
BOARD_QUIET_ZONE_MM = 8.0

# refboard_v1_letter.png was exported at 300 DPI ⇒ 11.811 px per mm.
BOARD_PNG_PX_PER_MM = 300.0 / 25.4

# Plane scale — 1 mm of the flat work surface = PLANE_PX_PER_MM pixels.
PLANE_PX_PER_MM = 10.0

# Lattice-origin offset within refboard_v1_letter.png, derived from
# scripts/generate_refboard_v1.py:
#   board_x_px = (mm_to_px(215.9) - (mm_to_px(165) + 2*mm_to_px(8))) // 2 = 206 px
#   board_y_px = mm_to_px(14) + 100                                        = 265 px
#   quiet_zone_px = mm_to_px(8)                                            =  94 px
#   lattice_px = (board_x_px + quiet_zone_px, board_y_px + quiet_zone_px)  = (300, 359) px
# Convert to mm (300 DPI):  (300 / 300 * 25.4, 359 / 300 * 25.4) ≈ (25.400, 30.393) mm
LATTICE_OFFSET_IN_BOARD_PNG_MM = (25.4, 30.393)


# ---------------------------------------------------------------------------
# Scene description
# ---------------------------------------------------------------------------

PieceFn = Callable[[], np.ndarray]


@dataclass(frozen=True)
class PatternScene:
    name: str
    description: str
    plane_width_mm: float
    plane_height_mm: float
    board_origin_plane_mm: Tuple[float, float]
    board_angle_deg: float  # rotation of the board within the plane
    piece_polygon_plane_mm: np.ndarray
    bg_color: Tuple[int, int, int]       # BGR
    piece_color: Tuple[int, int, int]    # BGR
    shadow_strength: float
    add_grid: bool
    extra_occluder_plane_mm: np.ndarray | None
    # Camera perspective warp: dst quad corners in the photo frame for
    # the plane's (0,0) → (w,0) → (w,h) → (0,h) corners.
    perspective_dst_px: np.ndarray
    photo_size_px: Tuple[int, int]
    blur_sigma: float
    noise_sigma: float
    vignette_strength: float
    hotspot: bool


# ---------------------------------------------------------------------------
# Piece generators (all return Nx2 arrays in board-mm relative coords;
# callers add the board origin to get plane-mm)
# ---------------------------------------------------------------------------


def piece_polygon_standard() -> np.ndarray:
    # A 7-sided asymmetric piece roughly 100×90 mm.
    return np.array(
        [
            [0.0, 0.0],
            [85.0, 4.0],
            [105.0, 34.0],
            [96.0, 78.0],
            [55.0, 92.0],
            [20.0, 72.0],
            [5.0, 38.0],
        ],
        dtype=np.float64,
    )


def piece_polygon_curved() -> np.ndarray:
    # Smooth ellipse-ish shape with 128 samples so RDP has room to work.
    n = 128
    rx = 55.0
    ry = 38.0
    pts = []
    for i in range(n):
        t = 2.0 * math.pi * i / n
        x = rx * math.cos(t) + 4.0 * math.cos(3 * t)
        y = ry * math.sin(t) + 2.5 * math.sin(5 * t)
        pts.append([x + 60.0, y + 45.0])
    return np.array(pts, dtype=np.float64)


def piece_polygon_notched() -> np.ndarray:
    # Rectangle with a V-notch on the top edge and a sharp corner.
    return np.array(
        [
            [0.0, 0.0],
            [40.0, 0.0],
            [52.0, 18.0],   # notch tip
            [64.0, 0.0],
            [108.0, 0.0],
            [118.0, 42.0],
            [102.0, 78.0],
            [56.0, 94.0],   # sharp corner
            [4.0, 82.0],
            [-2.0, 36.0],
        ],
        dtype=np.float64,
    )


# ---------------------------------------------------------------------------
# Scene definitions
# ---------------------------------------------------------------------------


def _default_perspective(size_px: Tuple[int, int], skew: float = 0.02) -> np.ndarray:
    w, h = size_px
    return np.array(
        [
            [int(w * 0.04), int(h * 0.05)],
            [int(w * 0.97), int(h * (0.05 + skew))],
            [int(w * 0.96), int(h * 0.97)],
            [int(w * 0.03), int(h * (0.97 - skew))],
        ],
        dtype=np.float32,
    )


SCENES: List[PatternScene] = [
    PatternScene(
        name="dark_on_light",
        description="Dark canvas piece on light paper mat; near fronto-parallel.",
        plane_width_mm=340.0,
        plane_height_mm=210.0,
        board_origin_plane_mm=(20.0, 35.0),
        board_angle_deg=0.0,
        piece_polygon_plane_mm=piece_polygon_standard() + np.array([210.0, 55.0]),
        bg_color=(238, 236, 232),
        piece_color=(62, 50, 40),
        shadow_strength=0.18,
        add_grid=True,
        extra_occluder_plane_mm=None,
        perspective_dst_px=_default_perspective((2400, 1600), skew=0.015),
        photo_size_px=(2400, 1600),
        blur_sigma=0.6,
        noise_sigma=1.8,
        vignette_strength=0.10,
        hotspot=False,
    ),
    PatternScene(
        name="light_on_dark",
        description="Cream pattern piece on charcoal cutting mat (inverse contrast).",
        plane_width_mm=340.0,
        plane_height_mm=210.0,
        board_origin_plane_mm=(18.0, 35.0),
        board_angle_deg=0.0,
        piece_polygon_plane_mm=piece_polygon_standard() + np.array([205.0, 55.0]),
        bg_color=(55, 58, 62),
        piece_color=(235, 225, 205),
        shadow_strength=0.10,
        add_grid=False,
        extra_occluder_plane_mm=None,
        perspective_dst_px=_default_perspective((2400, 1600), skew=0.02),
        photo_size_px=(2400, 1600),
        blur_sigma=0.6,
        noise_sigma=2.0,
        vignette_strength=0.14,
        hotspot=False,
    ),
    PatternScene(
        name="curved",
        description="Smooth-curved piece — tests simplification quality.",
        plane_width_mm=330.0,
        plane_height_mm=210.0,
        board_origin_plane_mm=(22.0, 40.0),
        board_angle_deg=0.0,
        piece_polygon_plane_mm=piece_polygon_curved() + np.array([200.0, 50.0]),
        bg_color=(232, 230, 226),
        piece_color=(70, 88, 118),
        shadow_strength=0.16,
        add_grid=True,
        extra_occluder_plane_mm=None,
        perspective_dst_px=_default_perspective((2400, 1600), skew=0.01),
        photo_size_px=(2400, 1600),
        blur_sigma=0.7,
        noise_sigma=2.0,
        vignette_strength=0.11,
        hotspot=False,
    ),
    PatternScene(
        name="notched",
        description="Piece with inward V-notch and sharp concave point.",
        plane_width_mm=340.0,
        plane_height_mm=220.0,
        board_origin_plane_mm=(20.0, 40.0),
        board_angle_deg=0.0,
        piece_polygon_plane_mm=piece_polygon_notched() + np.array([200.0, 60.0]),
        bg_color=(240, 238, 234),
        piece_color=(46, 62, 96),
        shadow_strength=0.20,
        add_grid=True,
        extra_occluder_plane_mm=None,
        perspective_dst_px=_default_perspective((2400, 1600), skew=0.025),
        photo_size_px=(2400, 1600),
        blur_sigma=0.7,
        noise_sigma=2.2,
        vignette_strength=0.10,
        hotspot=False,
    ),
    PatternScene(
        name="near_occluder",
        description="Piece sits next to another dark object — tests component selection.",
        plane_width_mm=360.0,
        plane_height_mm=220.0,
        board_origin_plane_mm=(20.0, 40.0),
        board_angle_deg=0.0,
        piece_polygon_plane_mm=piece_polygon_standard() + np.array([215.0, 60.0]),
        bg_color=(240, 238, 234),
        piece_color=(42, 52, 74),
        shadow_strength=0.20,
        add_grid=True,
        extra_occluder_plane_mm=np.array(
            [
                [330.0, 30.0],
                [355.0, 30.0],
                [355.0, 80.0],
                [330.0, 80.0],
            ],
            dtype=np.float64,
        ),
        perspective_dst_px=_default_perspective((2400, 1600), skew=0.018),
        photo_size_px=(2400, 1600),
        blur_sigma=0.7,
        noise_sigma=2.0,
        vignette_strength=0.10,
        hotspot=False,
    ),
    PatternScene(
        name="rotated_board",
        description="Board rotated ~30° within the plane; piece at arbitrary angle.",
        plane_width_mm=360.0,
        plane_height_mm=260.0,
        board_origin_plane_mm=(60.0, 50.0),
        board_angle_deg=30.0,
        piece_polygon_plane_mm=piece_polygon_standard() + np.array([220.0, 140.0]),
        bg_color=(240, 236, 230),
        piece_color=(54, 46, 38),
        shadow_strength=0.18,
        add_grid=True,
        extra_occluder_plane_mm=None,
        perspective_dst_px=_default_perspective((2400, 1700), skew=0.02),
        photo_size_px=(2400, 1700),
        blur_sigma=0.7,
        noise_sigma=2.2,
        vignette_strength=0.12,
        hotspot=False,
    ),
    PatternScene(
        name="multi_lighting",
        description="Strong vignette + hotspot — stresses background estimation.",
        plane_width_mm=340.0,
        plane_height_mm=220.0,
        board_origin_plane_mm=(22.0, 40.0),
        board_angle_deg=0.0,
        piece_polygon_plane_mm=piece_polygon_standard() + np.array([210.0, 65.0]),
        bg_color=(232, 228, 222),
        piece_color=(40, 48, 68),
        shadow_strength=0.26,
        add_grid=True,
        extra_occluder_plane_mm=None,
        perspective_dst_px=_default_perspective((2400, 1600), skew=0.03),
        photo_size_px=(2400, 1600),
        blur_sigma=1.1,
        noise_sigma=3.5,
        vignette_strength=0.28,
        hotspot=True,
    ),
]


# ---------------------------------------------------------------------------
# Plane rendering
# ---------------------------------------------------------------------------


def render_plane(scene: PatternScene, board_asset_path: Path) -> np.ndarray:
    w_px = round(scene.plane_width_mm * PLANE_PX_PER_MM)
    h_px = round(scene.plane_height_mm * PLANE_PX_PER_MM)
    plane = np.full((h_px, w_px, 3), scene.bg_color, dtype=np.uint8)
    add_paper_texture(plane, seed=hash(scene.name) & 0xFFFF, amplitude=2.5)

    if scene.add_grid:
        draw_mat_grid(plane)

    _blit_board(plane, board_asset_path, scene)

    piece_px = (scene.piece_polygon_plane_mm * PLANE_PX_PER_MM).round().astype(np.int32)
    cv2.fillPoly(plane, [piece_px], scene.piece_color, lineType=cv2.LINE_AA)
    edge_color = tuple(max(c - 20, 0) for c in scene.piece_color)
    cv2.polylines(plane, [piece_px], True, edge_color, 3, cv2.LINE_AA)
    add_soft_shadow(plane, piece_px, strength=scene.shadow_strength)

    if scene.extra_occluder_plane_mm is not None:
        occl = (scene.extra_occluder_plane_mm * PLANE_PX_PER_MM).round().astype(np.int32)
        occl_color = (45, 55, 70)
        cv2.fillPoly(plane, [occl], occl_color, lineType=cv2.LINE_AA)
        cv2.polylines(plane, [occl], True, (30, 38, 50), 2, cv2.LINE_AA)

    return plane


def _blit_board(plane: np.ndarray, board_asset_path: Path, scene: PatternScene) -> None:
    board = cv2.imread(str(board_asset_path), cv2.IMREAD_COLOR)
    if board is None:
        raise RuntimeError(f"failed to load board: {board_asset_path}")

    # Scale the 300 DPI board asset down to the plane scale.
    scale = PLANE_PX_PER_MM / BOARD_PNG_PX_PER_MM
    board = cv2.resize(
        board,
        (round(board.shape[1] * scale), round(board.shape[0] * scale)),
        interpolation=cv2.INTER_AREA,
    )

    # The board PNG embeds the lattice at a known offset from its own
    # top-left corner (see LATTICE_OFFSET_IN_BOARD_PNG_MM). To place the
    # ground-truth lattice origin at `board_origin_plane_mm`, we shift
    # the PNG's top-left by the negative of that offset.
    ox_mm, oy_mm = LATTICE_OFFSET_IN_BOARD_PNG_MM
    bx_mm, by_mm = scene.board_origin_plane_mm
    bx_px = round((bx_mm - ox_mm) * PLANE_PX_PER_MM)
    by_px = round((by_mm - oy_mm) * PLANE_PX_PER_MM)

    if abs(scene.board_angle_deg) < 1e-6:
        _paste(plane, board, bx_px, by_px)
    else:
        origin_px_in_board = (
            round(ox_mm * PLANE_PX_PER_MM),
            round(oy_mm * PLANE_PX_PER_MM),
        )
        rotated, offset = _rotate_with_origin(board, origin_px_in_board, scene.board_angle_deg)
        target_origin_px = (
            round(bx_mm * PLANE_PX_PER_MM),
            round(by_mm * PLANE_PX_PER_MM),
        )
        top_left = (target_origin_px[0] - offset[0], target_origin_px[1] - offset[1])
        _paste_with_mask(plane, rotated, top_left[0], top_left[1])


def _paste(dst: np.ndarray, src: np.ndarray, x: int, y: int) -> None:
    h, w = src.shape[:2]
    H, W = dst.shape[:2]
    x0 = max(x, 0)
    y0 = max(y, 0)
    x1 = min(x + w, W)
    y1 = min(y + h, H)
    if x1 <= x0 or y1 <= y0:
        return
    dst[y0:y1, x0:x1] = src[y0 - y : y1 - y, x0 - x : x1 - x]


def _rotate_with_origin(
    img: np.ndarray,
    origin_px: Tuple[int, int],
    angle_deg: float,
) -> Tuple[np.ndarray, Tuple[int, int]]:
    h, w = img.shape[:2]
    M = cv2.getRotationMatrix2D(origin_px, -angle_deg, 1.0)

    corners = np.array([[0, 0, 1], [w, 0, 1], [w, h, 1], [0, h, 1]], dtype=np.float32)
    transformed = (M @ corners.T).T
    min_x = math.floor(transformed[:, 0].min())
    min_y = math.floor(transformed[:, 1].min())
    max_x = math.ceil(transformed[:, 0].max())
    max_y = math.ceil(transformed[:, 1].max())

    M[0, 2] -= min_x
    M[1, 2] -= min_y
    new_w = max_x - min_x
    new_h = max_y - min_y
    rotated = cv2.warpAffine(
        img, M, (new_w, new_h), flags=cv2.INTER_LINEAR, borderValue=(255, 255, 255)
    )
    offset = (origin_px[0] - min_x, origin_px[1] - min_y)
    return rotated, offset


def _paste_with_mask(dst: np.ndarray, src: np.ndarray, x: int, y: int) -> None:
    h, w = src.shape[:2]
    H, W = dst.shape[:2]
    x0 = max(x, 0)
    y0 = max(y, 0)
    x1 = min(x + w, W)
    y1 = min(y + h, H)
    if x1 <= x0 or y1 <= y0:
        return
    region = src[y0 - y : y1 - y, x0 - x : x1 - x]
    # Treat pure white as transparent (the rotation border fill).
    mask = np.any(region < 250, axis=2)
    dst[y0:y1, x0:x1][mask] = region[mask]


# ---------------------------------------------------------------------------
# Texture / lighting helpers
# ---------------------------------------------------------------------------


def add_paper_texture(image: np.ndarray, seed: int, amplitude: float = 3.0) -> None:
    noise = np.random.default_rng(seed).normal(0, amplitude, image.shape).astype(np.int16)
    image[:] = np.clip(image.astype(np.int16) + noise, 0, 255).astype(np.uint8)


def draw_mat_grid(image: np.ndarray) -> None:
    minor = (210, 217, 221)
    major = (192, 201, 206)
    step = max(1, round(10.0 * PLANE_PX_PER_MM))
    big_step = step * 5
    for x in range(0, image.shape[1], step):
        color = major if x % big_step == 0 else minor
        cv2.line(image, (x, 0), (x, image.shape[0]), color, 1, cv2.LINE_AA)
    for y in range(0, image.shape[0], step):
        color = major if y % big_step == 0 else minor
        cv2.line(image, (0, y), (image.shape[1], y), color, 1, cv2.LINE_AA)


def add_soft_shadow(image: np.ndarray, piece_px: np.ndarray, strength: float) -> None:
    offset = np.array([round(8 * PLANE_PX_PER_MM / 10), round(9 * PLANE_PX_PER_MM / 10)])
    shifted = piece_px + offset
    shadow = np.zeros_like(image)
    cv2.fillPoly(shadow, [shifted], (0, 0, 0))
    shadow = cv2.GaussianBlur(shadow, (0, 0), max(8, 6 * PLANE_PX_PER_MM / 10))
    image[:] = cv2.addWeighted(image, 1.0, shadow, strength, 0)


# ---------------------------------------------------------------------------
# Perspective-warp to the simulated photo
# ---------------------------------------------------------------------------


def warp_to_photo(plane: np.ndarray, scene: PatternScene) -> Tuple[np.ndarray, np.ndarray]:
    plane_h, plane_w = plane.shape[:2]
    src = np.array(
        [[0, 0], [plane_w - 1, 0], [plane_w - 1, plane_h - 1], [0, plane_h - 1]],
        dtype=np.float32,
    )
    H_plane_px_to_photo_px = cv2.getPerspectiveTransform(src, scene.perspective_dst_px)

    photo = np.full((scene.photo_size_px[1], scene.photo_size_px[0], 3), 248, dtype=np.uint8)
    photo = cv2.warpPerspective(
        plane,
        H_plane_px_to_photo_px,
        scene.photo_size_px,
        dst=photo,
        borderMode=cv2.BORDER_TRANSPARENT,
    )

    apply_lighting(photo, scene)
    if scene.blur_sigma > 0:
        photo = cv2.GaussianBlur(photo, (0, 0), scene.blur_sigma)
    photo = add_sensor_noise(photo, scene.noise_sigma)

    return photo, H_plane_px_to_photo_px


def apply_lighting(image: np.ndarray, scene: PatternScene) -> None:
    h, w = image.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    base = 1.0
    vignette = 1.0 - scene.vignette_strength * (
        ((xx - w / 2) / w) ** 2 + ((yy - h / 2) / h) ** 2
    )
    gradient = 0.92 + 0.12 * (xx / w) - 0.06 * (yy / h)
    if scene.hotspot:
        hotspot = 0.85 + 0.45 * np.exp(
            -(((xx - 0.72 * w) / (0.28 * w)) ** 2 + ((yy - 0.30 * h) / (0.24 * h)) ** 2)
        )
        lighting = base * gradient * vignette * hotspot
    else:
        lighting = base * gradient * vignette
    image[:] = np.clip(
        image.astype(np.float32) * np.clip(lighting, 0.55, 1.25)[..., None], 0, 255
    ).astype(np.uint8)


def add_sensor_noise(image: np.ndarray, sigma: float) -> np.ndarray:
    if sigma <= 0:
        return image
    noise = np.random.default_rng(7).normal(0, sigma, image.shape).astype(np.float32)
    return np.clip(image.astype(np.float32) + noise, 0, 255).astype(np.uint8)


# ---------------------------------------------------------------------------
# Ground-truth polygon conversion (plane-mm → board-mm)
# ---------------------------------------------------------------------------


def piece_board_mm(scene: PatternScene) -> np.ndarray:
    bx_mm, by_mm = scene.board_origin_plane_mm
    theta = math.radians(scene.board_angle_deg)
    # Inverse rotation (plane-mm → board-mm).
    cos_t = math.cos(-theta)
    sin_t = math.sin(-theta)
    out = []
    for x, y in scene.piece_polygon_plane_mm:
        xx = x - bx_mm
        yy = y - by_mm
        rx = xx * cos_t - yy * sin_t
        ry = xx * sin_t + yy * cos_t
        out.append([rx, ry])
    return np.array(out, dtype=np.float64)


# ---------------------------------------------------------------------------
# Manifest writing
# ---------------------------------------------------------------------------


def write_sidecars(out_dir: Path, scene: PatternScene, photo_path: Path) -> None:
    gt_poly_board_mm = piece_board_mm(scene)
    sidecar = {
        "scene": scene.name,
        "description": scene.description,
        "board_origin_plane_mm": list(scene.board_origin_plane_mm),
        "board_angle_deg": scene.board_angle_deg,
        "board_width_mm": BOARD_WIDTH_MM,
        "board_height_mm": BOARD_HEIGHT_MM,
        "plane_size_mm": [scene.plane_width_mm, scene.plane_height_mm],
        "photo_size_px": list(scene.photo_size_px),
        "ground_truth_polygon_plane_mm": scene.piece_polygon_plane_mm.tolist(),
        "ground_truth_polygon_board_mm": gt_poly_board_mm.tolist(),
        "image": photo_path.name,
    }
    (out_dir / f"{scene.name}.json").write_text(json.dumps(sidecar, indent=2) + "\n")


def write_manifest(out_dir: Path, scenes: List[PatternScene]) -> None:
    manifest = {
        "dataset": "synthetic_pattern_set_v1",
        "plane_px_per_mm": PLANE_PX_PER_MM,
        "board_asset": "refboard_v1_letter.png",
        "scenes": [
            {
                "name": s.name,
                "description": s.description,
                "image": f"{s.name}.png",
                "sidecar": f"{s.name}.json",
            }
            for s in scenes
        ],
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (out_dir / "README.md").write_text(
        "# Synthetic Pattern Set\n\n"
        "Synthetic handheld photos of a printable ChArUco board beside a\n"
        "pattern piece, with ground-truth piece polygons in board-mm coords.\n\n"
        "Each `<name>.png` has a matching `<name>.json` sidecar containing\n"
        "`ground_truth_polygon_board_mm` for outline-accuracy testing.\n"
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    board_asset = repo_root / "assets" / "refboard_v1" / "refboard_v1_letter.png"
    out_dir = repo_root / "examples" / "photos" / "synthetic_pattern_set"
    out_dir.mkdir(parents=True, exist_ok=True)

    for scene in SCENES:
        plane = render_plane(scene, board_asset)
        photo, _ = warp_to_photo(plane, scene)
        photo_path = out_dir / f"{scene.name}.png"
        cv2.imwrite(str(photo_path), photo)
        write_sidecars(out_dir, scene, photo_path)
        print(photo_path)

    write_manifest(out_dir, SCENES)


if __name__ == "__main__":
    main()
