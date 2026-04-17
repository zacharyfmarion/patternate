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
import { Button, IconButton } from '../components/ui';

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
  const toolHint =
    activeTool === 'pen'
      ? 'Click a segment to add a point.'
      : 'Select and drag points or handles to refine the shape.';

  return (
    <div className="pd-edit-toolbar">
      <div className="pd-edit-toolbar-copy">
        <div className="pd-edit-toolbar-title">Curve editor</div>
        <div className="pd-edit-toolbar-hint">{toolHint}</div>
      </div>

      <div className="pd-edit-toolbar-controls">
        <div className="pd-edit-toolgroup" role="group" aria-label="Tools">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            isActive={activeTool === 'select'}
            className="gap-1.5"
            onClick={() => setTool('select')}
            title="Select (V)"
          >
            <MousePointer2 size={14} /> Select
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            isActive={activeTool === 'pen'}
            className="gap-1.5"
            onClick={() => setTool('pen')}
            title="Pen (P) — click a segment to insert a node"
          >
            <PenTool size={14} /> Pen
          </Button>
        </div>

        <div className="pd-edit-toolgroup" role="group" aria-label="Refine">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="gap-1.5"
            onClick={() => polygon && autoSmooth(polygon, 0.5)}
            disabled={!polygon}
            title="Auto-smooth from original polygon"
          >
            <Sparkles size={14} /> Auto-smooth
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="gap-1.5"
            onClick={() => polygon && resetFromPolygon(polygon)}
            disabled={!polygon}
            title="Reset to original polygon"
          >
            <RefreshCw size={14} /> Reset
          </Button>
        </div>

        <div className="pd-edit-toolgroup" role="group" aria-label="History">
          <IconButton
            size="sm"
            onClick={undo}
            disabled={!canUndo}
            title="Undo (Cmd+Z)"
            aria-label="Undo"
          >
            <Undo2 size={14} />
          </IconButton>
          <IconButton
            size="sm"
            onClick={redo}
            disabled={!canRedo}
            title="Redo (Cmd+Shift+Z)"
            aria-label="Redo"
          >
            <Redo2 size={14} />
          </IconButton>
        </div>
      </div>

      <Button
        type="button"
        variant="primary"
        className="gap-1.5"
        onClick={exitEdit}
        title="Exit edit mode (keeps edits)"
      >
        <Check size={14} /> Done
      </Button>
    </div>
  );
}
