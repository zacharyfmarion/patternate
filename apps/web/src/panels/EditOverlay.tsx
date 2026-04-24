import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useEditStore } from '../store/editStore';
import {
  projectPointToSpline,
  splineToSvgPath,
  type Point,
  type ProjectHit,
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
  | { kind: 'handle'; id: string; which: 'in' | 'out' }
  | { kind: 'segment'; segmentIndex: number; t: number; interactionStarted: boolean }
  | {
      kind: 'marquee';
      startClientX: number;
      startClientY: number;
      curClientX: number;
      curClientY: number;
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
  const setSelection = useEditStore((s) => s.setSelection);
  const moveNodes = useEditStore((s) => s.moveNodes);
  const moveHandle = useEditStore((s) => s.moveHandle);
  const moveSegment = useEditStore((s) => s.moveSegment);
  const setNodeKind = useEditStore((s) => s.setNodeKind);
  const insertOnSegment = useEditStore((s) => s.insertOnSegment);
  const beginInteraction = useEditStore((s) => s.beginInteraction);
  const commitInteraction = useEditStore((s) => s.commitInteraction);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState<DragState>(null);
  const draggingRef = useRef<DragState>(null);
  draggingRef.current = dragging;

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [penHoverHit, setPenHoverHit] = useState<ProjectHit | null>(null);

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
      const frame = getRenderedImageRect(svgRef.current, widthPx, heightPx);
      if (!frame) return [0, 0];
      const sx = (clientX - frame.left) / frame.width;
      const sy = (clientY - frame.top) / frame.height;
      const xPx = sx * widthPx;
      const yPx = sy * heightPx;
      return [originMm[0] + xPx / pxPerMm, originMm[1] + yPx / pxPerMm];
    },
    [widthPx, heightPx, originMm, pxPerMm],
  );

  // Convert a client-space rect to SVG viewBox space.
  const clientRectToSvg = useCallback(
    (x1: number, y1: number, x2: number, y2: number) => {
      const rect = getRenderedImageRect(svgRef.current, widthPx, heightPx);
      if (!rect) return { x: 0, y: 0, w: 0, h: 0 };
      const scaleX = widthPx / rect.width;
      const scaleY = heightPx / rect.height;
      const sx1 = clamp((x1 - rect.left) * scaleX, 0, widthPx);
      const sy1 = clamp((y1 - rect.top) * scaleY, 0, heightPx);
      const sx2 = clamp((x2 - rect.left) * scaleX, 0, widthPx);
      const sy2 = clamp((y2 - rect.top) * scaleY, 0, heightPx);
      return {
        x: Math.min(sx1, sx2),
        y: Math.min(sy1, sy2),
        w: Math.abs(sx2 - sx1),
        h: Math.abs(sy2 - sy1),
      };
    },
    [widthPx, heightPx],
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
      if (e.shiftKey) return;
      e.stopPropagation();
      e.preventDefault();
      if (activeTool === 'pen') {
        if (!spline) return;
        const n = spline.nodes.find((x) => x.id === id);
        if (!n) return;
        setNodeKind(id, n.kind === 'corner' ? 'smooth' : 'corner');
        return;
      }
      const additive = e.metaKey || e.ctrlKey;
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
      if (e.shiftKey) return;
      e.stopPropagation();
      e.preventDefault();
      beginInteraction();
      const next: DragState = { kind: 'handle', id, which };
      setDragging(next);
      (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
    },
    [beginInteraction],
  );

  const onDoubleClickSegment = useCallback(
    (e: React.MouseEvent<SVGPathElement>) => {
      e.stopPropagation();
      if (activeTool !== 'select' || !spline) return;
      const mm = clientToMm(e.clientX, e.clientY);
      const hit = projectPointToSpline(spline, mm);
      if (!hit) return;
      insertOnSegment(hit.segmentIndex, hit.t);
    },
    [activeTool, clientToMm, insertOnSegment, spline],
  );

  const onPointerDownSegment = useCallback(
    (e: React.PointerEvent<SVGPathElement>) => {
      if (e.shiftKey) return;
      e.stopPropagation();
      e.preventDefault();
      if (activeTool !== 'select' || !spline) return;
      const mm = clientToMm(e.clientX, e.clientY);
      const hit = projectPointToSpline(spline, mm);
      if (!hit) return;
      // beginInteraction is deferred to the first actual pointer move so that
      // a plain click (no drag) doesn't create a spurious undo entry.
      const next: DragState = {
        kind: 'segment',
        segmentIndex: hit.segmentIndex,
        t: hit.t,
        interactionStarted: false,
      };
      setDragging(next);
      (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
    },
    [activeTool, clientToMm, spline],
  );

  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const d = draggingRef.current;

      // Pen tool hover preview (no drag active).
      if (!d && activeTool === 'pen' && spline) {
        const mm = clientToMm(e.clientX, e.clientY);
        const hit = projectPointToSpline(spline, mm);
        if (hit && hit.distanceMm * pxPerMm <= penSnapPx) {
          setPenHoverHit(hit);
        } else {
          setPenHoverHit(null);
        }
        return;
      }

      if (!d) return;

      if (d.kind === 'anchor') {
        const last = lastPointerRef.current ?? {
          x: d.startClientX,
          y: d.startClientY,
        };
        const frame = getRenderedImageRect(svgRef.current, widthPx, heightPx);
        const scaleX = frame ? frame.width / widthPx : 1;
        const scaleY = frame ? frame.height / heightPx : 1;
        const incDxMm = (e.clientX - last.x) / scaleX / pxPerMm;
        const incDyMm = (e.clientY - last.y) / scaleY / pxPerMm;
        lastPointerRef.current = { x: e.clientX, y: e.clientY };
        if (incDxMm === 0 && incDyMm === 0) return;
        moveNodes(d.ids, incDxMm, incDyMm);
      } else if (d.kind === 'handle') {
        const [xMm, yMm] = clientToMm(e.clientX, e.clientY);
        moveHandle(d.id, d.which, xMm, yMm);
      } else if (d.kind === 'segment') {
        const last = lastPointerRef.current;
        if (last) {
          const frame = getRenderedImageRect(svgRef.current, widthPx, heightPx);
          const scaleX = frame ? frame.width / widthPx : 1;
          const scaleY = frame ? frame.height / heightPx : 1;
          const dx = (e.clientX - last.x) / scaleX / pxPerMm;
          const dy = (e.clientY - last.y) / scaleY / pxPerMm;
          if (dx !== 0 || dy !== 0) {
            if (!d.interactionStarted) {
              beginInteraction();
              setDragging({ ...d, interactionStarted: true });
            }
            moveSegment(d.segmentIndex, d.t, dx, dy);
          }
        }
        lastPointerRef.current = { x: e.clientX, y: e.clientY };
      } else if (d.kind === 'marquee') {
        setDragging({
          ...d,
          curClientX: e.clientX,
          curClientY: e.clientY,
        });
      }
    },
    [activeTool, beginInteraction, clientToMm, heightPx, moveHandle, moveNodes, moveSegment, penSnapPx, pxPerMm, spline, widthPx],
  );

  const endDrag = useCallback(() => {
    const d = draggingRef.current;
    if (!d) return;

    if (d.kind === 'marquee' && spline) {
      const { x, y, w, h } = clientRectToSvg(
        d.startClientX,
        d.startClientY,
        d.curClientX,
        d.curClientY,
      );
      // Convert SVG pixel rect to mm rect.
      const minX = originMm[0] + x / pxPerMm;
      const minY = originMm[1] + y / pxPerMm;
      const maxX = minX + w / pxPerMm;
      const maxY = minY + h / pxPerMm;
      const inside = spline.nodes
        .filter(
          (n) =>
            n.anchor[0] >= minX &&
            n.anchor[0] <= maxX &&
            n.anchor[1] >= minY &&
            n.anchor[1] <= maxY,
        )
        .map((n) => n.id);
      if (inside.length > 0) {
        setSelection(inside);
      } else {
        clearSelection();
      }
    } else if (d.kind === 'segment') {
      if (d.interactionStarted) commitInteraction();
    } else if (d.kind === 'anchor' || d.kind === 'handle') {
      commitInteraction();
    }
    setDragging(null);
    lastPointerRef.current = null;
  }, [clearSelection, clientRectToSvg, commitInteraction, originMm, pxPerMm, setSelection, spline]);

  const onPointerUp = useCallback(() => endDrag(), [endDrag]);
  const onPointerCancel = useCallback(() => endDrag(), [endDrag]);

  const onBackgroundPointerDown = useCallback(
    (e: React.PointerEvent<SVGElement>) => {
      if (e.button !== 0) return;
      if (e.shiftKey) return;
      if (activeTool === 'pen' && spline) {
        const mm = clientToMm(e.clientX, e.clientY);
        const hit = projectPointToSpline(spline, mm);
        if (hit && hit.distanceMm * pxPerMm <= penSnapPx) {
          insertOnSegment(hit.segmentIndex, hit.t);
          return;
        }
      }
      if (activeTool === 'select') {
        // Start a marquee drag instead of immediately clearing selection.
        const next: DragState = {
          kind: 'marquee',
          startClientX: e.clientX,
          startClientY: e.clientY,
          curClientX: e.clientX,
          curClientY: e.clientY,
        };
        setDragging(next);
        (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
        return;
      }
      clearSelection();
    },
    [activeTool, clearSelection, clientToMm, insertOnSegment, penSnapPx, pxPerMm, spline],
  );

  // Clear pen preview when tool changes.
  useEffect(() => {
    setPenHoverHit(null);
  }, [activeTool]);

  // -------------------------------------------------------------------------
  // Marquee rect in SVG space
  // -------------------------------------------------------------------------

  const marqueeRect = useMemo(() => {
    if (!dragging || dragging.kind !== 'marquee') return null;
    return clientRectToSvg(
      dragging.startClientX,
      dragging.startClientY,
      dragging.curClientX,
      dragging.curClientY,
    );
  }, [dragging, clientRectToSvg]);

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  if (!spline) return null;

  return (
    <svg
      ref={svgRef}
      className={`pd-edit-overlay pd-edit-tool-${activeTool}`}
      viewBox={`0 0 ${widthPx} ${heightPx}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: '100%', height: '100%' }}
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={() => setPenHoverHit(null)}
    >
      {/* Filled outline — not interactive. */}
      <path
        d={pathD}
        fill="rgba(240, 180, 0, 0.12)"
        stroke="rgba(240, 180, 0, 0.95)"
        strokeWidth={pathStrokeW}
        strokeLinejoin="round"
        pointerEvents="none"
      />

      {/* Segment hit area — wide transparent stroke so you can grab the curve.
          Only active in select mode; sits below handles/anchors in z-order. */}
      {activeTool === 'select' ? (
        <path
          d={pathD}
          fill="none"
          stroke="transparent"
          strokeWidth={hitR * 2}
          strokeLinejoin="round"
          style={{ cursor: 'crosshair' }}
          onPointerDown={onPointerDownSegment}
          onDoubleClick={onDoubleClickSegment}
        />
      ) : null}

      {/* Handle lines for selected nodes */}
      {renderHandleLines(spline, selectedSet, mmToPx, strokeW, hitR, onPointerDownHandle)}

      {/* Handle dots for selected nodes */}
      {renderHandles(
        spline,
        selectedSet,
        mmToPx,
        handleR,
        hitR,
        hoveredId,
        setHoveredId,
        onPointerDownHandle,
      )}

      {/* Anchor dots */}
      {renderAnchors(
        spline,
        selectedSet,
        mmToPx,
        nodeR,
        hitR,
        hoveredId,
        setHoveredId,
        onPointerDownAnchor,
      )}

      {/* Pen tool: insertion point preview */}
      {penHoverHit ? (
        <circle
          cx={mmToPx(penHoverHit.point)[0]}
          cy={mmToPx(penHoverHit.point)[1]}
          r={handleR * 1.5}
          fill="white"
          stroke="#4c9aff"
          strokeWidth={strokeW * 1.5}
          pointerEvents="none"
        />
      ) : null}

      {/* Marquee selection rectangle */}
      {marqueeRect ? (
        <rect
          x={marqueeRect.x}
          y={marqueeRect.y}
          width={marqueeRect.w}
          height={marqueeRect.h}
          fill="rgba(76, 154, 255, 0.08)"
          stroke="rgba(76, 154, 255, 0.7)"
          strokeWidth={strokeW}
          strokeDasharray={`${strokeW * 4} ${strokeW * 3}`}
          pointerEvents="none"
        />
      ) : null}
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
  hitR: number,
  onDown: (e: React.PointerEvent<SVGElement>, id: string, which: 'in' | 'out') => void,
): React.ReactNode {
  const lines: React.ReactNode[] = [];
  for (const node of spline.nodes) {
    if (!selected.has(node.id)) continue;
    const a = mmToPx(node.anchor);
    if (node.handleIn) {
      const h = mmToPx(node.handleIn);
      lines.push(
        <g key={`${node.id}-hl-in`}>
          {/* Invisible wide hit area */}
          <line
            x1={a[0]} y1={a[1]} x2={h[0]} y2={h[1]}
            stroke="transparent"
            strokeWidth={hitR * 2}
            style={{ cursor: 'grab' }}
            onPointerDown={(e) => onDown(e, node.id, 'in')}
          />
          {/* Visible thin line */}
          <line
            x1={a[0]} y1={a[1]} x2={h[0]} y2={h[1]}
            stroke="rgba(76, 154, 255, 0.8)"
            strokeWidth={strokeW}
            pointerEvents="none"
          />
        </g>,
      );
    }
    if (node.handleOut) {
      const h = mmToPx(node.handleOut);
      lines.push(
        <g key={`${node.id}-hl-out`}>
          <line
            x1={a[0]} y1={a[1]} x2={h[0]} y2={h[1]}
            stroke="transparent"
            strokeWidth={hitR * 2}
            style={{ cursor: 'grab' }}
            onPointerDown={(e) => onDown(e, node.id, 'out')}
          />
          <line
            x1={a[0]} y1={a[1]} x2={h[0]} y2={h[1]}
            stroke="rgba(76, 154, 255, 0.8)"
            strokeWidth={strokeW}
            pointerEvents="none"
          />
        </g>,
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
  hoveredId: string | null,
  setHoveredId: (id: string | null) => void,
  onDown: (
    e: React.PointerEvent<SVGElement>,
    id: string,
    which: 'in' | 'out',
  ) => void,
): React.ReactNode {
  const handles: React.ReactNode[] = [];
  for (const node of spline.nodes) {
    if (!selected.has(node.id)) continue;
    const isHovered = hoveredId === node.id;
    if (node.handleIn) {
      const p = mmToPx(node.handleIn);
      handles.push(
        <g
          key={`${node.id}-h-in`}
          onPointerEnter={() => setHoveredId(node.id)}
          onPointerLeave={() => setHoveredId(null)}
        >
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
            r={isHovered ? r * 1.4 : r}
            fill={isHovered ? '#6eb0ff' : '#4c9aff'}
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
        <g
          key={`${node.id}-h-out`}
          onPointerEnter={() => setHoveredId(node.id)}
          onPointerLeave={() => setHoveredId(null)}
        >
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
            r={isHovered ? r * 1.4 : r}
            fill={isHovered ? '#6eb0ff' : '#4c9aff'}
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
  hoveredId: string | null,
  setHoveredId: (id: string | null) => void,
  onDown: (e: React.PointerEvent<SVGElement>, id: string) => void,
): React.ReactNode {
  return spline.nodes.map((node) => {
    const isSelected = selected.has(node.id);
    const isHovered = hoveredId === node.id;
    const [x, y] = mmToPx(node.anchor);
    const fill =
      node.kind === 'corner'
        ? '#f0b400'
        : node.kind === 'symmetric'
          ? '#2fc98a'
          : '#ffffff';
    const stroke = isSelected ? '#4c9aff' : isHovered ? '#8ac4ff' : '#111';
    const displayR = isHovered && !isSelected ? r * 1.35 : r;

    if (node.kind === 'corner') {
      const half = displayR;
      return (
        <g
          key={node.id}
          data-node-id={node.id}
          onPointerEnter={() => setHoveredId(node.id)}
          onPointerLeave={() => setHoveredId(null)}
        >
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
      <g
        key={node.id}
        data-node-id={node.id}
        onPointerEnter={() => setHoveredId(node.id)}
        onPointerLeave={() => setHoveredId(null)}
      >
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
          r={displayR}
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

function getRenderedImageRect(
  svg: SVGSVGElement | null,
  naturalWidth: number,
  naturalHeight: number,
) {
  if (!svg || naturalWidth === 0 || naturalHeight === 0) return null;
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const scale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return {
    left: rect.left + (rect.width - width) / 2,
    top: rect.top + (rect.height - height) / 2,
    width,
    height,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
