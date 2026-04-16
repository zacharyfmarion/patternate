import { create } from 'zustand';
import { Orientation, type DockviewApi, type SerializedDockview } from 'dockview';

const STORAGE_KEY = 'pattern-detector-layout@v2';

export const DEFAULT_LAYOUT: SerializedDockview = {
  grid: {
    root: {
      type: 'branch',
      data: [
        {
          type: 'leaf',
          data: {
            views: ['workspace'],
            activeView: 'workspace',
            id: '1',
          },
          size: 900,
        },
        {
          type: 'leaf',
          data: {
            views: ['inspector'],
            activeView: 'inspector',
            id: '2',
          },
          size: 340,
        },
      ],
      size: 700,
    },
    width: 1240,
    height: 700,
    orientation: Orientation.HORIZONTAL,
  },
  panels: {
    workspace: {
      id: 'workspace',
      contentComponent: 'workspace',
      title: 'Workspace',
    },
    inspector: {
      id: 'inspector',
      contentComponent: 'inspector',
      title: 'Inspector',
    },
  },
  activeGroup: '1',
};

interface LayoutStore {
  api: DockviewApi | null;
  isLogOpen: boolean;
  setApi: (api: DockviewApi | null) => void;
  persist: () => void;
  restore: () => void;
  resetLayout: () => void;
  toggleLog: () => void;
}

export const useLayoutStore = create<LayoutStore>((set, get) => ({
  api: null,
  isLogOpen: false,
  setApi(api) {
    set({ api });
  },
  persist() {
    const api = get().api;
    if (!api) return;
    try {
      const state = api.toJSON();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore
    }
  },
  restore() {
    const api = get().api;
    if (!api) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        api.fromJSON(JSON.parse(raw) as SerializedDockview);
        return;
      }
    } catch (err) {
      console.warn('[pattern-detector] Failed to restore layout:', err);
    }
    api.fromJSON(DEFAULT_LAYOUT);
  },
  resetLayout() {
    const api = get().api;
    if (!api) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    api.fromJSON(DEFAULT_LAYOUT);
  },
  toggleLog() {
    set((state) => ({ isLogOpen: !state.isLogOpen }));
  },
}));
