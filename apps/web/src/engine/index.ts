import type { EngineBridge } from './types';

export * from './types';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

let enginePromise: Promise<EngineBridge> | null = null;

export async function createEngine(): Promise<EngineBridge> {
  if (isTauri()) {
    const { TauriEngine } = await import('./tauriEngine');
    const engine = new TauriEngine();
    await engine.init();
    console.info('[pattern-detector] Engine running via Tauri bridge');
    return engine;
  }

  const noWorker = new URLSearchParams(globalThis.location?.search ?? '').has(
    'noworker',
  );

  if (!noWorker && typeof Worker !== 'undefined') {
    try {
      const { WorkerEngine } = await import('./workerEngine');
      const engine = new WorkerEngine();
      await engine.init();
      console.info('[pattern-detector] Engine running in Web Worker');
      return engine;
    } catch (err) {
      console.warn(
        '[pattern-detector] Worker engine failed, falling back to main thread:',
        err,
      );
    }
  }

  const { initWasmEngine, wasmEngine } = await import('./wasmEngine');
  await initWasmEngine();
  console.info('[pattern-detector] Engine running on main thread');
  return wasmEngine;
}

export function getEngine(): Promise<EngineBridge> {
  if (!enginePromise) enginePromise = createEngine();
  return enginePromise;
}
