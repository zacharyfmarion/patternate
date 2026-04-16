import { create, type StateCreator } from 'zustand';
import { devtools } from 'zustand/middleware';

import type { RectifyResult } from '../engine/types';
import { getEngine } from '../engine';
import { useSettingsStore } from './settingsStore';
import { useEditStore } from './editStore';

// ---------------------------------------------------------------------------
// Run status / toast
// ---------------------------------------------------------------------------

export type RunStatus = 'idle' | 'running' | 'success' | 'error';

export type ToastLevel = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  level: ToastLevel;
  message: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Slices
// ---------------------------------------------------------------------------

interface InputSlice {
  fileName: string | null;
  fileBytes: Uint8Array | null;
  previewUrl: string | null;
  setInput: (name: string, bytes: Uint8Array) => void;
  clearInput: () => void;
}

interface RunSlice {
  runStatus: RunStatus;
  runError: string | null;
  result: RectifyResult | null;
  preparedUrl: string | null;
  rectifiedUrl: string | null;
  maskUrl: string | null;
  run: () => Promise<void>;
  rerunOutline: () => Promise<void>;
}

interface ToastSlice {
  toasts: Toast[];
  pushToast: (level: ToastLevel, message: string) => void;
  clearToasts: () => void;
}

type PipelineState = InputSlice & RunSlice & ToastSlice;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pngBlobUrl(bytes: Uint8Array | null | undefined): string | null {
  if (!bytes || bytes.length === 0) return null;
  const blob = new Blob([bytes as BlobPart], { type: 'image/png' });
  return URL.createObjectURL(blob);
}

function revoke(url: string | null) {
  if (url) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }
}

function imageBlobUrl(bytes: Uint8Array, fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
}

// ---------------------------------------------------------------------------
// Slice creators
// ---------------------------------------------------------------------------

const createInputSlice: StateCreator<PipelineState, [], [], InputSlice> = (set, get) => ({
  fileName: null,
  fileBytes: null,
  previewUrl: null,
  setInput(name, bytes) {
    revoke(get().previewUrl);
    revoke(get().preparedUrl);
    revoke(get().rectifiedUrl);
    revoke(get().maskUrl);
    useEditStore.getState().discard();
    const url = imageBlobUrl(bytes, name);
    set({
      fileName: name,
      fileBytes: bytes,
      previewUrl: url,
      runStatus: 'idle',
      runError: null,
      result: null,
      preparedUrl: null,
      rectifiedUrl: null,
      maskUrl: null,
    });
  },
  clearInput() {
    revoke(get().previewUrl);
    revoke(get().preparedUrl);
    revoke(get().rectifiedUrl);
    revoke(get().maskUrl);
    useEditStore.getState().discard();
    set({
      fileName: null,
      fileBytes: null,
      previewUrl: null,
      runStatus: 'idle',
      runError: null,
      result: null,
      preparedUrl: null,
      rectifiedUrl: null,
      maskUrl: null,
    });
  },
});

const createRunSlice: StateCreator<PipelineState, [], [], RunSlice> = (set, get) => ({
  runStatus: 'idle',
  runError: null,
  result: null,
  preparedUrl: null,
  rectifiedUrl: null,
  maskUrl: null,
  async run() {
    const { fileBytes } = get();
    if (!fileBytes) {
      get().pushToast('error', 'No image loaded');
      return;
    }
    revoke(get().preparedUrl);
    revoke(get().rectifiedUrl);
    revoke(get().maskUrl);
    useEditStore.getState().discard();
    set({
      runStatus: 'running',
      runError: null,
      result: null,
      preparedUrl: null,
      rectifiedUrl: null,
      maskUrl: null,
    });
    try {
      const engine = await getEngine();
      const { settings } = useSettingsStore.getState();
      const result = await engine.rectify(
        fileBytes,
        {
          pixels_per_mm: settings.pixelsPerMm,
          outline: {
            extract: true,
            simplify_mm: settings.simplifyMm,
            min_piece_area_mm2: settings.minPieceAreaMm2,
            board_margin_mm: settings.boardMarginMm,
            smooth: false,
          },
        },
        settings.boardSpec,
      );

      const preparedUrl = pngBlobUrl(result.preparedPng);
      const rectifiedUrl = pngBlobUrl(result.rectifiedPng);
      const maskUrl = result.outline ? pngBlobUrl(result.outline.maskPng) : null;

      if (result.qualityFailed) {
        set({
          runStatus: 'error',
          runError: result.quality.warnings.join('; ') || 'Quality check failed',
          result,
          preparedUrl,
          rectifiedUrl: null,
          maskUrl: null,
        });
        get().pushToast(
          'error',
          `Quality check failed: ${result.quality.warnings.join('; ')}`,
        );
        return;
      }

      set({
        runStatus: 'success',
        result,
        preparedUrl,
        rectifiedUrl,
        maskUrl,
      });
      if (result.outline) {
        get().pushToast(
          'success',
          `Outline extracted — ${result.outline.metadata.area_mm2.toFixed(
            1,
          )} mm² / ${result.outline.metadata.vertex_count_simplified} vertices`,
        );
      } else {
        get().pushToast(
          'warning',
          'Rectification succeeded but no outline could be extracted.',
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ runStatus: 'error', runError: message });
      get().pushToast('error', `Run failed: ${message}`);
    }
  },
  async rerunOutline() {
    // Re-runs the full pipeline with the current simplify setting.
    // Cheap enough at typical resolutions and keeps the model simple.
    await get().run();
  },
});

const createToastSlice: StateCreator<PipelineState, [], [], ToastSlice> = (set) => ({
  toasts: [],
  pushToast(level, message) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const toast: Toast = { id, level, message, timestamp: Date.now() };
    set((state) => ({ toasts: [...state.toasts.slice(-49), toast] }));
  },
  clearToasts() {
    set({ toasts: [] });
  },
});

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const usePipelineStore = create<PipelineState>()(
  devtools(
    (...args) => ({
      ...createInputSlice(...args),
      ...createRunSlice(...args),
      ...createToastSlice(...args),
    }),
    { name: 'pattern-detector/pipeline' },
  ),
);
