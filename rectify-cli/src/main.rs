use std::path::PathBuf;

use anyhow::Result;
use clap::{Parser, Subcommand};
use rectify_core::{
    BoardDetectionRequest, BoardSpecSource, OutlineOptions, QualityStatus, RectifyRequest,
    run_board_detection_checkpoint, run_rectify,
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
    /// Detect the board and produce a fully rectified image + pattern outline (Phases 3–5).
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

    /// Skip outline extraction / SVG / DXF output.
    #[arg(long)]
    no_extract_outline: bool,

    /// Ramer–Douglas–Peucker simplification tolerance, in millimetres.
    #[arg(long, default_value_t = 0.3)]
    simplify_mm: f64,

    /// Minimum accepted candidate piece area, in mm².
    #[arg(long, default_value_t = 200.0)]
    min_piece_area_mm2: f64,

    /// Additional mm margin around the known board rectangle to exclude
    /// from segmentation candidates (defaults to the board quiet zone).
    #[arg(long)]
    board_margin_mm: Option<f64>,

    /// Apply curve smoothing to the outline (currently a no-op; reserved
    /// for future cubic-Bezier fitting).
    #[arg(long)]
    smooth: bool,
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

    let outline = OutlineOptions {
        extract: !args.no_extract_outline,
        simplify_mm: args.simplify_mm,
        min_piece_area_mm2: args.min_piece_area_mm2,
        board_margin_mm: args.board_margin_mm,
        smooth: args.smooth,
    };

    let result = run_rectify(&RectifyRequest {
        input_path: args.input,
        board_spec_source: source,
        output_dir: args.output_dir,
        pixels_per_mm: args.pixels_per_mm,
        outline,
    })?;

    println!("prepared input: {}", result.prepared_input_path.display());
    println!("board spec:     {}", result.board_spec_path.display());
    println!("rectified:      {}", result.rectified_path.display());
    println!("transform:      {}", result.transform_path.display());
    println!("quality:        {}", result.quality_path.display());
    println!("debug overlay:  {}", result.debug_overlay_path.display());
    println!("board debug:    {}", result.board_debug_path.display());
    println!("scale:          {:.1} px/mm", result.pixels_per_mm);

    let status_str = match result.quality.status {
        QualityStatus::Ok => "ok",
        QualityStatus::Warning => "warning",
        QualityStatus::Fail => "fail",
    };
    println!("quality status: {status_str}");
    for w in &result.quality.warnings {
        println!("  warning: {w}");
    }

    if let Some(outline) = &result.outline {
        println!("outline svg:    {}", outline.svg_path.display());
        println!("outline dxf:    {}", outline.dxf_path.display());
        println!("outline json:   {}", outline.json_path.display());
        println!("piece mask:     {}", outline.mask_debug_path.display());
        let m = &outline.metadata;
        println!(
            "outline stats:  {} → {} verts (tol {:.3} mm), area {:.1} mm², perimeter {:.1} mm",
            m.vertex_count_raw,
            m.vertex_count_simplified,
            m.simplify_tolerance_mm,
            m.area_mm2,
            m.perimeter_mm
        );
        let [mnx, mny, mxx, mxy] = m.bounding_box_mm;
        println!(
            "outline bbox:   ({:.1}, {:.1}) → ({:.1}, {:.1}) mm  (size {:.1} × {:.1} mm)",
            mnx,
            mny,
            mxx,
            mxy,
            mxx - mnx,
            mxy - mny
        );
    } else if !args.no_extract_outline {
        println!("outline:        extraction failed (see stderr)");
    }
    Ok(())
}
