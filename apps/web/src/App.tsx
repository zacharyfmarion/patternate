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
import { Button, IconButton, TooltipProvider } from './components/ui';

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
    <TooltipProvider>
      <div className="pd-app">
        <header className="pd-topbar">
          <h1>Pattern Detector</h1>
          <span className="pd-spacer" />
          <div className="pd-topbar-actions" role="toolbar" aria-label="App actions">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="gap-1.5"
              onClick={toggleLog}
              title="Toggle log (Cmd+`)"
            >
              <Terminal size={14} /> Log
            </Button>
            <IconButton
              size="sm"
              onClick={openShortcuts}
              title="Shortcuts (Cmd+/)"
              aria-label="Shortcuts"
            >
              <Keyboard size={14} />
            </IconButton>
            <IconButton size="sm" onClick={openAbout} title="About" aria-label="About">
              <Info size={14} />
            </IconButton>
            <IconButton
              size="sm"
              onClick={openSettings}
              title="Settings (Cmd+,)"
              aria-label="Settings"
            >
              <SettingsIcon size={14} />
            </IconButton>
            <IconButton
              size="sm"
              onClick={toggleLightDark}
              title={
                currentTheme.type === 'dark'
                  ? 'Switch to light theme (open Settings for more)'
                  : 'Switch to dark theme (open Settings for more)'
              }
              aria-label={currentTheme.type === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {currentTheme.type === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </IconButton>
          </div>
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
    </TooltipProvider>
  );
}
