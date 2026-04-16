/**
 * Main-thread fallback that calls the WASM module directly. Used when the
 * Worker engine fails to start. The API mirrors the Worker engine so the
 * rest of the app doesn't care which path ran.
 */

import initWasm, {
  builtinBoardSpec as wasmBuiltinBoardSpec,
  detectBoard as wasmDetectBoard,
  rectify as wasmRectify,
} from '../wasm-pkg/rectify_wasm.js';

import type {
  DetectBoardResult,
  EngineBridge,
  RectifyOptions,
  RectifyResult,
} from './types';

let initPromise: Promise<unknown> | null = null;
async function ensureInit() {
  if (!initPromise) initPromise = initWasm();
  await initPromise;
}

export const wasmEngine: EngineBridge = {
  async detectBoard(bytes, boardId = 'refboard_v1') {
    await ensureInit();
    const raw = wasmDetectBoard(bytes, boardId, undefined) as Record<string, unknown>;
    return {
      detection: raw.detection as DetectBoardResult['detection'],
      metadata: raw.metadata as DetectBoardResult['metadata'],
      inputWidthPx: raw.inputWidthPx as number,
      inputHeightPx: raw.inputHeightPx as number,
      preparedWidthPx: raw.preparedWidthPx as number,
      preparedHeightPx: raw.preparedHeightPx as number,
      preparedPng: raw.preparedPng as Uint8Array,
    };
  },

  async rectify(bytes, options: RectifyOptions, boardId = 'refboard_v1') {
    await ensureInit();
    const raw = wasmRectify(
      bytes,
      JSON.stringify(options),
      boardId,
      undefined,
    ) as Record<string, unknown>;
    const outline = raw.outline as Record<string, unknown> | null | undefined;
    return {
      detection: raw.detection as RectifyResult['detection'],
      quality: raw.quality as RectifyResult['quality'],
      metadata: raw.metadata as RectifyResult['metadata'],
      pixelsPerMm: raw.pixelsPerMm as number,
      qualityFailed: raw.qualityFailed as boolean,
      preparedPng: raw.preparedPng as Uint8Array,
      rectifiedPng: raw.rectifiedPng as Uint8Array,
      options: raw.options as RectifyResult['options'],
      outline: outline
        ? {
            svg: outline.svg as string,
            dxf: outline.dxf as string,
            json: outline.json,
            polygonMm: outline.polygonMm as Array<[number, number]>,
            metadata: outline.metadata as NonNullable<RectifyResult['outline']>['metadata'],
            maskPng: outline.maskPng as Uint8Array,
          }
        : null,
    };
  },

  async builtinBoardSpec(boardId) {
    await ensureInit();
    return wasmBuiltinBoardSpec(boardId);
  },
};

export async function initWasmEngine() {
  await ensureInit();
}
