#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Detect a ChArUco reference board")
    parser.add_argument("--input", required=True)
    parser.add_argument("--board-spec", required=True)
    parser.add_argument("--output-json", required=True)
    parser.add_argument("--output-overlay", required=True)
    return parser.parse_args()


def load_board(spec_path: Path):
    spec = json.loads(spec_path.read_text())
    dictionary_name = spec["marker_dictionary"]
    dictionary = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, dictionary_name))
    board = cv2.aruco.CharucoBoard(
        (spec["squares_x"], spec["squares_y"]),
        spec["square_size_mm"],
        spec["marker_size_mm"],
        dictionary,
    )
    return spec, board, dictionary


def detect_board(image_bgr: np.ndarray, spec: dict, board, dictionary):
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    detector = cv2.aruco.ArucoDetector(dictionary, cv2.aruco.DetectorParameters())
    marker_corners, marker_ids, _rejected = detector.detectMarkers(gray)

    if marker_ids is None or len(marker_ids) < 4:
        raise RuntimeError("detected too few markers for a stable board fit")

    interpolated_count, charuco_corners, charuco_ids = cv2.aruco.interpolateCornersCharuco(
        marker_corners, marker_ids, gray, board
    )

    if charuco_ids is None or interpolated_count < 4:
        raise RuntimeError("detected too few ChArUco corners for a stable board fit")

    ids = charuco_ids.flatten().astype(int)
    image_points = charuco_corners.reshape(-1, 2)
    board_points = board.getChessboardCorners()[ids][:, :2]

    homography, inlier_mask = cv2.findHomography(
        board_points.astype(np.float32),
        image_points.astype(np.float32),
        method=cv2.RANSAC,
        ransacReprojThreshold=3.0,
    )
    if homography is None:
        raise RuntimeError("failed to estimate board homography")

    inlier_mask = inlier_mask.reshape(-1).astype(bool) if inlier_mask is not None else np.ones(len(ids), dtype=bool)
    projected = cv2.perspectiveTransform(board_points.reshape(-1, 1, 2).astype(np.float32), homography).reshape(-1, 2)
    residuals = np.linalg.norm(projected - image_points, axis=1)
    rmse = float(np.sqrt(np.mean(np.square(residuals[inlier_mask]))))

    outline_board = np.array(
        [
            [0.0, 0.0],
            [spec["squares_x"] * spec["square_size_mm"], 0.0],
            [spec["squares_x"] * spec["square_size_mm"], spec["squares_y"] * spec["square_size_mm"]],
            [0.0, spec["squares_y"] * spec["square_size_mm"]],
        ],
        dtype=np.float32,
    )
    outline_image = cv2.perspectiveTransform(outline_board.reshape(-1, 1, 2), homography).reshape(-1, 2)

    overlay = image_bgr.copy()
    cv2.aruco.drawDetectedMarkers(overlay, marker_corners, marker_ids)
    cv2.aruco.drawDetectedCornersCharuco(overlay, charuco_corners, charuco_ids, (255, 180, 0))
    cv2.polylines(overlay, [np.round(outline_image).astype(np.int32)], True, (0, 255, 0), 4, cv2.LINE_AA)

    marker_list = []
    for marker_id, corners in zip(marker_ids.flatten().tolist(), marker_corners):
        marker_list.append(
            {
                "id": int(marker_id),
                "corners_image": np.asarray(corners).reshape(4, 2).astype(float).tolist(),
            }
        )

    charuco_list = []
    for charuco_id, image_xy, board_xy in zip(ids.tolist(), image_points.tolist(), board_points.tolist()):
        charuco_list.append(
            {
                "id": int(charuco_id),
                "image_xy": [float(image_xy[0]), float(image_xy[1])],
                "board_xy_mm": [float(board_xy[0]), float(board_xy[1])],
            }
        )

    total_charuco = (spec["squares_x"] - 1) * (spec["squares_y"] - 1)
    total_markers = int(len(board.getIds()))
    confidence = min(
        1.0,
        0.6 * (len(charuco_list) / total_charuco) + 0.4 * (len(marker_list) / total_markers),
    )

    payload = {
        "summary": {
            "board_id": spec["board_id"],
            "marker_count": len(marker_list),
            "charuco_corner_count": len(charuco_list),
            "confidence": confidence,
            "board_outline_image": [[float(x), float(y)] for x, y in outline_image.tolist()],
            "board_reprojection_rmse_px": rmse,
        },
        "homography_board_mm_to_image": homography.tolist(),
        "markers": marker_list,
        "charuco_corners": charuco_list,
    }

    return payload, overlay


def main() -> int:
    args = parse_args()
    input_path = Path(args.input)
    board_spec_path = Path(args.board_spec)
    output_json_path = Path(args.output_json)
    output_overlay_path = Path(args.output_overlay)

    image_bgr = cv2.imread(str(input_path), cv2.IMREAD_COLOR)
    if image_bgr is None:
        print(f"failed to read image {input_path}", file=sys.stderr)
        return 1

    try:
        spec, board, dictionary = load_board(board_spec_path)
        payload, overlay = detect_board(image_bgr, spec, board, dictionary)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1

    output_json_path.write_text(json.dumps(payload, indent=2) + "\n")
    cv2.imwrite(str(output_overlay_path), overlay)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
