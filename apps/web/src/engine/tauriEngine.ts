/**
 * Tauri engine stub. v1 ships with Tauri scaffolded but not fully wired:
 * compute still runs through the Worker/WASM engine, but when present the
 * Tauri engine exposes extras like native file open.
 *
 * For the compute contract we just proxy to the worker engine so the UI is
 * unchanged between desktop and browser builds.
 */

import { WorkerEngine } from './workerEngine';
import type {
  EngineBridge,
  RectifyOptions,
  RectifyProgressHandler,
  SegmentationStats,
  SimplifyOutlineResult,
} from './types';

export class TauriEngine implements EngineBridge {
  private worker: WorkerEngine;

  constructor() {
    this.worker = new WorkerEngine();
  }

  async init() {
    await this.worker.init();
  }

  detectBoard(bytes: Uint8Array, boardId?: string) {
    return this.worker.detectBoard(bytes, boardId);
  }

  rectify(
    bytes: Uint8Array,
    options: RectifyOptions,
    boardId?: string,
    onProgress?: RectifyProgressHandler,
  ) {
    return this.worker.rectify(bytes, options, boardId, onProgress);
  }

  simplifyOutline(
    rawPolygonMm: Array<[number, number]>,
    simplifyMm: number,
    segmentation: SegmentationStats,
    vertexCountRaw: number,
  ): Promise<SimplifyOutlineResult> {
    return this.worker.simplifyOutline(
      rawPolygonMm,
      simplifyMm,
      segmentation,
      vertexCountRaw,
    );
  }

  builtinBoardSpec(boardId: string) {
    return this.worker.builtinBoardSpec(boardId);
  }

  /** Future: read bytes from disk via invoke('load_image_bytes'). */
  async loadImageBytes(path: string): Promise<Uint8Array> {
    const mod = await import('@tauri-apps/api/core');
    const bytes = (await mod.invoke('load_image_bytes', { path })) as number[] | Uint8Array;
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  }
}
