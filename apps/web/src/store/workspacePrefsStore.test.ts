import {
  WORKSPACE_PREFS_STORAGE_KEY,
  createWorkspacePrefsStore,
  loadWorkspacePrefs,
} from './workspacePrefsStore';

describe('workspacePrefsStore', () => {
  it('loads guided mode by default when storage is empty', () => {
    expect(loadWorkspacePrefs(localStorage).welcomeMode).toBe('guided');

    const store = createWorkspacePrefsStore(localStorage);
    expect(store.getState().welcomeMode).toBe('guided');
  });

  it('persists streamlined mode when skipping the guide', () => {
    const store = createWorkspacePrefsStore(localStorage);

    store.getState().showStreamlinedWelcome();

    expect(store.getState().welcomeMode).toBe('streamlined');
    expect(localStorage.getItem(WORKSPACE_PREFS_STORAGE_KEY)).toBe(
      JSON.stringify({ welcomeMode: 'streamlined' }),
    );
  });

  it('rehydrates and can switch back to guided mode', () => {
    localStorage.setItem(
      WORKSPACE_PREFS_STORAGE_KEY,
      JSON.stringify({ welcomeMode: 'streamlined' }),
    );

    const store = createWorkspacePrefsStore(localStorage);
    expect(store.getState().welcomeMode).toBe('streamlined');

    store.getState().showGuidedWelcome();

    expect(store.getState().welcomeMode).toBe('guided');
    expect(localStorage.getItem(WORKSPACE_PREFS_STORAGE_KEY)).toBe(
      JSON.stringify({ welcomeMode: 'guided' }),
    );
  });
});
