use std::path::PathBuf;

use anyhow::Result;
use clap::{Parser, Subcommand};
use rectify_core::{
    BoardDetectionRequest, BoardSpecSource, RectifyRequest, run_board_detection_checkpoint,
    run_rectify,
};

#[derive(Debug, Parser)]
#[command(name = "rectify-cli")]
#[command(about = "Printable-board rectification engine")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Detect a reference board and emit detection debug outputs (Phase 2 checkpoint).
    Detect(DetectArgs),
    /// Detect the board and produce a fully rectified image (Phase 3).
    Rectify(RectifyArgs),
}

#[derive(Debug, Parser)]
struct DetectArgs {
    #[arg(long)]
    input: PathBuf,

    #[arg(long)]
    output_dir: PathBuf,

    /// Built-in board ID (default: refboard_v1).
    #[arg(long)]
    board: Option<String>,

    /// Path to a custom board spec JSON.
    #[arg(long)]
    board_spec: Option<PathBuf>,
}

#[derive(Debug, Parser)]
struct RectifyArgs {
    #[arg(long)]
    input: PathBuf,

    #[arg(long)]
    output_dir: PathBuf,

    /// Built-in board ID (default: refboard_v1).
    #[arg(long)]
    board: Option<String>,

    /// Path to a custom board spec JSON.
    #[arg(long)]
    board_spec: Option<PathBuf>,

    /// Output resolution in pixels per millimeter (default: 10).
    #[arg(long)]
    pixels_per_mm: Option<f64>,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Detect(args) => run_detect(args),
        Command::Rectify(args) => run_rectify_cmd(args),
    }
}

fn board_spec_source(
    board_spec: Option<PathBuf>,
    board: Option<String>,
) -> Result<BoardSpecSource> {
    match (board_spec, board) {
        (Some(path), None) => Ok(BoardSpecSource::Path(path)),
        (None, Some(id)) => Ok(BoardSpecSource::BuiltIn(id)),
        (None, None) => Ok(BoardSpecSource::BuiltIn("refboard_v1".to_string())),
        (Some(_), Some(_)) => anyhow::bail!("pass either --board-spec or --board, not both"),
    }
}

fn run_detect(args: DetectArgs) -> Result<()> {
    let source = board_spec_source(args.board_spec, args.board)?;
    let result = run_board_detection_checkpoint(&BoardDetectionRequest {
        input_path: args.input,
        board_spec_source: source,
        output_dir: args.output_dir,
    })?;

    println!("prepared input: {}", result.prepared_input_path.display());
    println!("board spec:     {}", result.board_spec_path.display());
    println!("transform:      {}", result.transform_path.display());
    println!("debug overlay:  {}", result.debug_overlay_path.display());
    println!("board debug:    {}", result.board_debug_path.display());
    Ok(())
}

fn run_rectify_cmd(args: RectifyArgs) -> Result<()> {
    let source = board_spec_source(args.board_spec, args.board)?;
    let result = run_rectify(&RectifyRequest {
        input_path: args.input,
        board_spec_source: source,
        output_dir: args.output_dir,
        pixels_per_mm: args.pixels_per_mm,
    })?;

    println!("prepared input: {}", result.prepared_input_path.display());
    println!("board spec:     {}", result.board_spec_path.display());
    println!("rectified:      {}", result.rectified_path.display());
    println!("transform:      {}", result.transform_path.display());
    println!("debug overlay:  {}", result.debug_overlay_path.display());
    println!("board debug:    {}", result.board_debug_path.display());
    println!("scale:          {:.1} px/mm", result.pixels_per_mm);
    Ok(())
}
