import { useEffect, useMemo } from 'react';
import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from 'dockview';
import { Moon, Sun, Settings as SettingsIcon, Info, Keyboard, Terminal } from 'lucide-react';

import { WorkspacePanel } from './panels/WorkspacePanel';
import { InspectorPanel } from './panels/InspectorPanel';
import { LogBar } from './components/LogBar';
import { SettingsModal } from './components/SettingsModal';
import { AboutModal } from './components/AboutModal';
import { ShortcutsModal } from './components/ShortcutsModal';

import { useLayoutStore } from './store/layoutStore';
import { useThemeStore } from './store/themeStore';
import { useSettingsStore } from './store/settingsStore';
import { usePipelineStore } from './store/pipelineStore';

function WorkspaceSwitch(_props: IDockviewPanelProps) {
  return <WorkspacePanel />;
}

function InspectorSwitch(_props: IDockviewPanelProps) {
  return <InspectorPanel />;
}

export function App() {
  const { setApi, restore, isLogOpen, toggleLog } = useLayoutStore();
  const { currentTheme, toggleLightDark } = useThemeStore();
  const openSettings = useSettingsStore((s) => s.openSettings);
  const openAbout = useSettingsStore((s) => s.openAbout);
  const openShortcuts = useSettingsStore((s) => s.openShortcuts);
  const run = usePipelineStore((s) => s.run);
  const fileBytes = usePipelineStore((s) => s.fileBytes);
  const runStatus = usePipelineStore((s) => s.runStatus);

  const components = useMemo(
    () => ({
      workspace: WorkspaceSwitch,
      inspector: InspectorSwitch,
    }),
    [],
  );

  function onReady(event: DockviewReadyEvent) {
    setApi(event.api);
    restore();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === ',' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        openSettings();
      }
      if (e.key === '/' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        openShortcuts();
      }
      if (e.key === '`' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleLog();
      }
      if (
        e.key === 'Enter' &&
        (e.metaKey || e.ctrlKey) &&
        fileBytes &&
        runStatus !== 'running'
      ) {
        e.preventDefault();
        run();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openSettings, openShortcuts, toggleLog, run, fileBytes, runStatus]);

  return (
    <div className="pd-app">
      <header className="pd-topbar">
        <h1>Pattern Detector</h1>
        <span className="pd-spacer" />
        <button onClick={toggleLog} title="Toggle log (Cmd+`)">
          <Terminal size={14} /> Log
        </button>
        <button onClick={openShortcuts} title="Shortcuts (Cmd+/)">
          <Keyboard size={14} />
        </button>
        <button onClick={openAbout} title="About">
          <Info size={14} />
        </button>
        <button onClick={openSettings} title="Settings (Cmd+,)">
          <SettingsIcon size={14} />
        </button>
        <button
          onClick={toggleLightDark}
          title={
            currentTheme.type === 'dark'
              ? 'Switch to light theme (open Settings for more)'
              : 'Switch to dark theme (open Settings for more)'
          }
        >
          {currentTheme.type === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </header>

      <div className="pd-dockview-wrap">
        <DockviewReact
          className="dockview-theme-pattern-detector"
          theme={{ name: 'pattern-detector', className: '' }}
          components={components}
          onReady={onReady}
        />
      </div>

      {isLogOpen ? <LogBar /> : null}

      <SettingsModal />
      <AboutModal />
      <ShortcutsModal />
    </div>
  );
}
