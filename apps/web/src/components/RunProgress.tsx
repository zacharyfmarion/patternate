import { AlertTriangle, Check, Minus } from 'lucide-react';

import type { RunProgressItem } from '../store/pipelineStore';

function ProgressIcon({ item }: { item: RunProgressItem }) {
  if (item.status === 'running') {
    return <span className="pd-spinner pd-spinner-sm" aria-hidden="true" />;
  }
  if (item.status === 'completed') {
    return (
      <span className="pd-progress-icon pd-progress-icon-completed" aria-hidden="true">
        <Check size={12} strokeWidth={3} />
      </span>
    );
  }
  if (item.status === 'failed') {
    return (
      <span className="pd-progress-icon pd-progress-icon-failed" aria-hidden="true">
        <AlertTriangle size={12} />
      </span>
    );
  }
  if (item.status === 'skipped') {
    return (
      <span className="pd-progress-icon pd-progress-icon-skipped" aria-hidden="true">
        <Minus size={12} strokeWidth={3} />
      </span>
    );
  }
  return <span className="pd-progress-icon pd-progress-icon-pending" aria-hidden="true" />;
}

export function RunProgress({ items }: { items: RunProgressItem[] }) {
  return (
    <ol className="pd-progress-list" aria-label="Pipeline progress">
      {items.map((item) => (
        <li
          key={item.step}
          className="pd-progress-step"
          data-status={item.status}
          aria-current={item.status === 'running' ? 'step' : undefined}
        >
          <div className="pd-progress-step-icon">
            <ProgressIcon item={item} />
          </div>
          <div className="pd-progress-step-copy">
            <div className="pd-progress-step-label">{item.label}</div>
            {item.message ? (
              <div className="pd-progress-step-message">{item.message}</div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
