import { usePipelineStore } from '../store/pipelineStore';

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function LogBar() {
  const toasts = usePipelineStore((s) => s.toasts);
  return (
    <div className="pd-logbar">
      {toasts.length === 0 ? (
        <div className="pd-log-entry">
          <span className="pd-log-time">—</span>
          <span className="pd-log-level-info">No log entries yet.</span>
        </div>
      ) : null}
      {toasts.map((t) => (
        <div key={t.id} className="pd-log-entry">
          <span className="pd-log-time">{formatTime(t.timestamp)}</span>
          <span className={`pd-log-level-${t.level}`}>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
