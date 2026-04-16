import {
  MousePointer2,
  PenTool,
  Sparkles,
  Undo2,
  Redo2,
  RefreshCw,
  Check,
} from 'lucide-react';

import { useEditStore } from '../store/editStore';
import { usePipelineStore } from '../store/pipelineStore';

export function EditToolbar() {
  const activeTool = useEditStore((s) => s.activeTool);
  const setTool = useEditStore((s) => s.setTool);
  const undo = useEditStore((s) => s.undo);
  const redo = useEditStore((s) => s.redo);
  const exitEdit = useEditStore((s) => s.exitEdit);
  const autoSmooth = useEditStore((s) => s.autoSmooth);
  const resetFromPolygon = useEditStore((s) => s.resetFromPolygon);
  const canUndo = useEditStore((s) => s.history.past.length > 0);
  const canRedo = useEditStore((s) => s.history.future.length > 0);

  const result = usePipelineStore((s) => s.result);
  const polygon = result?.outline?.polygonMm;

  return (
    <div className="pd-edit-toolbar">
      <div className="pd-edit-toolgroup" role="group" aria-label="Tools">
        <button
          className="pd-iconbtn"
          data-active={activeTool === 'select'}
          onClick={() => setTool('select')}
          title="Select (V)"
        >
          <MousePointer2 size={14} /> Select
        </button>
        <button
          className="pd-iconbtn"
          data-active={activeTool === 'pen'}
          onClick={() => setTool('pen')}
          title="Pen (P) — click a segment to insert a node"
        >
          <PenTool size={14} /> Pen
        </button>
      </div>

      <div className="pd-edit-toolgroup">
        <button
          className="pd-iconbtn"
          onClick={() => polygon && autoSmooth(polygon, 0.5)}
          disabled={!polygon}
          title="Auto-smooth from original polygon"
        >
          <Sparkles size={14} /> Auto-smooth
        </button>
        <button
          className="pd-iconbtn"
          onClick={() => polygon && resetFromPolygon(polygon)}
          disabled={!polygon}
          title="Reset to original polygon"
        >
          <RefreshCw size={14} /> Reset
        </button>
      </div>

      <div className="pd-edit-toolgroup">
        <button
          className="pd-iconbtn"
          onClick={undo}
          disabled={!canUndo}
          title="Undo (Cmd+Z)"
        >
          <Undo2 size={14} />
        </button>
        <button
          className="pd-iconbtn"
          onClick={redo}
          disabled={!canRedo}
          title="Redo (Cmd+Shift+Z)"
        >
          <Redo2 size={14} />
        </button>
      </div>

      <span className="pd-spacer" />

      <button
        className="pd-btn pd-btn-primary"
        onClick={exitEdit}
        title="Exit edit mode (keeps edits)"
      >
        <Check size={14} /> Done
      </button>
    </div>
  );
}
