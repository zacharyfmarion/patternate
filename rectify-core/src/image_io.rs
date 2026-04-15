use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result, bail};
use exif::{In, Reader, Tag, Value};
use image::{DynamicImage, GenericImageView, RgbImage, imageops};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExifOrientation {
    Normal,
    MirrorHorizontal,
    Rotate180,
    MirrorVertical,
    MirrorHorizontalRotate270,
    Rotate90,
    MirrorHorizontalRotate90,
    Rotate270,
}

impl ExifOrientation {
    fn from_u16(value: u16) -> Self {
        match value {
            2 => Self::MirrorHorizontal,
            3 => Self::Rotate180,
            4 => Self::MirrorVertical,
            5 => Self::MirrorHorizontalRotate270,
            6 => Self::Rotate90,
            7 => Self::MirrorHorizontalRotate90,
            8 => Self::Rotate270,
            _ => Self::Normal,
        }
    }
}

#[derive(Debug)]
pub struct LoadedImage {
    pub image: RgbImage,
    pub original_width_px: u32,
    pub original_height_px: u32,
    pub orientation_applied: ExifOrientation,
}

struct DecodedImage {
    image: DynamicImage,
    decoder_applied_orientation: bool,
}

pub fn load_image(path: &Path) -> Result<LoadedImage> {
    let bytes =
        fs::read(path).with_context(|| format!("failed to read image {}", path.display()))?;
    let orientation = read_exif_orientation(&bytes).unwrap_or(ExifOrientation::Normal);
    let decoded = decode_image_bytes(path, &bytes)?;
    let (original_width_px, original_height_px) = decoded.image.dimensions();
    let (oriented, orientation_applied) = if decoded.decoder_applied_orientation {
        (decoded.image, ExifOrientation::Normal)
    } else {
        (apply_orientation(decoded.image, orientation), orientation)
    };

    Ok(LoadedImage {
        image: oriented.to_rgb8(),
        original_width_px,
        original_height_px,
        orientation_applied,
    })
}

pub fn apply_orientation(image: DynamicImage, orientation: ExifOrientation) -> DynamicImage {
    match orientation {
        ExifOrientation::Normal => image,
        ExifOrientation::MirrorHorizontal => DynamicImage::ImageRgba8(imageops::flip_horizontal(&image)),
        ExifOrientation::Rotate180 => image.rotate180(),
        ExifOrientation::MirrorVertical => DynamicImage::ImageRgba8(imageops::flip_vertical(&image)),
        ExifOrientation::MirrorHorizontalRotate270 => {
            DynamicImage::ImageRgba8(imageops::rotate270(&imageops::flip_horizontal(&image)))
        }
        ExifOrientation::Rotate90 => image.rotate90(),
        ExifOrientation::MirrorHorizontalRotate90 => {
            DynamicImage::ImageRgba8(imageops::rotate90(&imageops::flip_horizontal(&image)))
        }
        ExifOrientation::Rotate270 => image.rotate270(),
    }
}

fn decode_image_bytes(path: &Path, bytes: &[u8]) -> Result<DecodedImage> {
    match image::load_from_memory(bytes) {
        Ok(image) => Ok(DecodedImage {
            image,
            decoder_applied_orientation: false,
        }),
        Err(primary_err) => {
            #[cfg(target_os = "macos")]
            {
                if is_heif_path(path) {
                    return decode_heif_via_sips(path).with_context(|| {
                        format!(
                            "failed to decode image {} via image crate or macOS sips fallback",
                            path.display()
                        )
                    });
                }
            }

            Err(primary_err).with_context(|| format!("failed to decode image {}", path.display()))
        }
    }
}

#[cfg(target_os = "macos")]
fn decode_heif_via_sips(path: &Path) -> Result<DecodedImage> {
    let temp_path = temp_transcode_path("png");
    let status = Command::new("sips")
        .arg("-s")
        .arg("format")
        .arg("png")
        .arg(path)
        .arg("--out")
        .arg(&temp_path)
        .status()
        .with_context(|| "failed to launch macOS sips for HEIC/HEIF transcoding")?;

    if !status.success() {
        bail!("macOS sips failed while transcoding {}", path.display());
    }

    let bytes = fs::read(&temp_path)
        .with_context(|| format!("failed to read transcoded image {}", temp_path.display()))?;
    let decoded = image::load_from_memory(&bytes).with_context(|| {
        format!(
            "failed to decode transcoded image produced by sips: {}",
            temp_path.display()
        )
    })?;
    let _ = fs::remove_file(&temp_path);
    Ok(DecodedImage {
        image: decoded,
        decoder_applied_orientation: true,
    })
}

fn is_heif_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "heic" | "heif"))
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn temp_transcode_path(extension: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    std::env::temp_dir().join(format!("rectify-transcode-{nonce}.{extension}"))
}

fn read_exif_orientation(bytes: &[u8]) -> Option<ExifOrientation> {
    let mut cursor = Cursor::new(bytes);
    let exif = Reader::new().read_from_container(&mut cursor).ok()?;
    let field = exif.get_field(Tag::Orientation, In::PRIMARY)?;
    match &field.value {
        Value::Short(values) => values
            .first()
            .copied()
            .map(ExifOrientation::from_u16),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb};

    fn sample_image() -> DynamicImage {
        let image = ImageBuffer::from_fn(2, 3, |x, y| {
            let base = (y * 2 + x) as u8;
            Rgb([base, base.saturating_add(1), base.saturating_add(2)])
        });
        DynamicImage::ImageRgb8(image)
    }

    #[test]
    fn rotates_image_90_clockwise() {
        let rotated = apply_orientation(sample_image(), ExifOrientation::Rotate90).to_rgb8();

        assert_eq!(rotated.dimensions(), (3, 2));
        assert_eq!(rotated.get_pixel(0, 0).0, [4, 5, 6]);
        assert_eq!(rotated.get_pixel(2, 1).0, [1, 2, 3]);
    }

    #[test]
    fn mirrors_image_horizontally() {
        let mirrored =
            apply_orientation(sample_image(), ExifOrientation::MirrorHorizontal).to_rgb8();

        assert_eq!(mirrored.dimensions(), (2, 3));
        assert_eq!(mirrored.get_pixel(0, 0).0, [1, 2, 3]);
        assert_eq!(mirrored.get_pixel(1, 0).0, [0, 1, 2]);
    }

    #[test]
    fn detects_heif_extensions_case_insensitively() {
        assert!(is_heif_path(Path::new("photo.heic")));
        assert!(is_heif_path(Path::new("photo.HEIF")));
        assert!(!is_heif_path(Path::new("photo.jpg")));
    }
}
