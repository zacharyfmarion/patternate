import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

import { useEditStore } from '../store/editStore';
import { usePipelineStore } from '../store/pipelineStore';
import { useWorkspacePrefsStore } from '../store/workspacePrefsStore';

const pipelineActionDefaults = {
  setInput: usePipelineStore.getState().setInput,
  clearInput: usePipelineStore.getState().clearInput,
  run: usePipelineStore.getState().run,
  resimplify: usePipelineStore.getState().resimplify,
  patchOutlinePolygon: usePipelineStore.getState().patchOutlinePolygon,
  pushToast: usePipelineStore.getState().pushToast,
  clearToasts: usePipelineStore.getState().clearToasts,
};

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  writable: true,
  value: ResizeObserverMock,
});

Object.defineProperty(URL, 'createObjectURL', {
  writable: true,
  value: vi.fn(() => 'blob:mock-url'),
});

Object.defineProperty(URL, 'revokeObjectURL', {
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(globalThis, 'createImageBitmap', {
  writable: true,
  value: vi.fn(async () => ({
    width: 1600,
    height: 900,
    close: vi.fn(),
  })),
});

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  writable: true,
  value: vi.fn(() => ({
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
  })),
});

if (!SVGElement.prototype.setPointerCapture) {
  Object.defineProperty(SVGElement.prototype, 'setPointerCapture', {
    writable: true,
    value: vi.fn(),
  });
}

if (!SVGElement.prototype.releasePointerCapture) {
  Object.defineProperty(SVGElement.prototype, 'releasePointerCapture', {
    writable: true,
    value: vi.fn(),
  });
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  useWorkspacePrefsStore.setState({ welcomeMode: 'guided' });
  useEditStore.getState().discard();
  usePipelineStore.setState({
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
    resimplifyStatus: 'idle',
    toasts: [],
    ...pipelineActionDefaults,
  });
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});
