import { create, type StateCreator } from 'zustand';
import { devtools } from 'zustand/middleware';

import type {
  RectifyProgressEvent,
  RectifyProgressStatus,
  RectifyProgressStep,
  RectifyResult,
} from '../engine/types';
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

export type RunProgressItemStatus = RectifyProgressStatus | 'pending';

export interface RunProgressItem {
  step: RectifyProgressStep;
  label: string;
  status: RunProgressItemStatus;
  message: string;
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
  runProgress: RunProgressItem[];
  run: () => Promise<void>;
  rerunOutline: () => Promise<void>;
}

interface ToastSlice {
  toasts: Toast[];
  pushToast: (level: ToastLevel, message: string) => void;
  clearToasts: () => void;
}

type PipelineState = InputSlice & RunSlice & ToastSlice;

const RUN_PROGRESS_ORDER: RectifyProgressStep[] = [
  'prepare_input',
  'detect_board',
  'assess_quality',
  'rectify_image',
  'extract_outline',
  'finalize_results',
];

const RUN_PROGRESS_LABELS: Record<RectifyProgressStep, string> = {
  prepare_input: 'Prepare input image',
  detect_board: 'Detect reference board',
  assess_quality: 'Check image quality',
  rectify_image: 'Rectify board plane',
  extract_outline: 'Extract pattern outline',
  finalize_results: 'Show results',
};

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

function createRunProgress(): RunProgressItem[] {
  return RUN_PROGRESS_ORDER.map((step) => ({
    step,
    label: RUN_PROGRESS_LABELS[step],
    status: 'pending',
    message: '',
  }));
}

function applyProgressEvent(
  progress: RunProgressItem[],
  event: RectifyProgressEvent,
): RunProgressItem[] {
  return progress.map((item) =>
    item.step === event.step
      ? {
          ...item,
          status: event.status,
          message: event.message,
        }
      : item,
  );
}

function setProgressStep(
  progress: RunProgressItem[],
  step: RectifyProgressStep,
  status: RunProgressItemStatus,
  message: string,
): RunProgressItem[] {
  return progress.map((item) =>
    item.step === step
      ? {
          ...item,
          status,
          message,
        }
      : item,
  );
}

function failRunningStep(progress: RunProgressItem[], message: string): RunProgressItem[] {
  const active = progress.find((item) => item.status === 'running');
  return active
    ? setProgressStep(progress, active.step, 'failed', message)
    : progress;
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
      runProgress: [],
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
      runProgress: [],
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
  runProgress: [],
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
      runProgress: createRunProgress(),
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
        (event) =>
          set((state) => ({
            runProgress: applyProgressEvent(
              state.runProgress.length > 0 ? state.runProgress : createRunProgress(),
              event,
            ),
          })),
      );

      const preparedUrl = pngBlobUrl(result.preparedPng);
      const rectifiedUrl = pngBlobUrl(result.rectifiedPng);
      const maskUrl = result.outline ? pngBlobUrl(result.outline.maskPng) : null;
      const finalizedProgress = setProgressStep(
        get().runProgress.length > 0 ? get().runProgress : createRunProgress(),
        'finalize_results',
        'completed',
        result.qualityFailed
          ? 'Loaded validation details'
          : result.outline
            ? 'Loaded rectified image and outline'
            : 'Loaded rectified image',
      );

      if (result.qualityFailed) {
        set({
          runStatus: 'error',
          runError: result.quality.warnings.join('; ') || 'Quality check failed',
          result,
          preparedUrl,
          rectifiedUrl: null,
          maskUrl: null,
          runProgress: finalizedProgress,
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
        runProgress: finalizedProgress,
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
      set((state) => ({
        runStatus: 'error',
        runError: message,
        runProgress: failRunningStep(
          state.runProgress.length > 0 ? state.runProgress : createRunProgress(),
          message,
        ),
      }));
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
