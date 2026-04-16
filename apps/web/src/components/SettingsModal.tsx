import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

import { useSettingsStore, type PipelineSettings } from '../store/settingsStore';
import { useThemeStore } from '../store/themeStore';
import { getAvailableThemes } from '../themes/presets';
import { SettingsCard, SettingsCardHeader, SettingsCardSection } from './SettingsCard';
import { ThemePicker } from './ThemePicker';

type SettingsTab = 'general' | 'theme';

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'general', label: 'General' },
  { key: 'theme', label: 'Theme / UI' },
];

export function SettingsModal() {
  const { settingsOpen, closeSettings, settings, updateSettings, resetSettings } =
    useSettingsStore();
  const { currentThemeId, setTheme } = useThemeStore();
  const availableThemes = getAvailableThemes();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  useEffect(() => {
    if (settingsOpen) setActiveTab('general');
  }, [settingsOpen]);

  function set<K extends keyof PipelineSettings>(key: K, value: PipelineSettings[K]) {
    updateSettings({ [key]: value } as Partial<PipelineSettings>);
  }

  const activeLabel = TABS.find((t) => t.key === activeTab)!.label;

  return (
    <Dialog.Root
      open={settingsOpen}
      onOpenChange={(open) => {
        if (!open) closeSettings();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="pd-settings-dialog-overlay" />
        <Dialog.Content className="pd-settings-dialog-content" aria-describedby={undefined}>
          <div className="pd-settings-dialog-shell">
            <aside className="pd-settings-dialog-nav" aria-label="Settings sections">
              <div className="pd-settings-dialog-nav-title">Settings</div>
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className="pd-settings-dialog-nav-item"
                  data-active={activeTab === tab.key ? 'true' : 'false'}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </aside>

            <div className="pd-settings-dialog-main">
              <header className="pd-settings-dialog-header">
                <Dialog.Title className="pd-settings-dialog-heading">{activeLabel}</Dialog.Title>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="pd-settings-dialog-close"
                    title="Close"
                    aria-label="Close settings"
                  >
                    <X size={18} />
                  </button>
                </Dialog.Close>
              </header>

              <div className="pd-settings-dialog-scroll">
                {activeTab === 'general' ? (
                  <>
                    <SettingsCard>
                      <SettingsCardHeader
                        title="Pipeline"
                        description="Values used when you run detection and export outlines."
                      />
                      <SettingsCardSection>
                        <div className="pd-form-row">
                          <label htmlFor="pixelsPerMm">Pixels per mm</label>
                          <input
                            id="pixelsPerMm"
                            type="number"
                            min={1}
                            max={40}
                            step={0.5}
                            value={settings.pixelsPerMm}
                            onChange={(e) => set('pixelsPerMm', Number(e.target.value))}
                          />
                        </div>

                        <div className="pd-form-row">
                          <label htmlFor="simplifyMm">Simplify tolerance (mm)</label>
                          <input
                            id="simplifyMm"
                            type="number"
                            min={0}
                            max={5}
                            step={0.1}
                            value={settings.simplifyMm}
                            onChange={(e) => set('simplifyMm', Number(e.target.value))}
                          />
                        </div>

                        <div className="pd-form-row">
                          <label htmlFor="minPieceAreaMm2">Min piece area (mm²)</label>
                          <input
                            id="minPieceAreaMm2"
                            type="number"
                            min={0}
                            step={10}
                            value={settings.minPieceAreaMm2}
                            onChange={(e) => set('minPieceAreaMm2', Number(e.target.value))}
                          />
                        </div>

                        <div className="pd-form-row">
                          <label htmlFor="boardMarginMm">Board margin (mm, optional)</label>
                          <input
                            id="boardMarginMm"
                            type="number"
                            step={0.5}
                            value={settings.boardMarginMm ?? ''}
                            placeholder="default = board quiet zone"
                            onChange={(e) =>
                              set(
                                'boardMarginMm',
                                e.target.value === '' ? null : Number(e.target.value),
                              )
                            }
                          />
                        </div>

                        <div className="pd-form-row">
                          <label htmlFor="boardSpec">Board spec</label>
                          <select
                            id="boardSpec"
                            value={settings.boardSpec}
                            onChange={(e) => set('boardSpec', e.target.value)}
                          >
                            <option value="refboard_v1">refboard_v1 (built-in)</option>
                          </select>
                        </div>

                        <div className="pd-form-row">
                          <label htmlFor="showOverlays">Show detection overlays</label>
                          <input
                            id="showOverlays"
                            type="checkbox"
                            checked={settings.showOverlays}
                            onChange={(e) => set('showOverlays', e.target.checked)}
                          />
                        </div>
                      </SettingsCardSection>
                    </SettingsCard>

                    <div className="pd-settings-dialog-footer">
                      <button type="button" className="pd-btn pd-btn-ghost" onClick={resetSettings}>
                        Reset pipeline to defaults
                      </button>
                      <Dialog.Close asChild>
                        <button type="button" className="pd-btn pd-btn-primary">
                          Done
                        </button>
                      </Dialog.Close>
                    </div>
                  </>
                ) : (
                  <>
                    <SettingsCard data-testid="settings-theme-picker">
                      <SettingsCardHeader
                        title="Theme"
                        description="Choose a color theme for the entire application."
                      />
                      <SettingsCardSection>
                        <ThemePicker
                          sections={availableThemes}
                          value={currentThemeId}
                          onChange={setTheme}
                        />
                      </SettingsCardSection>
                    </SettingsCard>
                    <div className="pd-settings-dialog-footer pd-settings-dialog-footer-end">
                      <Dialog.Close asChild>
                        <button type="button" className="pd-btn pd-btn-primary">
                          Done
                        </button>
                      </Dialog.Close>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
