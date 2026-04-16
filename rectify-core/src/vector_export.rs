//! Vector export: SVG (for illustration software) and DXF R12
//! (for CAD software).
//!
//! Both writers take an `MmPolygon` in millimetre coordinates. The SVG
//! preserves the input orientation (y-down, same as image pixels); the
//! DXF flips y so that CAD users see the expected y-up convention.

use std::{fs, path::Path};

use anyhow::{Context, Result};

use crate::contour::MmPolygon;

/// Write a single closed path SVG with real-world millimetre units.
///
/// `bbox_mm = [min_x, min_y, max_x, max_y]` controls the page extents.
/// Passing the polygon's bounding box gives a tight page; passing the
/// rectified image bounds preserves the polygon's position in the scene.
pub fn write_svg(path: &Path, polygon: &MmPolygon, bbox_mm: [f64; 4]) -> Result<()> {
    let [min_x, min_y, max_x, max_y] = bbox_mm;
    let width = (max_x - min_x).max(0.001);
    let height = (max_y - min_y).max(0.001);

    let mut d = String::new();
    for (i, &[x, y]) in polygon.points.iter().enumerate() {
        let sx = x - min_x;
        let sy = y - min_y;
        if i == 0 {
            d.push_str(&format!("M {:.4} {:.4}", sx, sy));
        } else {
            d.push_str(&format!(" L {:.4} {:.4}", sx, sy));
        }
    }
    if !polygon.points.is_empty() {
        d.push_str(" Z");
    }

    let body = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <svg xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\" \
         width=\"{w:.4}mm\" height=\"{h:.4}mm\" \
         viewBox=\"0 0 {w:.4} {h:.4}\">\n\
         <g fill=\"none\" stroke=\"#000000\" stroke-width=\"0.2\" \
         stroke-linejoin=\"round\" stroke-linecap=\"round\">\n\
         <path d=\"{d}\"/>\n\
         </g>\n\
         </svg>\n",
        w = width,
        h = height,
        d = d
    );

    fs::write(path, body).with_context(|| format!("failed to write SVG {}", path.display()))?;
    Ok(())
}

/// Write a minimal DXF R12 ASCII file containing one closed
/// `LWPOLYLINE` on layer `PATTERN` with millimetre units.
///
/// Y is flipped so CAD software shows the polygon right-side-up
/// (DXF / most CAD tools use y-up).
pub fn write_dxf(path: &Path, polygon: &MmPolygon, bbox_mm: [f64; 4]) -> Result<()> {
    let [_, _, _, max_y] = bbox_mm;

    let n = polygon.points.len();
    let mut body = String::new();

    // HEADER
    body.push_str("0\nSECTION\n2\nHEADER\n");
    body.push_str("9\n$ACADVER\n1\nAC1009\n");
    body.push_str("9\n$INSUNITS\n70\n4\n"); // 4 = millimetres
    body.push_str("9\n$MEASUREMENT\n70\n1\n"); // 1 = metric
    body.push_str("0\nENDSEC\n");

    // TABLES — just a single LAYER so viewers don't complain.
    body.push_str("0\nSECTION\n2\nTABLES\n");
    body.push_str("0\nTABLE\n2\nLAYER\n70\n1\n");
    body.push_str("0\nLAYER\n2\nPATTERN\n70\n0\n62\n7\n6\nCONTINUOUS\n");
    body.push_str("0\nENDTAB\n0\nENDSEC\n");

    // ENTITIES
    body.push_str("0\nSECTION\n2\nENTITIES\n");
    body.push_str("0\nLWPOLYLINE\n");
    body.push_str("8\nPATTERN\n");
    body.push_str("100\nAcDbEntity\n");
    body.push_str("100\nAcDbPolyline\n");
    body.push_str(&format!("90\n{}\n", n));
    body.push_str("70\n1\n"); // closed
    for &[x, y] in &polygon.points {
        body.push_str(&format!("10\n{:.6}\n20\n{:.6}\n", x, max_y - y));
    }
    body.push_str("0\nENDSEC\n");

    body.push_str("0\nEOF\n");

    fs::write(path, body).with_context(|| format!("failed to write DXF {}", path.display()))?;
    Ok(())
}

/// Emit an `outline.json` sidecar describing the extracted polygon.
pub fn write_outline_json(path: &Path, value: &serde_json::Value) -> Result<()> {
    let s = serde_json::to_string_pretty(value)?;
    fs::write(path, s).with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmp(prefix: &str, ext: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "{prefix}-{}.{ext}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn square_polygon() -> MmPolygon {
        MmPolygon {
            points: vec![
                [10.0, 10.0],
                [110.0, 10.0],
                [110.0, 60.0],
                [10.0, 60.0],
            ],
        }
    }

    #[test]
    fn svg_contains_mm_units_and_closed_path() {
        let poly = square_polygon();
        let path = tmp("rectify-svg", "svg");
        write_svg(&path, &poly, [0.0, 0.0, 150.0, 100.0]).unwrap();
        let s = std::fs::read_to_string(&path).unwrap();
        assert!(s.contains("width=\"150.0000mm\""), "{s}");
        assert!(s.contains("height=\"100.0000mm\""), "{s}");
        assert!(s.contains("viewBox=\"0 0 150.0000 100.0000\""), "{s}");
        assert!(s.contains("Z"), "path not closed: {s}");
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn dxf_emits_lwpolyline_closed_in_mm() {
        let poly = square_polygon();
        let path = tmp("rectify-dxf", "dxf");
        write_dxf(&path, &poly, [0.0, 0.0, 150.0, 100.0]).unwrap();
        let s = std::fs::read_to_string(&path).unwrap();
        assert!(s.contains("LWPOLYLINE"), "{s}");
        // $INSUNITS == 4 (mm)
        assert!(s.contains("$INSUNITS\n1\n4") || s.contains("$INSUNITS\n70\n4"));
        // Closed flag
        assert!(s.contains("70\n1"), "polyline not closed");
        // Number of vertices
        assert!(s.contains("90\n4"), "expected 4 vertices: {s}");
        std::fs::remove_file(&path).unwrap();
    }
}
