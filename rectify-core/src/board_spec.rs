use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};

/// Built-in board specs embedded into the binary so the library works
/// without any filesystem presence (required for WASM).
const REFBOARD_V1_JSON: &str =
    include_str!("../../assets/refboard_v1/refboard_v1.json");

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BoardFamily {
    Charuco,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BoardSpec {
    pub schema_version: u32,
    pub board_id: String,
    pub board_family: BoardFamily,
    pub marker_dictionary: String,
    pub squares_x: u32,
    pub squares_y: u32,
    pub square_size_mm: f64,
    pub marker_size_mm: f64,
    pub quiet_zone_mm: f64,
    pub origin: String,
    pub target_paper: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BoardSpecSource {
    BuiltIn(String),
    Path(PathBuf),
}

pub fn load_board_spec(source: &BoardSpecSource) -> Result<BoardSpec> {
    match source {
        BoardSpecSource::BuiltIn(board_id) => load_builtin_board_spec(board_id),
        BoardSpecSource::Path(path) => BoardSpec::from_path(path),
    }
}

/// Parse a board spec from an embedded JSON string.
///
/// Available in all build targets, including `wasm32-unknown-unknown`.
pub fn load_builtin_board_spec(board_id: &str) -> Result<BoardSpec> {
    let raw = match board_id {
        "refboard_v1" => REFBOARD_V1_JSON,
        other => bail!("unsupported built-in board `{other}`"),
    };
    BoardSpec::from_json_str(raw)
        .with_context(|| format!("failed to parse built-in board spec `{board_id}`"))
}

/// Raw JSON for a built-in board (useful for the WASM surface).
pub fn builtin_board_spec_json(board_id: &str) -> Result<&'static str> {
    match board_id {
        "refboard_v1" => Ok(REFBOARD_V1_JSON),
        other => bail!("unsupported built-in board `{other}`"),
    }
}

impl BoardSpec {
    #[cfg(not(target_family = "wasm"))]
    pub fn from_path(path: &Path) -> Result<Self> {
        let raw = std::fs::read_to_string(path)
            .with_context(|| format!("failed to read board spec {}", path.display()))?;
        let spec: BoardSpec = serde_json::from_str(&raw)
            .with_context(|| format!("failed to parse board spec {}", path.display()))?;
        spec.validate()?;
        Ok(spec)
    }

    #[cfg(target_family = "wasm")]
    pub fn from_path(_path: &Path) -> Result<Self> {
        bail!("BoardSpec::from_path is not available on wasm targets; use from_json_str instead")
    }

    /// Parse and validate a board spec from a JSON string.
    pub fn from_json_str(raw: &str) -> Result<Self> {
        let spec: BoardSpec = serde_json::from_str(raw)
            .with_context(|| "failed to parse board spec JSON")?;
        spec.validate()?;
        Ok(spec)
    }

    pub fn validate(&self) -> Result<()> {
        ensure!(self.schema_version == 1, "unsupported board spec schema_version");
        ensure!(!self.board_id.trim().is_empty(), "board_id must not be empty");
        ensure!(self.squares_x >= 4 && self.squares_y >= 4, "board must be at least 4x4 squares");
        ensure!(
            self.square_size_mm.is_finite() && self.square_size_mm > 0.0,
            "square_size_mm must be positive"
        );
        ensure!(
            self.marker_size_mm.is_finite()
                && self.marker_size_mm > 0.0
                && self.marker_size_mm < self.square_size_mm,
            "marker_size_mm must be positive and smaller than square_size_mm"
        );
        ensure!(
            self.quiet_zone_mm.is_finite() && self.quiet_zone_mm >= 0.0,
            "quiet_zone_mm must be non-negative"
        );
        ensure!(
            self.marker_size_mm / self.square_size_mm <= 0.95,
            "marker_size_mm must be meaningfully smaller than square_size_mm"
        );
        ensure!(
            self.marker_dictionary.starts_with("DICT_"),
            "marker_dictionary must be an OpenCV ArUco dictionary name"
        );
        Ok(())
    }

    pub fn board_width_mm(&self) -> f64 {
        self.squares_x as f64 * self.square_size_mm
    }

    pub fn board_height_mm(&self) -> f64 {
        self.squares_y as f64 * self.square_size_mm
    }
}

/// Best-effort on-disk path for the built-in board spec. Used by the
/// filesystem pipeline wrapper to copy the spec into an output dir.
/// Returns `None` on WASM or when `CARGO_MANIFEST_DIR` is not set.
#[cfg(not(target_family = "wasm"))]
pub fn builtin_board_path(board_id: &str) -> Result<PathBuf> {
    match board_id {
        "refboard_v1" => Ok(Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../assets/refboard_v1/refboard_v1.json")),
        _ => bail!("unsupported built-in board `{board_id}`"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_builtin_refboard_v1() {
        let spec = load_board_spec(&BoardSpecSource::BuiltIn("refboard_v1".to_string())).unwrap();
        assert_eq!(spec.board_id, "refboard_v1");
        assert_eq!(spec.squares_x, 11);
        assert_eq!(spec.squares_y, 8);
    }

    #[test]
    fn rejects_invalid_marker_size() {
        let spec = BoardSpec {
            schema_version: 1,
            board_id: "bad".to_string(),
            board_family: BoardFamily::Charuco,
            marker_dictionary: "DICT_5X5_100".to_string(),
            squares_x: 11,
            squares_y: 8,
            square_size_mm: 10.0,
            marker_size_mm: 10.0,
            quiet_zone_mm: 8.0,
            origin: "top_left_corner".to_string(),
            target_paper: None,
            notes: None,
        };

        assert!(spec.validate().is_err());
    }
}

