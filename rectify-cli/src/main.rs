use std::path::PathBuf;

use anyhow::Result;
use clap::Parser;
use rectify_core::{Phase1Request, run_phase1};

#[derive(Debug, Parser)]
#[command(name = "rectify-cli")]
#[command(about = "Phase 1 grid-rectification pipeline: image load, calibration, and undistortion")]
struct Cli {
    #[arg(long)]
    input: PathBuf,

    #[arg(long)]
    calibration: PathBuf,

    #[arg(long)]
    output_dir: PathBuf,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let result = run_phase1(&Phase1Request {
        input_path: cli.input,
        calibration_path: cli.calibration,
        output_dir: cli.output_dir,
    })?;

    println!("undistorted: {}", result.undistorted_path.display());
    println!("transform: {}", result.transform_path.display());
    Ok(())
}
