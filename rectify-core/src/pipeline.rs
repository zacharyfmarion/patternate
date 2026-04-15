use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};

use crate::{
    calibration::CalibrationProfile,
    image_io::load_image,
    metadata::{ImageMetadata, TransformMetadata},
    undistort::undistort_image,
};

#[derive(Debug, Clone)]
pub struct Phase1Request {
    pub input_path: PathBuf,
    pub calibration_path: PathBuf,
    pub output_dir: PathBuf,
}

#[derive(Debug, Clone)]
pub struct Phase1Result {
    pub undistorted_path: PathBuf,
    pub transform_path: PathBuf,
}

pub fn run_phase1(request: &Phase1Request) -> Result<Phase1Result> {
    fs::create_dir_all(&request.output_dir).with_context(|| {
        format!(
            "failed to create output directory {}",
            request.output_dir.display()
        )
    })?;

    let loaded = load_image(&request.input_path)?;
    let calibration = CalibrationProfile::from_path(&request.calibration_path)?;
    let scaled = calibration.scaled_for_image_dimensions(
        loaded.image.width(),
        loaded.image.height(),
    )?;

    let undistorted = undistort_image(&loaded.image, &scaled.intrinsics, &scaled.distortion);

    let undistorted_path = request.output_dir.join("undistorted.png");
    undistorted
        .save(&undistorted_path)
        .with_context(|| format!("failed to save {}", undistorted_path.display()))?;

    let transform = TransformMetadata {
        schema_version: 1,
        phase: "phase1_undistortion",
        input_image: ImageMetadata {
            width_px: loaded.image.width(),
            height_px: loaded.image.height(),
        },
        undistorted_image: ImageMetadata {
            width_px: undistorted.width(),
            height_px: undistorted.height(),
        },
        calibration_profile_id: scaled.profile_id,
        intrinsics_used: scaled.intrinsics,
        distortion_used: scaled.distortion,
    };

    let transform_path = request.output_dir.join("transform.json");
    write_json_pretty(&transform_path, &transform)?;

    Ok(Phase1Result {
        undistorted_path,
        transform_path,
    })
}

fn write_json_pretty(path: &Path, value: &TransformMetadata) -> Result<()> {
    let json = serde_json::to_string_pretty(value)?;
    fs::write(path, json).with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use image::{ImageBuffer, Rgb};

    use super::*;

    #[test]
    fn phase1_pipeline_emits_expected_outputs() {
        let temp_root = std::env::temp_dir().join(format!(
            "rectify-core-phase1-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&temp_root).unwrap();

        let input_path = temp_root.join("input.png");
        let calibration_path = temp_root.join("calibration.json");
        let output_dir = temp_root.join("output");

        let image = ImageBuffer::from_fn(8, 6, |x, y| {
            Rgb([(x * 10) as u8, (y * 20) as u8, (x * 10 + y * 5) as u8])
        });
        image.save(&input_path).unwrap();

        let calibration = r#"
        {
          "profile_id": "test_profile",
          "nominal_image_size": { "width_px": 8, "height_px": 6 },
          "intrinsics": { "fx": 10.0, "fy": 10.0, "cx": 4.0, "cy": 3.0 },
          "distortion": {
            "model": "brown_conrady",
            "k1": 0.0,
            "k2": 0.0,
            "k3": 0.0,
            "p1": 0.0,
            "p2": 0.0
          }
        }
        "#;
        fs::write(&calibration_path, calibration).unwrap();

        let result = run_phase1(&Phase1Request {
            input_path,
            calibration_path,
            output_dir: output_dir.clone(),
        })
        .unwrap();

        assert!(result.undistorted_path.exists());
        assert!(result.transform_path.exists());

        let transform: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&result.transform_path).unwrap()).unwrap();
        assert_eq!(transform["phase"], "phase1_undistortion");
        assert_eq!(transform["input_image"]["width_px"], 8);
        assert_eq!(transform["undistorted_image"]["height_px"], 6);

        fs::remove_dir_all(temp_root).unwrap();
    }
}
