use std::{fs, path::Path};

use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImageSize {
    pub width_px: u32,
    pub height_px: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Intrinsics {
    pub fx: f64,
    pub fy: f64,
    pub cx: f64,
    pub cy: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct BrownConradyDistortion {
    pub model: DistortionModel,
    pub k1: f64,
    pub k2: f64,
    #[serde(default)]
    pub k3: f64,
    #[serde(default)]
    pub p1: f64,
    #[serde(default)]
    pub p2: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DistortionModel {
    BrownConrady,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CalibrationProfile {
    pub profile_id: String,
    pub nominal_image_size: ImageSize,
    pub intrinsics: Intrinsics,
    pub distortion: BrownConradyDistortion,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ScaledCalibration {
    pub profile_id: String,
    pub nominal_image_size: ImageSize,
    pub image_size: ImageSize,
    pub intrinsics: Intrinsics,
    pub distortion: BrownConradyDistortion,
}

impl CalibrationProfile {
    pub fn from_path(path: &Path) -> Result<Self> {
        let raw = fs::read_to_string(path)
            .with_context(|| format!("failed to read calibration profile {}", path.display()))?;
        let profile: CalibrationProfile = serde_json::from_str(&raw)
            .with_context(|| format!("failed to parse calibration profile {}", path.display()))?;
        profile.validate()?;
        Ok(profile)
    }

    pub fn validate(&self) -> Result<()> {
        ensure!(
            !self.profile_id.trim().is_empty(),
            "calibration profile_id must not be empty"
        );
        ensure!(
            self.nominal_image_size.width_px > 0 && self.nominal_image_size.height_px > 0,
            "nominal image size must be positive"
        );
        ensure!(
            self.intrinsics.fx.is_finite()
                && self.intrinsics.fy.is_finite()
                && self.intrinsics.cx.is_finite()
                && self.intrinsics.cy.is_finite(),
            "intrinsics must be finite"
        );
        ensure!(
            self.intrinsics.fx > 0.0 && self.intrinsics.fy > 0.0,
            "focal lengths must be positive"
        );
        ensure!(
            self.distortion.k1.is_finite()
                && self.distortion.k2.is_finite()
                && self.distortion.k3.is_finite()
                && self.distortion.p1.is_finite()
                && self.distortion.p2.is_finite(),
            "distortion coefficients must be finite"
        );
        Ok(())
    }

    pub fn scaled_for_image_dimensions(
        &self,
        image_width_px: u32,
        image_height_px: u32,
    ) -> Result<ScaledCalibration> {
        ensure!(
            image_width_px > 0 && image_height_px > 0,
            "image dimensions must be positive"
        );

        let scale_x = image_width_px as f64 / self.nominal_image_size.width_px as f64;
        let scale_y = image_height_px as f64 / self.nominal_image_size.height_px as f64;
        let relative_delta = ((scale_x - scale_y) / scale_x.max(scale_y)).abs();
        if relative_delta > 0.01 {
            bail!(
                "image dimensions {}x{} are incompatible with calibration aspect ratio {}x{}",
                image_width_px,
                image_height_px,
                self.nominal_image_size.width_px,
                self.nominal_image_size.height_px
            );
        }

        Ok(ScaledCalibration {
            profile_id: self.profile_id.clone(),
            nominal_image_size: self.nominal_image_size,
            image_size: ImageSize {
                width_px: image_width_px,
                height_px: image_height_px,
            },
            intrinsics: Intrinsics {
                fx: self.intrinsics.fx * scale_x,
                fy: self.intrinsics.fy * scale_y,
                cx: self.intrinsics.cx * scale_x,
                cy: self.intrinsics.cy * scale_y,
            },
            distortion: self.distortion,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_profile() -> CalibrationProfile {
        CalibrationProfile {
            profile_id: "iphone15pro_main_1x".to_string(),
            nominal_image_size: ImageSize {
                width_px: 4032,
                height_px: 3024,
            },
            intrinsics: Intrinsics {
                fx: 2850.12,
                fy: 2847.91,
                cx: 2012.43,
                cy: 1510.88,
            },
            distortion: BrownConradyDistortion {
                model: DistortionModel::BrownConrady,
                k1: -0.1123,
                k2: 0.0412,
                k3: -0.0087,
                p1: 0.0009,
                p2: -0.0006,
            },
        }
    }

    #[test]
    fn parses_profile_json() {
        let json = r#"
        {
          "profile_id": "test_profile",
          "nominal_image_size": { "width_px": 1000, "height_px": 500 },
          "intrinsics": { "fx": 700.0, "fy": 710.0, "cx": 500.0, "cy": 250.0 },
          "distortion": {
            "model": "brown_conrady",
            "k1": -0.1,
            "k2": 0.01,
            "k3": 0.0,
            "p1": 0.001,
            "p2": -0.001
          }
        }
        "#;

        let profile: CalibrationProfile = serde_json::from_str(json).unwrap();
        profile.validate().unwrap();

        assert_eq!(profile.profile_id, "test_profile");
        assert_eq!(profile.distortion.model, DistortionModel::BrownConrady);
    }

    #[test]
    fn scales_intrinsics_to_matching_image() {
        let scaled = sample_profile()
            .scaled_for_image_dimensions(2016, 1512)
            .unwrap();

        assert_eq!(scaled.image_size.width_px, 2016);
        assert!((scaled.intrinsics.fx - 1425.06).abs() < 1e-6);
        assert!((scaled.intrinsics.cy - 755.44).abs() < 1e-6);
    }

    #[test]
    fn rejects_incompatible_aspect_ratio() {
        let err = sample_profile()
            .scaled_for_image_dimensions(4032, 2800)
            .unwrap_err();

        assert!(err.to_string().contains("incompatible"));
    }
}

