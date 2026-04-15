#!/usr/bin/env python3

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np


def build_plane_scene(board_path: Path) -> np.ndarray:
    board = cv2.imread(str(board_path), cv2.IMREAD_COLOR)
    if board is None:
        raise RuntimeError(f"failed to read board asset: {board_path}")

    plane_h, plane_w = 1800, 2600
    plane = np.full((plane_h, plane_w, 3), 238, dtype=np.uint8)

    add_paper_texture(plane)
    draw_mat_grid(plane)

    board_scale = 0.44
    board = cv2.resize(
        board,
        (round(board.shape[1] * board_scale), round(board.shape[0] * board_scale)),
        interpolation=cv2.INTER_AREA,
    )
    board_x, board_y = 220, 220
    board_h, board_w = board.shape[:2]
    plane[board_y : board_y + board_h, board_x : board_x + board_w] = board

    piece = np.array(
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
    cv2.fillPoly(plane, [piece], (34, 44, 62))
    cv2.polylines(plane, [piece], True, (20, 28, 40), 8, cv2.LINE_AA)

    add_piece_details(plane, piece)
    add_soft_shadow(plane, piece)

    return plane


def add_paper_texture(image: np.ndarray) -> None:
    noise = np.random.default_rng(7).normal(0, 3.0, image.shape).astype(np.int16)
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

    for x in range(1400, 2280, 32):
        cv2.line(image, (x, 330), (x - 220, 1410), (45, 58, 78), 1, cv2.LINE_AA)

    highlight = np.zeros_like(image)
    cv2.ellipse(highlight, (1830, 760), (340, 180), -18, 0, 360, (50, 58, 84), -1, cv2.LINE_AA)
    blurred = cv2.GaussianBlur(highlight, (0, 0), 60)
    image[:] = np.where(mask[..., None] > 0, cv2.addWeighted(image, 1.0, blurred, 0.18, 0), image)


def add_soft_shadow(image: np.ndarray, piece: np.ndarray) -> None:
    shadow = np.zeros_like(image)
    shifted = piece + np.array([80, 90], dtype=np.int32)
    cv2.fillPoly(shadow, [shifted], (0, 0, 0))
    shadow = cv2.GaussianBlur(shadow, (0, 0), 65)
    image[:] = cv2.addWeighted(image, 1.0, shadow, 0.22, 0)


def perspective_photo(plane: np.ndarray) -> np.ndarray:
    plane_h, plane_w = plane.shape[:2]
    src = np.array(
        [[0, 0], [plane_w - 1, 0], [plane_w - 1, plane_h - 1], [0, plane_h - 1]],
        dtype=np.float32,
    )
    dst = np.array(
        [[220, 180], [2470, 70], [2310, 1700], [70, 1510]],
        dtype=np.float32,
    )
    homography = cv2.getPerspectiveTransform(src, dst)

    photo = np.full((1800, 2550, 3), 248, dtype=np.uint8)
    photo = cv2.warpPerspective(
        plane,
        homography,
        (photo.shape[1], photo.shape[0]),
        dst=photo,
        borderMode=cv2.BORDER_TRANSPARENT,
    )

    add_lighting(photo)
    photo = cv2.GaussianBlur(photo, (0, 0), 0.8)
    return add_sensor_noise(photo)


def add_lighting(image: np.ndarray) -> None:
    h, w = image.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    gradient = 0.94 + 0.14 * (xx / w) - 0.08 * (yy / h)
    vignette = 1.0 - 0.10 * (((xx - w / 2) / w) ** 2 + ((yy - h / 2) / h) ** 2)
    lighting = np.clip(gradient * vignette, 0.75, 1.15)
    image[:] = np.clip(image.astype(np.float32) * lighting[..., None], 0, 255).astype(np.uint8)


def add_sensor_noise(image: np.ndarray) -> np.ndarray:
    noise = np.random.default_rng(11).normal(0, 2.2, image.shape).astype(np.float32)
    return np.clip(image.astype(np.float32) + noise, 0, 255).astype(np.uint8)


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    board_path = repo_root / "assets" / "refboard_v1" / "refboard_v1_letter.png"
    out_path = repo_root / "examples" / "photos" / "synthetic_refboard_scene.png"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    plane = build_plane_scene(board_path)
    photo = perspective_photo(plane)
    cv2.imwrite(str(out_path), photo)
    print(out_path)


if __name__ == "__main__":
    main()
