import { useSettingsStore } from '../store/settingsStore';
import { Modal } from './Modal';

export function AboutModal() {
  const { aboutOpen, closeAbout } = useSettingsStore();
  return (
    <Modal
      open={aboutOpen}
      onOpenChange={(open) => {
        if (!open) closeAbout();
      }}
      title="About Pattern Detector"
    >
      <p>
        Pattern Detector is a browser-first tool for extracting pattern piece
        outlines from photographs of sewing patterns laid on a ChArUco
        calibration board.
      </p>
      <p>
        The full detect → rectify → outline → export pipeline runs locally in
        WebAssembly — no image bytes ever leave your machine.
      </p>
      <p style={{ color: 'var(--fg-muted)' }}>v0.1.0</p>
    </Modal>
  );
}
