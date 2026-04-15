use std::path::PathBuf;

use anyhow::Result;
use clap::Parser;
use rectify_core::{BoardDetectionRequest, BoardSpecSource, run_board_detection_checkpoint};

#[derive(Debug, Parser)]
#[command(name = "rectify-cli")]
#[command(about = "Board detection checkpoint for printable-board rectification")]
struct Cli {
    #[arg(long)]
    input: PathBuf,

    #[arg(long)]
    output_dir: PathBuf,

    #[arg(long)]
    board: Option<String>,

    #[arg(long)]
    board_spec: Option<PathBuf>,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let board_spec_source = match (cli.board_spec, cli.board) {
        (Some(path), None) => BoardSpecSource::Path(path),
        (None, Some(board_id)) => BoardSpecSource::BuiltIn(board_id),
        (None, None) => BoardSpecSource::BuiltIn("refboard_v1".to_string()),
        (Some(_), Some(_)) => {
            anyhow::bail!("pass either --board-spec or --board, not both");
        }
    };

    let result = run_board_detection_checkpoint(&BoardDetectionRequest {
        input_path: cli.input,
        board_spec_source,
        output_dir: cli.output_dir,
    })?;

    println!("prepared input: {}", result.prepared_input_path.display());
    println!("board spec: {}", result.board_spec_path.display());
    println!("transform: {}", result.transform_path.display());
    println!("debug overlay: {}", result.debug_overlay_path.display());
    println!("board debug: {}", result.board_debug_path.display());
    Ok(())
}
