import { useEffect, type PropsWithChildren } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
}

export function Modal({ open, onClose, title, children }: PropsWithChildren<Props>) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="pd-modal-backdrop" onClick={onClose}>
      <div className="pd-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pd-row-between">
          <h2>{title}</h2>
          <button className="pd-btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="pd-sep" />
        {children}
      </div>
    </div>
  );
}
