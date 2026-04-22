/// <reference lib="webworker" />
/**
 * Comlink-exposed worker that loads the rectify-wasm module and runs the
 * pipeline off the main thread.
 */

import * as Comlink from 'comlink';
import initWasm, {
  builtinBoardSpec,
  detectBoard as wasmDetectBoard,
  rectify as wasmRectify,
  simplifyOutline as wasmSimplifyOutline,
} from '../wasm-pkg/rectify_wasm.js';

import type {
  DetectBoardResult,
  RectifyProgressEvent,
  RectifyProgressHandler,
  RectifyOptions,
  RectifyResult,
  SegmentationStats,
  SimplifyOutlineResult,
} from './types';

let initPromise: Promise<unknown> | null = null;
function ensureInit() {
  if (!initPromise) {
    initPromise = initWasm();
  }
  return initPromise;
}

const api = {
  async init() {
    await ensureInit();
  },

  async builtinBoardSpec(boardId: string): Promise<string> {
    await ensureInit();
    return builtinBoardSpec(boardId);
  },

  async detectBoard(bytes: Uint8Array, boardId?: string): Promise<DetectBoardResult> {
    await ensureInit();
    const raw = wasmDetectBoard(bytes, boardId ?? 'refboard_v1', undefined) as Record<
      string,
      unknown
    >;
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

  async rectify(
    bytes: Uint8Array,
    options: RectifyOptions,
    boardId?: string,
    onProgress?: RectifyProgressHandler,
  ): Promise<RectifyResult> {
    await ensureInit();
    const raw = wasmRectify(
      bytes,
      JSON.stringify(options),
      boardId ?? 'refboard_v1',
      undefined,
      onProgress
        ? ((event: unknown) => {
            void onProgress(event as RectifyProgressEvent);
          })
        : undefined,
    ) as Record<string, unknown>;
    const outline = raw.outline as Record<string, unknown> | null | undefined;
    const preparedPng = raw.preparedPng as Uint8Array;
    const rectifiedPng = raw.rectifiedPng as Uint8Array;
    const outlineResult = outline
      ? {
          svg: outline.svg as string,
          dxf: outline.dxf as string,
          json: outline.json,
          polygonMm: outline.polygonMm as Array<[number, number]>,
          rawPolygonMm: outline.rawPolygonMm as Array<[number, number]>,
          metadata: outline.metadata as RectifyResult['outline'] extends null
            ? never
            : NonNullable<RectifyResult['outline']>['metadata'],
          maskPng: outline.maskPng as Uint8Array,
        }
      : null;

    const result: RectifyResult = {
      detection: raw.detection as RectifyResult['detection'],
      quality: raw.quality as RectifyResult['quality'],
      metadata: raw.metadata as RectifyResult['metadata'],
      pixelsPerMm: raw.pixelsPerMm as number,
      qualityFailed: raw.qualityFailed as boolean,
      preparedPng,
      rectifiedPng,
      options: raw.options as RectifyResult['options'],
      outline: outlineResult,
    };

    const transferables: Transferable[] = [preparedPng.buffer, rectifiedPng.buffer];
    if (outlineResult) transferables.push(outlineResult.maskPng.buffer);
    return Comlink.transfer(result, transferables);
  },

  async simplifyOutline(
    rawPolygonMm: Array<[number, number]>,
    simplifyMm: number,
    segmentation: SegmentationStats,
    vertexCountRaw: number,
  ): Promise<SimplifyOutlineResult> {
    await ensureInit();
    const raw = wasmSimplifyOutline(
      JSON.stringify(rawPolygonMm),
      simplifyMm,
      JSON.stringify(segmentation),
      vertexCountRaw,
    ) as Record<string, unknown>;
    return {
      svg: raw.svg as string,
      dxf: raw.dxf as string,
      json: raw.json,
      polygonMm: raw.polygonMm as Array<[number, number]>,
      metadata: raw.metadata as SimplifyOutlineResult['metadata'],
    };
  },
};

export type EngineWorkerApi = typeof api;

Comlink.expose(api);
