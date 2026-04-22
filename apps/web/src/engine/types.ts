/**
 * TypeScript mirrors of the rectify-core serde types.
 *
 * Kept as hand-written types rather than auto-generated so we can evolve
 * them independently of the Rust side when building the UI.
 */

export interface BoardDetectionMarker {
  id: number;
  corners_image: [[number, number], [number, number], [number, number], [number, number]];
}

export interface CharucoCornerObservation {
  id: number;
  image_xy: [number, number];
  board_xy_mm: [number, number];
}

export interface BoardDetectionSummary {
  board_id: string;
  marker_count: number;
  charuco_corner_count: number;
  confidence: number;
  board_outline_image: Array<[number, number]> | null;
  board_reprojection_rmse_px: number | null;
}

export interface BoardDetectionDebug {
  summary: BoardDetectionSummary;
  homography_board_mm_to_image: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
  markers: BoardDetectionMarker[];
  charuco_corners: CharucoCornerObservation[];
}

export interface ImageMetadata {
  width_px: number;
  height_px: number;
}

export interface ReferenceBoardMetadata {
  board_id: string;
  squares_x: number;
  squares_y: number;
  square_size_mm: number;
  marker_size_mm: number;
}

export interface ScaleMetadata {
  pixels_per_mm: number;
  mm_per_pixel: number;
}

export interface TransformMetadata {
  schema_version: number;
  phase: string;
  input_image: ImageMetadata;
  prepared_image: ImageMetadata;
  reference_board: ReferenceBoardMetadata;
  board_detection: BoardDetectionSummary;
  rectified_image?: ImageMetadata;
  rectified_bounds_mm?: [number, number, number, number];
  scale?: ScaleMetadata;
  homography_board_mm_to_image?: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
  homography_image_to_board_mm?: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
  outline?: OutlineMetadata;
}

export interface SegmentationStats {
  background_rgb: [number, number, number];
  otsu_threshold: number;
  component_count: number;
  piece_area_mm2: number;
  piece_pixel_count: number;
}

export interface OutlineMetadata {
  vertex_count_raw: number;
  vertex_count_simplified: number;
  simplify_tolerance_mm: number;
  bounding_box_mm: [number, number, number, number];
  area_mm2: number;
  perimeter_mm: number;
  segmentation: SegmentationStats;
}

export type QualityStatus = 'ok' | 'warning' | 'fail';

export interface QualityMetrics {
  blur_score: number;
  exposure_score: number;
  board_coverage: number;
  board_confidence: number;
  board_reprojection_rmse_px: number;
}

export interface QualityReport {
  schema_version: number;
  status: QualityStatus;
  warnings: string[];
  metrics: QualityMetrics;
}

export interface OutlineOptions {
  extract: boolean;
  simplify_mm: number;
  min_piece_area_mm2: number;
  board_margin_mm: number | null;
  smooth: boolean;
}

export interface RectifyOptions {
  pixels_per_mm: number | null;
  outline: OutlineOptions;
}

export type RectifyProgressStep =
  | 'prepare_input'
  | 'detect_board'
  | 'assess_quality'
  | 'rectify_image'
  | 'extract_outline'
  | 'finalize_results';

export type RectifyProgressStatus = 'running' | 'completed' | 'skipped' | 'failed';

export interface RectifyProgressEvent {
  step: RectifyProgressStep;
  status: RectifyProgressStatus;
  message: string;
}

export type RectifyProgressHandler = (event: RectifyProgressEvent) => void;

// ---------------------------------------------------------------------------
// Engine results (shape returned by rectify-wasm)
// ---------------------------------------------------------------------------

export interface DetectBoardResult {
  detection: BoardDetectionDebug;
  metadata: TransformMetadata;
  inputWidthPx: number;
  inputHeightPx: number;
  preparedWidthPx: number;
  preparedHeightPx: number;
  preparedPng: Uint8Array;
}

export interface OutlineResult {
  svg: string;
  dxf: string;
  json: unknown;
  polygonMm: Array<[number, number]>;
  rawPolygonMm: Array<[number, number]>;
  metadata: OutlineMetadata;
  maskPng: Uint8Array;
}

export interface SimplifyOutlineResult {
  svg: string;
  dxf: string;
  json: unknown;
  polygonMm: Array<[number, number]>;
  metadata: OutlineMetadata;
}

export interface RectifyResult {
  detection: BoardDetectionDebug;
  quality: QualityReport;
  metadata: TransformMetadata;
  pixelsPerMm: number;
  qualityFailed: boolean;
  preparedPng: Uint8Array;
  rectifiedPng: Uint8Array;
  options: OutlineOptions;
  outline: OutlineResult | null;
}

// ---------------------------------------------------------------------------
// Engine bridge contract
// ---------------------------------------------------------------------------

export interface EngineBridge {
  detectBoard(bytes: Uint8Array, boardId?: string): Promise<DetectBoardResult>;
  rectify(
    bytes: Uint8Array,
    options: RectifyOptions,
    boardId?: string,
    onProgress?: RectifyProgressHandler,
  ): Promise<RectifyResult>;
  simplifyOutline(
    rawPolygonMm: Array<[number, number]>,
    simplifyMm: number,
    segmentation: SegmentationStats,
    vertexCountRaw: number,
  ): Promise<SimplifyOutlineResult>;
  builtinBoardSpec(boardId: string): Promise<string>;
}
