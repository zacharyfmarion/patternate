import { create } from 'zustand';

import { applyTheme } from '../themes/applyTheme';
import { DEFAULT_THEME, THEMES, getTheme } from '../themes/presets';
import type { Theme } from '../themes/types';

const STORAGE_KEY = 'pattern-detector-theme';

function loadInitial(): string {
  if (typeof localStorage === 'undefined') return DEFAULT_THEME;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw && THEMES[raw]) return raw;
  return DEFAULT_THEME;
}

interface ThemeStore {
  currentThemeId: string;
  currentTheme: Theme;
  setTheme: (id: string) => void;
  /**
   * Toggle between the light and dark counterparts of the same category
   * (falling back to github-dark / github-light as a sensible default pair).
   */
  toggleLightDark: () => void;
}

const DEFAULT_DARK = 'github-dark';
const DEFAULT_LIGHT = 'github-light';

export const useThemeStore = create<ThemeStore>((set, get) => {
  const initialId = loadInitial();
  return {
    currentThemeId: initialId,
    currentTheme: getTheme(initialId),
    setTheme(id) {
      const theme = THEMES[id];
      if (!theme) return;
      set({ currentThemeId: id, currentTheme: theme });
      applyTheme(theme);
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {
        // ignore
      }
    },
    toggleLightDark() {
      const current = get().currentTheme;
      if (current.type === 'dark') {
        const lightInCategory = Object.values(THEMES).find(
          (t) => t.type === 'light' && t.category === current.category,
        );
        get().setTheme(lightInCategory?.id ?? DEFAULT_LIGHT);
      } else {
        const darkInCategory = Object.values(THEMES).find(
          (t) => t.type === 'dark' && t.category === current.category,
        );
        get().setTheme(darkInCategory?.id ?? DEFAULT_DARK);
      }
    },
  };
});

export function initializeTheme() {
  const theme = useThemeStore.getState().currentTheme;
  applyTheme(theme);
}
