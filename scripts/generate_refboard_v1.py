#!/usr/bin/env python3

from __future__ import annotations

import json
from pathlib import Path
import subprocess

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont


LETTER_WIDTH_IN = 8.5
LETTER_HEIGHT_IN = 11.0
DPI = 300
MM_PER_IN = 25.4

BOARD_ID = "refboard_v1"
DICT_NAME = "DICT_5X5_100"
SQUARES_X = 11
SQUARES_Y = 8
SQUARE_SIZE_MM = 15.0
MARKER_SIZE_MM = 11.0
QUIET_ZONE_MM = 8.0
VERIFY_BAR_MM = 50.0


def mm_to_px(mm: float) -> int:
    return round(mm / MM_PER_IN * DPI)


def in_to_px(inches: float) -> int:
    return round(inches * DPI)


def load_font(size: int) -> ImageFont.ImageFont:
    for candidate in (
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica.ttc",
    ):
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def generate_board_image() -> Image.Image:
    dictionary = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, DICT_NAME))
    board = cv2.aruco.CharucoBoard(
        (SQUARES_X, SQUARES_Y),
        SQUARE_SIZE_MM,
        MARKER_SIZE_MM,
        dictionary,
    )

    board_width_px = mm_to_px(SQUARES_X * SQUARE_SIZE_MM)
    board_height_px = mm_to_px(SQUARES_Y * SQUARE_SIZE_MM)
    board_img = board.generateImage((board_width_px, board_height_px), marginSize=0, borderBits=1)
    return Image.fromarray(board_img).convert("L")


def fit_canvas(board_img: Image.Image) -> Image.Image:
    letter_size = (in_to_px(LETTER_WIDTH_IN), in_to_px(LETTER_HEIGHT_IN))
    canvas = Image.new("RGB", letter_size, "white")
    draw = ImageDraw.Draw(canvas)

    title_font = load_font(34)
    body_font = load_font(18)
    small_font = load_font(15)

    margin_x = in_to_px(0.6)
    margin_y = in_to_px(0.55)

    title = "Pattern Detector Reference Board"
    subtitle = "Print at 100% on US Letter (8.5 x 11 in). Do not scale to fit."

    draw.text((margin_x, margin_y), title, fill="black", font=title_font)
    draw.text((margin_x, margin_y + 42), subtitle, fill="black", font=body_font)

    quiet_zone_px = mm_to_px(QUIET_ZONE_MM)
    board_total_w = board_img.width + quiet_zone_px * 2
    board_total_h = board_img.height + quiet_zone_px * 2

    board_x = (canvas.width - board_total_w) // 2
    board_y = margin_y + 100

    draw.rectangle(
        [board_x, board_y, board_x + board_total_w, board_y + board_total_h],
        fill="white",
        outline="black",
        width=2,
    )
    canvas.paste(board_img.convert("RGB"), (board_x + quiet_zone_px, board_y + quiet_zone_px))

    top_label = "TOP"
    top_bbox = draw.textbbox((0, 0), top_label, font=body_font)
    top_w = top_bbox[2] - top_bbox[0]
    draw.text(
        (board_x + board_total_w // 2 - top_w // 2, board_y - 32),
        top_label,
        fill="black",
        font=body_font,
    )

    meta_y = board_y + board_total_h + 30
    instructions = [
        f"Board ID: {BOARD_ID}",
        f"Board geometry: {SQUARES_X} x {SQUARES_Y} squares, {SQUARE_SIZE_MM:.1f} mm squares, {MARKER_SIZE_MM:.1f} mm markers",
        "Use the phone's main camera. Keep this board flat and in the same plane as the pattern piece.",
    ]
    for i, line in enumerate(instructions):
        draw.text((margin_x, meta_y + i * 24), line, fill="black", font=small_font)

    bar_y = canvas.height - margin_y - 70
    bar_x = margin_x
    bar_w = mm_to_px(VERIFY_BAR_MM)
    bar_h = 18
    draw.text((bar_x, bar_y - 28), f"Verification bar: exactly {VERIFY_BAR_MM:.0f} mm", fill="black", font=body_font)
    draw.rectangle([bar_x, bar_y, bar_x + bar_w, bar_y + bar_h], fill="black")
    draw.rectangle([bar_x + bar_w, bar_y, bar_x + bar_w * 2, bar_y + bar_h], fill="white", outline="black", width=2)
    draw.text((bar_x, bar_y + 28), "Measure the full black segment with a ruler before using.", fill="black", font=small_font)

    footer = "If the measured bar is wrong, printer scaling is on and this board should not be used."
    draw.text((margin_x, canvas.height - margin_y - 12), footer, fill="black", font=small_font, anchor="ls")

    return canvas


def write_spec_json(path: Path) -> None:
    spec = {
        "schema_version": 1,
        "board_id": BOARD_ID,
        "board_family": "charuco",
        "marker_dictionary": DICT_NAME,
        "squares_x": SQUARES_X,
        "squares_y": SQUARES_Y,
        "square_size_mm": SQUARE_SIZE_MM,
        "marker_size_mm": MARKER_SIZE_MM,
        "quiet_zone_mm": QUIET_ZONE_MM,
        "origin": "top_left_corner",
        "target_paper": "US Letter",
        "notes": "Default printable board for single-photo rectification",
    }
    path.write_text(json.dumps(spec, indent=2) + "\n")


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    out_dir = repo_root / "assets" / BOARD_ID
    out_dir.mkdir(parents=True, exist_ok=True)

    board_img = generate_board_image()
    canvas = fit_canvas(board_img)

    png_path = out_dir / f"{BOARD_ID}_letter.png"
    pdf_path = out_dir / f"{BOARD_ID}_letter.pdf"
    spec_path = out_dir / f"{BOARD_ID}.json"
    readme_path = out_dir / "README.md"

    canvas.save(png_path)
    write_pdf(canvas, png_path, pdf_path)
    write_spec_json(spec_path)

    readme_path.write_text(
        "\n".join(
            [
                f"# {BOARD_ID}",
                "",
                f"Print [{BOARD_ID}_letter.pdf](./{BOARD_ID}_letter.pdf) at 100% on US Letter paper.",
                "",
                "Quick checks:",
                f"- Verify the black scale bar measures exactly {VERIFY_BAR_MM:.0f} mm.",
                "- Do not enable `Fit to page`, `Scale to fit`, or any auto-resize option.",
                "- Keep the board flat and place it in the same plane as the pattern piece.",
            ]
        )
        + "\n"
    )


def write_pdf(canvas: Image.Image, png_path: Path, pdf_path: Path) -> None:
    try:
        canvas.save(pdf_path, "PDF", resolution=DPI)
        return
    except Exception:
        pass

    subprocess.run(
        ["sips", "-s", "format", "pdf", str(png_path), "--out", str(pdf_path)],
        check=True,
        capture_output=True,
        text=True,
    )


if __name__ == "__main__":
    main()
