import { create } from 'zustand';

const STORAGE_KEY = 'pattern-detector-settings';

export interface PipelineSettings {
  pixelsPerMm: number;
  simplifyMm: number;
  minPieceAreaMm2: number;
  boardMarginMm: number | null;
  boardSpec: string;
  showOverlays: boolean;
}

const DEFAULTS: PipelineSettings = {
  pixelsPerMm: 10,
  simplifyMm: 2,
  minPieceAreaMm2: 200,
  boardMarginMm: null,
  boardSpec: 'refboard_v1',
  showOverlays: true,
};

interface SettingsStore {
  settings: PipelineSettings;
  settingsOpen: boolean;
  aboutOpen: boolean;
  shortcutsOpen: boolean;
  updateSettings: (patch: Partial<PipelineSettings>) => void;
  resetSettings: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  openAbout: () => void;
  closeAbout: () => void;
  openShortcuts: () => void;
  closeShortcuts: () => void;
}

function loadSettings(): PipelineSettings {
  if (typeof localStorage === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<PipelineSettings>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

function persist(settings: PipelineSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: loadSettings(),
  settingsOpen: false,
  aboutOpen: false,
  shortcutsOpen: false,
  updateSettings(patch) {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    persist(next);
  },
  resetSettings() {
    set({ settings: { ...DEFAULTS } });
    persist(DEFAULTS);
  },
  openSettings() {
    set({ settingsOpen: true });
  },
  closeSettings() {
    set({ settingsOpen: false });
  },
  openAbout() {
    set({ aboutOpen: true });
  },
  closeAbout() {
    set({ aboutOpen: false });
  },
  openShortcuts() {
    set({ shortcutsOpen: true });
  },
  closeShortcuts() {
    set({ shortcutsOpen: false });
  },
}));
