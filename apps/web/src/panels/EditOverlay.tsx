import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useEditStore } from '../store/editStore';
import {
  projectPointToSpline,
  splineToSvgPath,
  type Point,
  type SplinePath,
} from '../edit/splinePath';

interface Props {
  /** Natural pixel width of the rectified image. */
  widthPx: number;
  /** Natural pixel height of the rectified image. */
  heightPx: number;
  /** Rectified-image origin in board-mm space. */
  originMm: Point;
  /** Scale factor from mm to rectified-image pixels. */
  pxPerMm: number;
  /** Click distance (in px) below which the pen tool inserts a node. */
  penSnapPx?: number;
}

type DragState =
  | { kind: 'anchor'; ids: string[]; startClientX: number; startClientY: number }
  | {
      kind: 'handle';
      id: string;
      which: 'in' | 'out';
    }
  | null;

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

export function EditOverlay({
  widthPx,
  heightPx,
  originMm,
  pxPerMm,
  penSnapPx = 12,
}: Props) {
  const spline = useEditStore((s) => s.spline);
  const selectedIds = useEditStore((s) => s.selectedIds);
  const activeTool = useEditStore((s) => s.activeTool);

  const toggleSelection = useEditStore((s) => s.toggleSelection);
  const clearSelection = useEditStore((s) => s.clearSelection);
  const moveNodes = useEditStore((s) => s.moveNodes);
  const moveHandle = useEditStore((s) => s.moveHandle);
  const setNodeKind = useEditStore((s) => s.setNodeKind);
  const insertOnSegment = useEditStore((s) => s.insertOnSegment);
  const beginInteraction = useEditStore((s) => s.beginInteraction);
  const commitInteraction = useEditStore((s) => s.commitInteraction);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState<DragState>(null);
  const draggingRef = useRef<DragState>(null);
  draggingRef.current = dragging;

  // -------------------------------------------------------------------------
  // Coordinate transforms
  // -------------------------------------------------------------------------

  const mmToPx = useCallback(
    (p: Point): Point => [
      (p[0] - originMm[0]) * pxPerMm,
      (p[1] - originMm[1]) * pxPerMm,
    ],
    [originMm, pxPerMm],
  );

  const clientToMm = useCallback(
    (clientX: number, clientY: number): Point => {
      const svg = svgRef.current;
      if (!svg) return [0, 0];
      const rect = svg.getBoundingClientRect();
      const sx = (clientX - rect.left) / rect.width;
      const sy = (clientY - rect.top) / rect.height;
      const xPx = sx * widthPx;
      const yPx = sy * heightPx;
      return [originMm[0] + xPx / pxPerMm, originMm[1] + yPx / pxPerMm];
    },
    [widthPx, heightPx, originMm, pxPerMm],
  );

  // -------------------------------------------------------------------------
  // Derived geometry
  // -------------------------------------------------------------------------

  const pathD = useMemo(() => {
    if (!spline) return '';
    return splineToSvgPath(spline, originMm, pxPerMm, 2);
  }, [spline, originMm, pxPerMm]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Node / handle radii in *viewBox* units so they scale with the image.
  const diag = Math.hypot(widthPx, heightPx);
  const nodeR = Math.max(4, diag / 300);
  const handleR = Math.max(3, diag / 400);
  const hitR = Math.max(10, diag / 200);
  const strokeW = Math.max(1, diag / 900);
  const pathStrokeW = Math.max(1.5, diag / 700);

  // -------------------------------------------------------------------------
  // Pointer handlers
  // -------------------------------------------------------------------------

  const onPointerDownAnchor = useCallback(
    (e: React.PointerEvent<SVGElement>, id: string) => {
      e.stopPropagation();
      e.preventDefault();
      if (activeTool === 'pen') {
        // Pen-click on a node toggles its kind (corner <-> smooth).
        if (!spline) return;
        const n = spline.nodes.find((x) => x.id === id);
        if (!n) return;
        setNodeKind(id, n.kind === 'corner' ? 'smooth' : 'corner');
        return;
      }
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      let ids = selectedIds;
      if (!selectedIds.includes(id)) {
        toggleSelection(id, additive);
        ids = additive ? Array.from(new Set([...selectedIds, id])) : [id];
      }
      beginInteraction();
      const next: DragState = {
        kind: 'anchor',
        ids,
        startClientX: e.clientX,
        startClientY: e.clientY,
      };
      setDragging(next);
      (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
    },
    [activeTool, beginInteraction, selectedIds, setNodeKind, spline, toggleSelection],
  );

  const onPointerDownHandle = useCallback(
    (
      e: React.PointerEvent<SVGElement>,
      id: string,
      which: 'in' | 'out',
    ) => {
      e.stopPropagation();
      e.preventDefault();
      if (activeTool !== 'select') return;
      beginInteraction();
      const next: DragState = { kind: 'handle', id, which };
      setDragging(next);
      (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
    },
    [activeTool, beginInteraction],
  );

  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const d = draggingRef.current;
      if (!d) return;
      if (d.kind === 'anchor') {
        const last = lastPointerRef.current ?? {
          x: d.startClientX,
          y: d.startClientY,
        };
        const scaleX = svgClientScale(svgRef.current, widthPx);
        const scaleY = svgClientScaleY(svgRef.current, heightPx);
        const incDxMm = (e.clientX - last.x) / scaleX / pxPerMm;
        const incDyMm = (e.clientY - last.y) / scaleY / pxPerMm;
        lastPointerRef.current = { x: e.clientX, y: e.clientY };
        if (incDxMm === 0 && incDyMm === 0) return;
        moveNodes(d.ids, incDxMm, incDyMm);
      } else if (d.kind === 'handle') {
        const [xMm, yMm] = clientToMm(e.clientX, e.clientY);
        moveHandle(d.id, d.which, xMm, yMm);
      }
    },
    [clientToMm, heightPx, moveHandle, moveNodes, pxPerMm, widthPx],
  );

  const endDrag = useCallback(() => {
    if (!draggingRef.current) return;
    commitInteraction();
    setDragging(null);
    lastPointerRef.current = null;
  }, [commitInteraction]);

  const onPointerUp = useCallback(() => endDrag(), [endDrag]);
  const onPointerCancel = useCallback(() => endDrag(), [endDrag]);

  const onBackgroundPointerDown = useCallback(
    (e: React.PointerEvent<SVGElement>) => {
      // Clicks on the empty background cancel selection (select tool) or
      // insert a node near the curve (pen tool).
      if (e.button !== 0) return;
      if (activeTool === 'pen' && spline) {
        const mm = clientToMm(e.clientX, e.clientY);
        const hit = projectPointToSpline(spline, mm);
        if (hit && hit.distanceMm * pxPerMm <= penSnapPx) {
          insertOnSegment(hit.segmentIndex, hit.t);
          return;
        }
      }
      clearSelection();
    },
    [activeTool, clearSelection, clientToMm, insertOnSegment, penSnapPx, pxPerMm, spline],
  );

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  if (!spline) return null;

  return (
    <svg
      ref={svgRef}
      className={`pd-edit-overlay pd-edit-tool-${activeTool}`}
      viewBox={`0 0 ${widthPx} ${heightPx}`}
      preserveAspectRatio="xMinYMin meet"
      style={{ width: '100%', height: '100%' }}
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {/* Filled outline. Clicks fall through to background handler. */}
      <path
        d={pathD}
        fill="rgba(240, 180, 0, 0.12)"
        stroke="rgba(240, 180, 0, 0.95)"
        strokeWidth={pathStrokeW}
        strokeLinejoin="round"
        pointerEvents="none"
      />

      {/* Handle lines for selected nodes */}
      {renderHandleLines(spline, selectedSet, mmToPx, strokeW)}

      {/* Handle dots for selected nodes */}
      {renderHandles(
        spline,
        selectedSet,
        mmToPx,
        handleR,
        hitR,
        onPointerDownHandle,
      )}

      {/* Anchor dots */}
      {renderAnchors(
        spline,
        selectedSet,
        mmToPx,
        nodeR,
        hitR,
        onPointerDownAnchor,
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function renderHandleLines(
  spline: SplinePath,
  selected: Set<string>,
  mmToPx: (p: Point) => Point,
  strokeW: number,
): React.ReactNode {
  const lines: React.ReactNode[] = [];
  for (const node of spline.nodes) {
    if (!selected.has(node.id)) continue;
    const a = mmToPx(node.anchor);
    if (node.handleIn) {
      const h = mmToPx(node.handleIn);
      lines.push(
        <line
          key={`${node.id}-hl-in`}
          x1={a[0]}
          y1={a[1]}
          x2={h[0]}
          y2={h[1]}
          stroke="rgba(76, 154, 255, 0.8)"
          strokeWidth={strokeW}
          pointerEvents="none"
        />,
      );
    }
    if (node.handleOut) {
      const h = mmToPx(node.handleOut);
      lines.push(
        <line
          key={`${node.id}-hl-out`}
          x1={a[0]}
          y1={a[1]}
          x2={h[0]}
          y2={h[1]}
          stroke="rgba(76, 154, 255, 0.8)"
          strokeWidth={strokeW}
          pointerEvents="none"
        />,
      );
    }
  }
  return lines;
}

function renderHandles(
  spline: SplinePath,
  selected: Set<string>,
  mmToPx: (p: Point) => Point,
  r: number,
  hitR: number,
  onDown: (
    e: React.PointerEvent<SVGElement>,
    id: string,
    which: 'in' | 'out',
  ) => void,
): React.ReactNode {
  const handles: React.ReactNode[] = [];
  for (const node of spline.nodes) {
    if (!selected.has(node.id)) continue;
    if (node.handleIn) {
      const p = mmToPx(node.handleIn);
      handles.push(
        <g key={`${node.id}-h-in`}>
          <circle
            cx={p[0]}
            cy={p[1]}
            r={hitR}
            fill="transparent"
            onPointerDown={(e) => onDown(e, node.id, 'in')}
            style={{ cursor: 'grab' }}
          />
          <circle
            cx={p[0]}
            cy={p[1]}
            r={r}
            fill="#4c9aff"
            stroke="#ffffff"
            strokeWidth={1}
            pointerEvents="none"
          />
        </g>,
      );
    }
    if (node.handleOut) {
      const p = mmToPx(node.handleOut);
      handles.push(
        <g key={`${node.id}-h-out`}>
          <circle
            cx={p[0]}
            cy={p[1]}
            r={hitR}
            fill="transparent"
            onPointerDown={(e) => onDown(e, node.id, 'out')}
            style={{ cursor: 'grab' }}
          />
          <circle
            cx={p[0]}
            cy={p[1]}
            r={r}
            fill="#4c9aff"
            stroke="#ffffff"
            strokeWidth={1}
            pointerEvents="none"
          />
        </g>,
      );
    }
  }
  return handles;
}

function renderAnchors(
  spline: SplinePath,
  selected: Set<string>,
  mmToPx: (p: Point) => Point,
  r: number,
  hitR: number,
  onDown: (e: React.PointerEvent<SVGElement>, id: string) => void,
): React.ReactNode {
  return spline.nodes.map((node) => {
    const isSelected = selected.has(node.id);
    const [x, y] = mmToPx(node.anchor);
    const fill =
      node.kind === 'corner'
        ? '#f0b400'
        : node.kind === 'symmetric'
          ? '#2fc98a'
          : '#ffffff';
    const stroke = isSelected ? '#4c9aff' : '#111';
    // Render corner nodes as squares, smooth/symmetric as circles.
    if (node.kind === 'corner') {
      const half = r;
      return (
        <g key={node.id} data-node-id={node.id}>
          <rect
            x={x - hitR}
            y={y - hitR}
            width={hitR * 2}
            height={hitR * 2}
            fill="transparent"
            onPointerDown={(e) => onDown(e, node.id)}
            style={{ cursor: 'grab' }}
          />
          <rect
            x={x - half}
            y={y - half}
            width={half * 2}
            height={half * 2}
            fill={fill}
            stroke={stroke}
            strokeWidth={isSelected ? 2 : 1}
            pointerEvents="none"
          />
        </g>
      );
    }
    return (
      <g key={node.id} data-node-id={node.id}>
        <circle
          cx={x}
          cy={y}
          r={hitR}
          fill="transparent"
          onPointerDown={(e) => onDown(e, node.id)}
          style={{ cursor: 'grab' }}
        />
        <circle
          cx={x}
          cy={y}
          r={r}
          fill={fill}
          stroke={stroke}
          strokeWidth={isSelected ? 2 : 1}
          pointerEvents="none"
        />
      </g>
    );
  });
}

// ---------------------------------------------------------------------------
// Keyboard handler (Delete, arrows, undo/redo) mounted globally while editing.
// ---------------------------------------------------------------------------

export function useEditKeyboardShortcuts() {
  const editMode = useEditStore((s) => s.editMode);
  const deleteSelected = useEditStore((s) => s.deleteSelected);
  const undo = useEditStore((s) => s.undo);
  const redo = useEditStore((s) => s.redo);
  const selectedIds = useEditStore((s) => s.selectedIds);
  const moveNodes = useEditStore((s) => s.moveNodes);
  const beginInteraction = useEditStore((s) => s.beginInteraction);
  const commitInteraction = useEditStore((s) => s.commitInteraction);
  const setTool = useEditStore((s) => s.setTool);

  useEffect(() => {
    if (!editMode) return;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.key === 'y' || e.key === 'Y') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.length > 0) {
          e.preventDefault();
          deleteSelected();
        }
        return;
      }
      if (e.key === 'v' || e.key === 'V') {
        setTool('select');
        return;
      }
      if (e.key === 'p' || e.key === 'P') {
        setTool('pen');
        return;
      }
      if (
        selectedIds.length > 0 &&
        (e.key === 'ArrowUp' ||
          e.key === 'ArrowDown' ||
          e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight')
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 0.1; // mm
        let dx = 0;
        let dy = 0;
        if (e.key === 'ArrowUp') dy = -step;
        if (e.key === 'ArrowDown') dy = step;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowRight') dx = step;
        beginInteraction();
        moveNodes(selectedIds, dx, dy);
        commitInteraction();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    editMode,
    deleteSelected,
    undo,
    redo,
    selectedIds,
    moveNodes,
    beginInteraction,
    commitInteraction,
    setTool,
  ]);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function svgClientScale(svg: SVGSVGElement | null, naturalWidth: number): number {
  if (!svg || naturalWidth === 0) return 1;
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0) return 1;
  return rect.width / naturalWidth;
}

function svgClientScaleY(svg: SVGSVGElement | null, naturalHeight: number): number {
  if (!svg || naturalHeight === 0) return 1;
  const rect = svg.getBoundingClientRect();
  if (rect.height === 0) return 1;
  return rect.height / naturalHeight;
}
