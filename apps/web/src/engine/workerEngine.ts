import * as Comlink from 'comlink';

import type {
  DetectBoardResult,
  EngineBridge,
  RectifyProgressHandler,
  RectifyOptions,
  RectifyResult,
  SegmentationStats,
  SimplifyOutlineResult,
} from './types';
import type { EngineWorkerApi } from './engineWorker';

export class WorkerEngine implements EngineBridge {
  private worker: Worker;
  private api: Comlink.Remote<EngineWorkerApi>;
  private ready: Promise<void>;

  constructor() {
    this.worker = new Worker(new URL('./engineWorker.ts', import.meta.url), {
      type: 'module',
      name: 'pattern-detector-engine',
    });
    this.api = Comlink.wrap<EngineWorkerApi>(this.worker);
    this.ready = this.api.init();
  }

  async init(): Promise<void> {
    await this.ready;
  }

  async detectBoard(bytes: Uint8Array, boardId?: string): Promise<DetectBoardResult> {
    await this.ready;
    return this.api.detectBoard(bytes, boardId);
  }

  async rectify(
    bytes: Uint8Array,
    options: RectifyOptions,
    boardId?: string,
    onProgress?: RectifyProgressHandler,
  ): Promise<RectifyResult> {
    await this.ready;
    return this.api.rectify(
      bytes,
      options,
      boardId,
      onProgress ? Comlink.proxy(onProgress) : undefined,
    );
  }

  async simplifyOutline(
    rawPolygonMm: Array<[number, number]>,
    simplifyMm: number,
    segmentation: SegmentationStats,
    vertexCountRaw: number,
  ): Promise<SimplifyOutlineResult> {
    await this.ready;
    return this.api.simplifyOutline(rawPolygonMm, simplifyMm, segmentation, vertexCountRaw);
  }

  async builtinBoardSpec(boardId: string): Promise<string> {
    await this.ready;
    return this.api.builtinBoardSpec(boardId);
  }

  dispose() {
    this.worker.terminate();
  }
}
