#!/usr/bin/env python3

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


@dataclass(frozen=True)
class SceneSpec:
    name: str
    board_scale: float
    board_xy: tuple[int, int]
    piece_offset: tuple[int, int]
    perspective_dst: np.ndarray
    blur_sigma: float
    noise_sigma: float
    shadow_strength: float
    board_occluder: bool = False
    crop_top: int = 0


PLANE_W = 2600
PLANE_H = 1800
PHOTO_W = 2550
PHOTO_H = 1800

SCENES = [
    SceneSpec(
        name="easy",
        board_scale=0.46,
        board_xy=(210, 200),
        piece_offset=(0, 0),
        perspective_dst=np.array([[160, 140], [2410, 140], [2320, 1660], [120, 1540]], dtype=np.float32),
        blur_sigma=0.6,
        noise_sigma=1.8,
        shadow_strength=0.14,
    ),
    SceneSpec(
        name="oblique",
        board_scale=0.44,
        board_xy=(220, 220),
        piece_offset=(0, 0),
        perspective_dst=np.array([[220, 180], [2470, 70], [2310, 1700], [70, 1510]], dtype=np.float32),
        blur_sigma=0.8,
        noise_sigma=2.2,
        shadow_strength=0.22,
    ),
    SceneSpec(
        name="edge_board",
        board_scale=0.43,
        board_xy=(60, 230),
        piece_offset=(40, 20),
        perspective_dst=np.array([[80, 130], [2450, 170], [2390, 1720], [-70, 1540]], dtype=np.float32),
        blur_sigma=0.7,
        noise_sigma=2.4,
        shadow_strength=0.18,
    ),
    SceneSpec(
        name="partial_occlusion",
        board_scale=0.44,
        board_xy=(240, 210),
        piece_offset=(-80, 40),
        perspective_dst=np.array([[200, 120], [2440, 110], [2330, 1710], [90, 1560]], dtype=np.float32),
        blur_sigma=0.9,
        noise_sigma=2.6,
        shadow_strength=0.23,
        board_occluder=True,
    ),
    SceneSpec(
        name="low_light",
        board_scale=0.42,
        board_xy=(230, 230),
        piece_offset=(30, 30),
        perspective_dst=np.array([[180, 200], [2430, 120], [2350, 1690], [110, 1600]], dtype=np.float32),
        blur_sigma=1.1,
        noise_sigma=4.0,
        shadow_strength=0.28,
        crop_top=20,
    ),
]


def build_plane_scene(board_path: Path, spec: SceneSpec) -> np.ndarray:
    board = cv2.imread(str(board_path), cv2.IMREAD_COLOR)
    if board is None:
        raise RuntimeError(f"failed to read board asset: {board_path}")

    plane = np.full((PLANE_H, PLANE_W, 3), 238, dtype=np.uint8)
    add_paper_texture(plane, seed=7)
    draw_mat_grid(plane)

    board = cv2.resize(
        board,
        (round(board.shape[1] * spec.board_scale), round(board.shape[0] * spec.board_scale)),
        interpolation=cv2.INTER_AREA,
    )
    board_x, board_y = spec.board_xy
    board_h, board_w = board.shape[:2]
    plane[board_y : board_y + board_h, board_x : board_x + board_w] = board

    piece = base_piece() + np.array(spec.piece_offset, dtype=np.int32)
    cv2.fillPoly(plane, [piece], (34, 44, 62))
    cv2.polylines(plane, [piece], True, (20, 28, 40), 8, cv2.LINE_AA)
    add_piece_details(plane, piece)
    add_soft_shadow(plane, piece, strength=spec.shadow_strength)

    if spec.board_occluder:
        add_board_occluder(plane, board_x, board_y, board_w, board_h)

    return plane


def base_piece() -> np.ndarray:
    return np.array(
        [
            [1550, 450],
            [2120, 410],
            [2250, 690],
            [2140, 1130],
            [1770, 1260],
            [1480, 1070],
            [1415, 760],
        ],
        dtype=np.int32,
    )


