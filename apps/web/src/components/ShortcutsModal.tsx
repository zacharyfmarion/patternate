import { useSettingsStore } from '../store/settingsStore';
import { Modal } from './Modal';

const SHORTCUTS: Array<[string, string]> = [
  ['Cmd/Ctrl + ,', 'Open settings'],
  ['Cmd/Ctrl + /', 'Show shortcuts'],
  ['Cmd/Ctrl + `', 'Toggle log panel'],
  ['Esc', 'Close modal'],
];

export function ShortcutsModal() {
  const { shortcutsOpen, closeShortcuts } = useSettingsStore();
  return (
    <Modal open={shortcutsOpen} onClose={closeShortcuts} title="Keyboard Shortcuts">
      <dl className="pd-kv">
        {SHORTCUTS.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
