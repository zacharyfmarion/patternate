use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};

use crate::{
    board_detect::detect_board,
    board_spec::{BoardSpecSource, load_board_spec},
    image_io::load_image,
    metadata::{ImageMetadata, ReferenceBoardMetadata, TransformMetadata},
};

#[derive(Debug, Clone)]
pub struct BoardDetectionRequest {
    pub input_path: PathBuf,
    pub board_spec_source: BoardSpecSource,
    pub output_dir: PathBuf,
}

#[derive(Debug, Clone)]
pub struct BoardDetectionRunResult {
    pub prepared_input_path: PathBuf,
    pub debug_overlay_path: PathBuf,
    pub board_debug_path: PathBuf,
    pub transform_path: PathBuf,
    pub board_spec_path: PathBuf,
}

pub fn run_board_detection_checkpoint(
    request: &BoardDetectionRequest,
) -> Result<BoardDetectionRunResult> {
    fs::create_dir_all(&request.output_dir).with_context(|| {
        format!(
            "failed to create output directory {}",
            request.output_dir.display()
        )
    })?;

    let loaded = load_image(&request.input_path)?;
    let board_spec = load_board_spec(&request.board_spec_source)?;
    let board_spec_path = materialize_board_spec(&request.output_dir, &request.board_spec_source)?;

    let prepared_input_path = request.output_dir.join("prepared_input.png");
    loaded
        .image
        .save(&prepared_input_path)
        .with_context(|| format!("failed to save {}", prepared_input_path.display()))?;

    let board_debug_path = request.output_dir.join("board_debug.json");
    let debug_overlay_path = request.output_dir.join("debug_overlay.png");
    let detection = detect_board(
        &prepared_input_path,
        &board_spec,
        &board_spec_path,
        &board_debug_path,
        &debug_overlay_path,
    )?;

    let transform = TransformMetadata {
        schema_version: 1,
        phase: "board_detection_checkpoint",
        input_image: ImageMetadata {
            width_px: loaded.original_width_px,
            height_px: loaded.original_height_px,
        },
        prepared_image: ImageMetadata {
            width_px: loaded.image.width(),
            height_px: loaded.image.height(),
        },
        reference_board: ReferenceBoardMetadata {
            board_id: board_spec.board_id.clone(),
            squares_x: board_spec.squares_x,
            squares_y: board_spec.squares_y,
            square_size_mm: board_spec.square_size_mm,
            marker_size_mm: board_spec.marker_size_mm,
        },
        board_detection: detection.debug.summary.clone(),
    };

    let transform_path = request.output_dir.join("transform.json");
    write_json_pretty(&transform_path, &transform)?;

    Ok(BoardDetectionRunResult {
        prepared_input_path,
        debug_overlay_path,
        board_debug_path,
        transform_path,
        board_spec_path,
    })
}

fn materialize_board_spec(output_dir: &Path, source: &BoardSpecSource) -> Result<PathBuf> {
    match source {
        BoardSpecSource::Path(path) => Ok(path.clone()),
        BoardSpecSource::BuiltIn(board_id) => {
            let spec = load_board_spec(source)?;
            let path = output_dir.join(format!("{board_id}.json"));
            let json = serde_json::to_string_pretty(&spec)?;
            fs::write(&path, json).with_context(|| format!("failed to write {}", path.display()))?;
            Ok(path)
        }
    }
}

fn write_json_pretty(path: &Path, value: &TransformMetadata) -> Result<()> {
    let json = serde_json::to_string_pretty(value)?;
    fs::write(path, json).with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    #[test]
    fn board_detection_checkpoint_emits_expected_outputs() {
        let temp_root = std::env::temp_dir().join(format!(
            "rectify-core-board-checkpoint-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&temp_root).unwrap();

        let output_dir = temp_root.join("output");
        let result = run_board_detection_checkpoint(&BoardDetectionRequest {
            input_path: Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../assets/refboard_v1/refboard_v1_letter.png"),
            board_spec_source: BoardSpecSource::BuiltIn("refboard_v1".to_string()),
            output_dir: output_dir.clone(),
        })
        .unwrap();

        assert!(result.prepared_input_path.exists());
        assert!(result.debug_overlay_path.exists());
        assert!(result.board_debug_path.exists());
        assert!(result.transform_path.exists());
        assert!(result.board_spec_path.exists());

        let transform: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&result.transform_path).unwrap()).unwrap();
        assert_eq!(transform["phase"], "board_detection_checkpoint");
        assert_eq!(transform["reference_board"]["board_id"], "refboard_v1");
        assert!(transform["board_detection"]["marker_count"].as_u64().unwrap() > 0);

        fs::remove_dir_all(temp_root).unwrap();
    }
}