def add_paper_texture(image: np.ndarray, seed: int) -> None:
    noise = np.random.default_rng(seed).normal(0, 3.0, image.shape).astype(np.int16)
    textured = np.clip(image.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    image[:] = textured


def draw_mat_grid(image: np.ndarray) -> None:
    grid_color = (210, 217, 221)
    major_color = (192, 201, 206)
    for x in range(0, image.shape[1], 90):
        color = major_color if x % 450 == 0 else grid_color
        cv2.line(image, (x, 0), (x, image.shape[0]), color, 1, cv2.LINE_AA)
    for y in range(0, image.shape[0], 90):
        color = major_color if y % 450 == 0 else grid_color
        cv2.line(image, (0, y), (image.shape[1], y), color, 1, cv2.LINE_AA)


def add_piece_details(image: np.ndarray, piece: np.ndarray) -> None:
    mask = np.zeros(image.shape[:2], dtype=np.uint8)
    cv2.fillPoly(mask, [piece], 255)

    for x in range(1380, 2300, 34):
        cv2.line(image, (x, 320), (x - 220, 1430), (45, 58, 78), 1, cv2.LINE_AA)

    highlight = np.zeros_like(image)
    cv2.ellipse(highlight, (1830, 760), (340, 180), -18, 0, 360, (50, 58, 84), -1, cv2.LINE_AA)
    blurred = cv2.GaussianBlur(highlight, (0, 0), 60)
    image[:] = np.where(mask[..., None] > 0, cv2.addWeighted(image, 1.0, blurred, 0.18, 0), image)


def add_soft_shadow(image: np.ndarray, piece: np.ndarray, strength: float) -> None:
    shadow = np.zeros_like(image)
    shifted = piece + np.array([80, 90], dtype=np.int32)
    cv2.fillPoly(shadow, [shifted], (0, 0, 0))
    shadow = cv2.GaussianBlur(shadow, (0, 0), 65)
    image[:] = cv2.addWeighted(image, 1.0, shadow, strength, 0)


def add_board_occluder(image: np.ndarray, board_x: int, board_y: int, board_w: int, board_h: int) -> None:
    occluder = np.array(
        [
            [board_x + int(board_w * 0.78), board_y + int(board_h * 0.40)],
            [board_x + int(board_w * 1.04), board_y + int(board_h * 0.34)],
            [board_x + int(board_w * 1.02), board_y + int(board_h * 0.62)],
            [board_x + int(board_w * 0.76), board_y + int(board_h * 0.66)],
        ],
        dtype=np.int32,
    )
    cv2.fillPoly(image, [occluder], (56, 72, 94))
    cv2.polylines(image, [occluder], True, (36, 48, 66), 5, cv2.LINE_AA)


def perspective_photo(plane: np.ndarray, spec: SceneSpec) -> np.ndarray:
    src = np.array(
        [[0, 0], [PLANE_W - 1, 0], [PLANE_W - 1, PLANE_H - 1], [0, PLANE_H - 1]],
        dtype=np.float32,
    )
    homography = cv2.getPerspectiveTransform(src, spec.perspective_dst)

    photo = np.full((PHOTO_H, PHOTO_W, 3), 248, dtype=np.uint8)
    photo = cv2.warpPerspective(
        plane,
        homography,
        (PHOTO_W, PHOTO_H),
        dst=photo,
        borderMode=cv2.BORDER_TRANSPARENT,
    )

    add_lighting(photo, spec)
    if spec.blur_sigma > 0:
        photo = cv2.GaussianBlur(photo, (0, 0), spec.blur_sigma)
    photo = add_sensor_noise(photo, spec.noise_sigma)
    if spec.crop_top > 0:
        photo[: spec.crop_top, :] = 247
    return photo


def add_lighting(image: np.ndarray, spec: SceneSpec) -> None:
    h, w = image.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    gradient = 0.92 + 0.16 * (xx / w) - 0.10 * (yy / h)
    vignette = 1.0 - 0.12 * (((xx - w / 2) / w) ** 2 + ((yy - h / 2) / h) ** 2)
    if spec.name == "low_light":
        hotspot = 0.82 + 0.35 * np.exp(-(((xx - 0.75 * w) / (0.32 * w)) ** 2 + ((yy - 0.30 * h) / (0.26 * h)) ** 2))
        lighting = gradient * vignette * hotspot
    else:
        lighting = gradient * vignette
    image[:] = np.clip(image.astype(np.float32) * np.clip(lighting, 0.60, 1.18)[..., None], 0, 255).astype(np.uint8)


def add_sensor_noise(image: np.ndarray, sigma: float) -> np.ndarray:
    noise = np.random.default_rng(11).normal(0, sigma, image.shape).astype(np.float32)
    return np.clip(image.astype(np.float32) + noise, 0, 255).astype(np.uint8)


def write_manifest(out_dir: Path, files: list[Path]) -> None:
    manifest = {
        "dataset": "synthetic_refboard_set_v1",
        "files": [path.name for path in files],
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (out_dir / "README.md").write_text(
        "\n".join(
            [
                "# Synthetic Refboard Set",
                "",
                "This folder contains a small synthetic capture set for the printable board detector.",
                "",
                "Scenes:",
                "- `easy.png`: low-stress, near-fronto-parallel board.",
                "- `oblique.png`: stronger perspective, moderate shadow.",
                "- `edge_board.png`: board closer to the frame edge.",
                "- `partial_occlusion.png`: board partly occluded but still detectable.",
                "- `low_light.png`: noisier, dimmer scene with stronger lighting variation.",
            ]
        )
        + "\n"
    )


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    board_path = repo_root / "assets" / "refboard_v1" / "refboard_v1_letter.png"

    out_dir = repo_root / "examples" / "photos" / "synthetic_refboard_set"
    out_dir.mkdir(parents=True, exist_ok=True)

    written: list[Path] = []
    for spec in SCENES:
        plane = build_plane_scene(board_path, spec)
        photo = perspective_photo(plane, spec)
        out_path = out_dir / f"{spec.name}.png"
        cv2.imwrite(str(out_path), photo)
        written.append(out_path)
        print(out_path)

    write_manifest(out_dir, written)

    legacy_path = repo_root / "examples" / "photos" / "synthetic_refboard_scene.png"
    shutil.copyfile(out_dir / "oblique.png", legacy_path)


if __name__ == "__main__":
    main()
