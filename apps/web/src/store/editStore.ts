import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

import {
  autoSmoothSpline,
  moveHandle as splineMoveHandle,
  moveNode as splineMoveNode,
  polygonToSpline,
  removeNodes as splineRemoveNodes,
  setNodeKind as splineSetNodeKind,
  splitSegmentAt,
  type NodeKind,
  type Point,
  type SplinePath,
} from '../edit/splinePath';

export type EditTool = 'select' | 'pen';

const MAX_HISTORY = 100;

interface EditStoreState {
  editMode: boolean;
  spline: SplinePath | null;
  selectedIds: string[];
  activeTool: EditTool;
  history: { past: SplinePath[]; future: SplinePath[] };
  flattenToleranceMm: number;
  dirty: boolean;
}

interface EditStoreActions {
  enterEdit: (polygon: Point[]) => void;
  exitEdit: () => void;
  discard: () => void;
  autoSmooth: (polygon: Point[], tension: number) => void;
  resetFromPolygon: (polygon: Point[]) => void;

  setTool: (tool: EditTool) => void;
  setSelection: (ids: string[]) => void;
  toggleSelection: (id: string, additive: boolean) => void;
  clearSelection: () => void;

  moveNodes: (ids: string[], dx: number, dy: number) => void;
  moveHandle: (id: string, which: 'in' | 'out', x: number, y: number) => void;
  setNodeKind: (id: string, kind: NodeKind) => void;
  insertOnSegment: (segmentIndex: number, t: number) => void;
  deleteSelected: () => void;

  beginInteraction: () => void;
  commitInteraction: () => void;
  cancelInteraction: () => void;

  undo: () => void;
  redo: () => void;

  setFlattenTolerance: (mm: number) => void;
}

type EditStore = EditStoreState & EditStoreActions;

const initialState: EditStoreState = {
  editMode: false,
  spline: null,
  selectedIds: [],
  activeTool: 'select',
  history: { past: [], future: [] },
  flattenToleranceMm: 0.05,
  dirty: false,
};

/**
 * During a drag we don't want to push a new history entry on every pointermove.
 * `beginInteraction` snapshots the spline, `commitInteraction` pushes that
 * snapshot onto the undo stack once the drag finishes.
 */
let interactionSnapshot: SplinePath | null = null;

function pushHistory(past: SplinePath[], snapshot: SplinePath): SplinePath[] {
  const next = past.concat(snapshot);
  if (next.length > MAX_HISTORY) next.splice(0, next.length - MAX_HISTORY);
  return next;
}

export const useEditStore = create<EditStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      enterEdit(polygon) {
        const spline = polygonToSpline(polygon);
        set({
          editMode: true,
          spline,
          selectedIds: [],
          activeTool: 'select',
          history: { past: [], future: [] },
          dirty: false,
        });
      },

      exitEdit() {
        set({
          editMode: false,
          spline: null,
          selectedIds: [],
          activeTool: 'select',
          history: { past: [], future: [] },
          dirty: false,
        });
      },

      discard() {
        set({ ...initialState });
      },

      autoSmooth(polygon, tension) {
        const { spline, history } = get();
        if (!spline) return;
        const next = autoSmoothSpline(polygon, tension);
        set({
          spline: next,
          history: { past: pushHistory(history.past, spline), future: [] },
          selectedIds: [],
          dirty: true,
        });
      },

      resetFromPolygon(polygon) {
        const { spline, history } = get();
        const next = polygonToSpline(polygon);
        set({
          spline: next,
          history: spline
            ? { past: pushHistory(history.past, spline), future: [] }
            : { past: [], future: [] },
          selectedIds: [],
          dirty: false,
        });
      },

      setTool(tool) {
        set({ activeTool: tool });
      },

      setSelection(ids) {
        set({ selectedIds: ids });
      },

      toggleSelection(id, additive) {
        const ids = new Set(get().selectedIds);
        if (additive) {
          if (ids.has(id)) ids.delete(id);
          else ids.add(id);
        } else {
          ids.clear();
          ids.add(id);
        }
        set({ selectedIds: Array.from(ids) });
      },

      clearSelection() {
        set({ selectedIds: [] });
      },

      moveNodes(ids, dx, dy) {
        const { spline } = get();
        if (!spline) return;
        let next = spline;
        for (const id of ids) {
          next = splineMoveNode(next, id, dx, dy);
        }
        set({ spline: next, dirty: true });
      },

      moveHandle(id, which, x, y) {
        const { spline } = get();
        if (!spline) return;
        const next = splineMoveHandle(spline, id, which, x, y);
        set({ spline: next, dirty: true });
      },

      setNodeKind(id, kind) {
        const { spline, history } = get();
        if (!spline) return;
        const next = splineSetNodeKind(spline, id, kind);
        set({
          spline: next,
          history: { past: pushHistory(history.past, spline), future: [] },
          dirty: true,
        });
      },

      insertOnSegment(segmentIndex, t) {
        const { spline, history } = get();
        if (!spline) return;
        const next = splitSegmentAt(spline, segmentIndex, t);
        const newId = next.nodes[(segmentIndex + 1) % next.nodes.length]?.id;
        set({
          spline: next,
          history: { past: pushHistory(history.past, spline), future: [] },
          selectedIds: newId ? [newId] : [],
          dirty: true,
        });
      },

      deleteSelected() {
        const { spline, selectedIds, history } = get();
        if (!spline || selectedIds.length === 0) return;
        // Preserve at least 3 nodes — a pattern outline needs a polygon.
        const remainingCount = spline.nodes.length - selectedIds.length;
        if (remainingCount < 3) return;
        const next = splineRemoveNodes(spline, new Set(selectedIds));
        set({
          spline: next,
          history: { past: pushHistory(history.past, spline), future: [] },
          selectedIds: [],
          dirty: true,
        });
      },

      beginInteraction() {
        const { spline } = get();
        interactionSnapshot = spline ? { ...spline, nodes: spline.nodes.slice() } : null;
      },

      commitInteraction() {
        const { spline, history } = get();
        if (!spline || !interactionSnapshot) {
          interactionSnapshot = null;
          return;
        }
        // Skip no-op commits (shouldn't happen but guard anyway).
        if (interactionSnapshot === spline) {
          interactionSnapshot = null;
          return;
        }
        set({
          history: {
            past: pushHistory(history.past, interactionSnapshot),
            future: [],
          },
          dirty: true,
        });
        interactionSnapshot = null;
      },

      cancelInteraction() {
        if (!interactionSnapshot) return;
        set({ spline: interactionSnapshot });
        interactionSnapshot = null;
      },

      undo() {
        const { spline, history } = get();
        if (!spline || history.past.length === 0) return;
        const prev = history.past[history.past.length - 1];
        const nextPast = history.past.slice(0, -1);
        const nextFuture = [spline, ...history.future];
        set({
          spline: prev,
          history: { past: nextPast, future: nextFuture },
          selectedIds: [],
          dirty: true,
        });
      },

      redo() {
        const { spline, history } = get();
        if (!spline || history.future.length === 0) return;
        const [next, ...rest] = history.future;
        const nextPast = pushHistory(history.past, spline);
        set({
          spline: next,
          history: { past: nextPast, future: rest },
          selectedIds: [],
          dirty: true,
        });
      },

      setFlattenTolerance(mm) {
        set({ flattenToleranceMm: Math.max(0.005, mm) });
      },
    }),
    { name: 'pattern-detector/edit' },
  ),
);
