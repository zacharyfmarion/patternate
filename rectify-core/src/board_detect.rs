use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

use crate::board_spec::BoardSpec;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardDetectionMarker {
    pub id: u32,
    pub corners_image: [[f32; 2]; 4],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharucoCornerObservation {
    pub id: u32,
    pub image_xy: [f32; 2],
    pub board_xy_mm: [f32; 2],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardDetectionSummary {
    pub board_id: String,
    pub marker_count: usize,
    pub charuco_corner_count: usize,
    pub confidence: f32,
    pub board_outline_image: Option<Vec<[f32; 2]>>,
    pub board_reprojection_rmse_px: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardDetectionDebug {
    pub summary: BoardDetectionSummary,
    pub markers: Vec<BoardDetectionMarker>,
    pub charuco_corners: Vec<CharucoCornerObservation>,
}

#[derive(Debug, Clone)]
pub struct BoardDetectionResult {
    pub debug: BoardDetectionDebug,
}

pub fn detect_board(
    input_image_path: &Path,
    board_spec: &BoardSpec,
    board_spec_path: &Path,
    debug_json_path: &Path,
    overlay_path: &Path,
) -> Result<BoardDetectionResult> {
    let script_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../scripts/detect_refboard.py");
    if !script_path.exists() {
        bail!("board detection script not found: {}", script_path.display());
    }

    let python = resolve_python()?;
    let output = Command::new(&python)
        .arg(&script_path)
        .arg("--input")
        .arg(input_image_path)
        .arg("--board-spec")
        .arg(board_spec_path)
        .arg("--output-json")
        .arg(debug_json_path)
        .arg("--output-overlay")
        .arg(overlay_path)
        .output()
        .with_context(|| format!("failed to launch board detector via {}", python.display()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("board detection failed: {}", stderr.trim());
    }

    let debug_json = fs::read_to_string(debug_json_path)
        .with_context(|| format!("failed to read {}", debug_json_path.display()))?;
    let debug: BoardDetectionDebug = serde_json::from_str(&debug_json)
        .with_context(|| format!("failed to parse {}", debug_json_path.display()))?;

    if debug.summary.board_id != board_spec.board_id {
        bail!(
            "detected board `{}` does not match requested board `{}`",
            debug.summary.board_id,
            board_spec.board_id
        );
    }

    Ok(BoardDetectionResult { debug })
}

fn resolve_python() -> Result<PathBuf> {
    let candidates = [
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../.venv/bin/python"),
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../.venv/bin/python3"),
        PathBuf::from("python3"),
        PathBuf::from("python"),
    ];

    for candidate in candidates {
        let probe = Command::new(&candidate)
            .arg("--version")
            .output();
        if probe.is_ok() {
            return Ok(candidate);
        }
    }

    bail!("could not find a Python interpreter for board detection")
}
