//! WASM bindings for the rectify-core pattern-detector pipeline.
//!
//! All entry points accept raw image bytes (Uint8Array) and return JSON-like
//! JS objects produced by `serde-wasm-bindgen`. PNG byte buffers are handed
//! back as JS `Uint8Array`.

use rectify_core::{
    BoardSpec, BoardSpecSource, DetectBoardOutcome, OutlineOptions, RectifyOptions, RectifyOutcome,
    builtin_board_spec_json, detect_board_in_memory, load_board_spec, load_builtin_board_spec,
    rectify_in_memory,
};
use serde::Serialize;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn __init() {
    console_error_panic_hook::set_once();
}

/// Return the built-in board spec as a JSON string.
#[wasm_bindgen(js_name = builtinBoardSpec)]
pub fn builtin_board_spec(board_id: &str) -> Result<String, JsError> {
    builtin_board_spec_json(board_id)
        .map(|s| s.to_string())
        .map_err(|e| JsError::new(&e.to_string()))
}

/// Detect the reference board in an image.
///
/// If `board_spec_json` is `Some`, it is parsed as a custom spec; otherwise
/// `board_id` (default `"refboard_v1"`) chooses a built-in spec.
#[wasm_bindgen(js_name = detectBoard)]
pub fn detect_board(
    image_bytes: &[u8],
    board_id: Option<String>,
    board_spec_json: Option<String>,
) -> Result<JsValue, JsError> {
    let spec = resolve_board_spec(board_id.as_deref(), board_spec_json.as_deref())
        .map_err(to_js_err)?;
    let outcome = detect_board_in_memory(image_bytes, &spec).map_err(to_js_err)?;

    let payload = DetectPayload::from_outcome(&outcome);
    serde_wasm_bindgen::to_value(&payload).map_err(|e| JsError::new(&e.to_string()))
}

/// Run the full rectify pipeline (detect → quality → warp → optional outline).
#[wasm_bindgen(js_name = rectify)]
pub fn rectify(
    image_bytes: &[u8],
    options_json: Option<String>,
    board_id: Option<String>,
    board_spec_json: Option<String>,
) -> Result<JsValue, JsError> {
    let spec = resolve_board_spec(board_id.as_deref(), board_spec_json.as_deref())
        .map_err(to_js_err)?;

    let options: RectifyOptions = if let Some(json) = options_json.as_deref() {
        serde_json::from_str(json).map_err(|e| JsError::new(&e.to_string()))?
    } else {
        RectifyOptions::default()
    };

    let outcome = rectify_in_memory(image_bytes, &spec, &options).map_err(to_js_err)?;

    let payload = RectifyPayload::from_outcome(&outcome, &options);
    serde_wasm_bindgen::to_value(&payload).map_err(|e| JsError::new(&e.to_string()))
}

fn resolve_board_spec(
    board_id: Option<&str>,
    board_spec_json: Option<&str>,
) -> anyhow::Result<BoardSpec> {
    if let Some(json) = board_spec_json {
        return BoardSpec::from_json_str(json);
    }
    let id = board_id.unwrap_or("refboard_v1");
    load_builtin_board_spec(id).or_else(|_| load_board_spec(&BoardSpecSource::BuiltIn(id.to_string())))
}

fn to_js_err(err: anyhow::Error) -> JsError {
    JsError::new(&format!("{err:#}"))
}

// ---------------------------------------------------------------------------
// Serialization payloads (keep the WASM surface small & explicit)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DetectPayload<'a> {
    detection: &'a rectify_core::BoardDetectionDebug,
    metadata: &'a rectify_core::TransformMetadata,
    input_width_px: u32,
    input_height_px: u32,
    prepared_width_px: u32,
    prepared_height_px: u32,
    #[serde(with = "serde_bytes")]
    prepared_png: &'a [u8],
}

impl<'a> DetectPayload<'a> {
    fn from_outcome(outcome: &'a DetectBoardOutcome) -> Self {
        Self {
            detection: &outcome.detection,
            metadata: &outcome.metadata,
            input_width_px: outcome.input_width_px,
            input_height_px: outcome.input_height_px,
            prepared_width_px: outcome.prepared_width_px,
            prepared_height_px: outcome.prepared_height_px,
            prepared_png: &outcome.prepared_png,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RectifyPayload<'a> {
    detection: &'a rectify_core::BoardDetectionDebug,
    quality: &'a rectify_core::QualityReport,
    metadata: &'a rectify_core::TransformMetadata,
    pixels_per_mm: f64,
    quality_failed: bool,
    #[serde(with = "serde_bytes")]
    prepared_png: &'a [u8],
    #[serde(with = "serde_bytes")]
    rectified_png: &'a [u8],
    options: &'a OutlineOptions,
    outline: Option<OutlinePayload<'a>>,
}

impl<'a> RectifyPayload<'a> {
    fn from_outcome(outcome: &'a RectifyOutcome, options: &'a RectifyOptions) -> Self {
        Self {
            detection: &outcome.detection,
            quality: &outcome.quality,
            metadata: &outcome.metadata,
            pixels_per_mm: outcome.pixels_per_mm,
            quality_failed: outcome.quality_failed,
            prepared_png: &outcome.prepared_png,
            rectified_png: &outcome.rectified_png,
            options: &options.outline,
            outline: outcome.outline.as_ref().map(OutlinePayload::from_bundle),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OutlinePayload<'a> {
    svg: &'a str,
    dxf: &'a str,
    json: &'a serde_json::Value,
    polygon_mm: &'a [[f64; 2]],
    metadata: &'a rectify_core::OutlineMetadata,
    #[serde(with = "serde_bytes")]
    mask_png: &'a [u8],
}

impl<'a> OutlinePayload<'a> {
    fn from_bundle(bundle: &'a rectify_core::OutlineBundle) -> Self {
        Self {
            svg: &bundle.svg,
            dxf: &bundle.dxf,
            json: &bundle.json,
            polygon_mm: &bundle.polygon_mm,
            metadata: &bundle.metadata,
            mask_png: &bundle.mask_png,
        }
    }
}

// `serde_bytes` isn't in the default dep graph. Provide a tiny serializer that
// converts slices to JS Uint8Array through serde-wasm-bindgen's `Serializer`
// with bytes enabled.
mod serde_bytes {
    pub fn serialize<S: serde::Serializer>(bytes: &[u8], ser: S) -> Result<S::Ok, S::Error> {
        ser.serialize_bytes(bytes)
    }
}
