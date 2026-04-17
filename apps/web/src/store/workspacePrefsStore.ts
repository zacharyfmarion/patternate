import { create } from 'zustand';

export const WORKSPACE_PREFS_STORAGE_KEY = 'pattern-detector-workspace-prefs@v1';

export type WelcomeMode = 'guided' | 'streamlined';

export interface WorkspacePrefs {
  welcomeMode: WelcomeMode;
}

interface WorkspacePrefsActions {
  showGuidedWelcome: () => void;
  showStreamlinedWelcome: () => void;
}

type WorkspacePrefsStore = WorkspacePrefs & WorkspacePrefsActions;

export const DEFAULT_WORKSPACE_PREFS: WorkspacePrefs = {
  welcomeMode: 'guided',
};

export function loadWorkspacePrefs(storage: Storage | undefined = getStorage()): WorkspacePrefs {
  if (!storage) return DEFAULT_WORKSPACE_PREFS;
  try {
    const raw = storage.getItem(WORKSPACE_PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_WORKSPACE_PREFS;
    const parsed = JSON.parse(raw) as Partial<WorkspacePrefs>;
    return {
      ...DEFAULT_WORKSPACE_PREFS,
      ...parsed,
    };
  } catch {
    return DEFAULT_WORKSPACE_PREFS;
  }
}

function persistWorkspacePrefs(
  prefs: WorkspacePrefs,
  storage: Storage | undefined = getStorage(),
) {
  if (!storage) return;
  try {
    storage.setItem(WORKSPACE_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

function getStorage(): Storage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

export function createWorkspacePrefsStore(storage: Storage | undefined = getStorage()) {
  return create<WorkspacePrefsStore>((set) => ({
    ...loadWorkspacePrefs(storage),
    showGuidedWelcome() {
      const next = { welcomeMode: 'guided' as const };
      set(next);
      persistWorkspacePrefs(next, storage);
    },
    showStreamlinedWelcome() {
      const next = { welcomeMode: 'streamlined' as const };
      set(next);
      persistWorkspacePrefs(next, storage);
    },
  }));
}

export const useWorkspacePrefsStore = createWorkspacePrefsStore();
