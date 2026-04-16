import * as Comlink from 'comlink';

import type {
  DetectBoardResult,
  EngineBridge,
  RectifyOptions,
  RectifyResult,
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
  ): Promise<RectifyResult> {
    await this.ready;
    return this.api.rectify(bytes, options, boardId);
  }

  async builtinBoardSpec(boardId: string): Promise<string> {
    await this.ready;
    return this.api.builtinBoardSpec(boardId);
  }

  dispose() {
    this.worker.terminate();
  }
}
