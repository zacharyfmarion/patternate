/**
 * Pure spline-path math for the outline editor.
 *
 * A `SplinePath` is a closed loop of `SplineNode`s. Each node has an anchor
 * and optional absolute-mm handles that describe the tangents going in and
 * out. A segment between two adjacent nodes is:
 *
 * - a straight line if both `a.handleOut` and `b.handleIn` are null
 * - a cubic Bezier otherwise (null handles collapse to the anchor)
 *
 * All coordinates are in board-millimetre space. The overlay converts to
 * pixel space for display; exports emit mm directly.
 */

export type NodeKind = 'corner' | 'smooth' | 'symmetric';

export type Point = [number, number];

export interface SplineNode {
  id: string;
  anchor: Point;
  handleIn: Point | null;
  handleOut: Point | null;
  kind: NodeKind;
}

export interface SplinePath {
  nodes: SplineNode[];
  closed: true;
}

// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------

let _idCounter = 0;
export function makeNodeId(): string {
  _idCounter += 1;
  return `n${_idCounter.toString(36)}`;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function polygonToSpline(polygon: Point[]): SplinePath {
  const nodes: SplineNode[] = polygon.map(([x, y]) => ({
    id: makeNodeId(),
    anchor: [x, y],
    handleIn: null,
    handleOut: null,
    kind: 'corner',
  }));
  return { nodes, closed: true };
}

/**
 * Centripetal Catmull-Rom to cubic-Bezier conversion, per-segment.
 *
 * `tension` ∈ [0..1] scales handle length. 0 collapses to straight lines
 * (identity polygon), 0.5 is balanced, 1.0 produces loopy exaggerated
 * tangents.
 */
export function autoSmoothSpline(
  polygon: Point[],
  tension: number,
): SplinePath {
  const n = polygon.length;
  if (n < 3) return polygonToSpline(polygon);

  const t = Math.max(0, Math.min(1, tension));
  const k = t / 3; // Catmull-Rom -> Bezier handle scale

  const nodes: SplineNode[] = polygon.map(([x, y]) => ({
    id: makeNodeId(),
    anchor: [x, y],
    handleIn: null,
    handleOut: null,
    kind: 'smooth',
  }));

  for (let i = 0; i < n; i += 1) {
    const prev = polygon[(i - 1 + n) % n];
    const curr = polygon[i];
    const next = polygon[(i + 1) % n];
    const tangentX = (next[0] - prev[0]) * k;
    const tangentY = (next[1] - prev[1]) * k;
    nodes[i].handleIn = [curr[0] - tangentX, curr[1] - tangentY];
    nodes[i].handleOut = [curr[0] + tangentX, curr[1] + tangentY];
  }

  return { nodes, closed: true };
}

// ---------------------------------------------------------------------------
// Segment access
// ---------------------------------------------------------------------------

/** A single segment from node i to node i+1 (wrapping on closed paths). */
export interface SegmentRef {
  i: number;
  a: SplineNode;
  b: SplineNode;
}

export function getSegment(path: SplinePath, i: number): SegmentRef {
  const n = path.nodes.length;
  const a = path.nodes[i % n];
  const b = path.nodes[(i + 1) % n];
  return { i: i % n, a, b };
}

export function segmentCount(path: SplinePath): number {
  return path.nodes.length;
}

function segmentControlPoints(
  a: SplineNode,
  b: SplineNode,
): [Point, Point, Point, Point] {
  const p0 = a.anchor;
  const p3 = b.anchor;
  const p1 = a.handleOut ?? a.anchor;
  const p2 = b.handleIn ?? b.anchor;
  return [p0, p1, p2, p3];
}

function segmentIsLinear(a: SplineNode, b: SplineNode): boolean {
  return a.handleOut === null && b.handleIn === null;
}

// ---------------------------------------------------------------------------
// SVG `d` string generation
// ---------------------------------------------------------------------------

function formatNum(n: number, digits = 3): string {
  if (!Number.isFinite(n)) return '0';
  return n.toFixed(digits);
}

interface RenderOpts {
  digits?: number;
  /** Map an mm point to whatever coordinate space we're rendering into. */
  transform?: (p: Point) => Point;
}

function mapPoint(p: Point, t?: (p: Point) => Point): Point {
  return t ? t(p) : p;
}

function renderD(path: SplinePath, opts: RenderOpts = {}): string {
  const { digits = 3, transform } = opts;
  const n = path.nodes.length;
  if (n === 0) return '';

  const parts: string[] = [];
  const first = mapPoint(path.nodes[0].anchor, transform);
  parts.push(`M ${formatNum(first[0], digits)} ${formatNum(first[1], digits)}`);

  for (let i = 0; i < n; i += 1) {
    const a = path.nodes[i];
    const b = path.nodes[(i + 1) % n];
    if (segmentIsLinear(a, b)) {
      const pb = mapPoint(b.anchor, transform);
      parts.push(`L ${formatNum(pb[0], digits)} ${formatNum(pb[1], digits)}`);
    } else {
      const [, p1, p2, p3] = segmentControlPoints(a, b);
      const mp1 = mapPoint(p1, transform);
      const mp2 = mapPoint(p2, transform);
      const mp3 = mapPoint(p3, transform);
      parts.push(
        `C ${formatNum(mp1[0], digits)} ${formatNum(mp1[1], digits)} ` +
          `${formatNum(mp2[0], digits)} ${formatNum(mp2[1], digits)} ` +
          `${formatNum(mp3[0], digits)} ${formatNum(mp3[1], digits)}`,
      );
    }
  }
  parts.push('Z');
  return parts.join(' ');
}

/** Render the path for the interactive overlay (pixel space). */
export function splineToSvgPath(
  path: SplinePath,
  boundsMinMm: Point,
  pxPerMm: number,
  digits = 2,
): string {
  const [minX, minY] = boundsMinMm;
  return renderD(path, {
    digits,
    transform: ([x, y]) => [(x - minX) * pxPerMm, (y - minY) * pxPerMm],
  });
}

/** Render the path in mm for file export (used by the SVG exporter). */
export function splineToSvgPathMm(
  path: SplinePath,
  originMm: Point = [0, 0],
  digits = 4,
): string {
  const [ox, oy] = originMm;
  return renderD(path, {
    digits,
    transform: ([x, y]) => [x - ox, y - oy],
  });
}

// ---------------------------------------------------------------------------
// Adaptive flattening (de Casteljau)
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpPt(a: Point, b: Point, t: number): Point {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
}

/**
 * Flatness metric: the maximum distance from a control point to the
 * chord p0→p3. Good enough to drive adaptive subdivision.
 */
function cubicFlatness(p0: Point, p1: Point, p2: Point, p3: Point): number {
  const dx = p3[0] - p0[0];
  const dy = p3[1] - p0[1];
  const chordLen = Math.hypot(dx, dy) || 1e-9;
  const d1 = Math.abs(dx * (p0[1] - p1[1]) - dy * (p0[0] - p1[0])) / chordLen;
  const d2 = Math.abs(dx * (p0[1] - p2[1]) - dy * (p0[0] - p2[0])) / chordLen;
  return Math.max(d1, d2);
}

function splitCubic(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  t: number,
): [
  [Point, Point, Point, Point],
  [Point, Point, Point, Point],
] {
  const q0 = lerpPt(p0, p1, t);
  const q1 = lerpPt(p1, p2, t);
  const q2 = lerpPt(p2, p3, t);
  const r0 = lerpPt(q0, q1, t);
  const r1 = lerpPt(q1, q2, t);
  const s = lerpPt(r0, r1, t);
  return [
    [p0, q0, r0, s],
    [s, r1, q2, p3],
  ];
}

function flattenCubic(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  toleranceMm: number,
  out: Point[],
  depth = 0,
) {
  if (depth > 24 || cubicFlatness(p0, p1, p2, p3) <= toleranceMm) {
    out.push(p3);
    return;
  }
  const [left, right] = splitCubic(p0, p1, p2, p3, 0.5);
  flattenCubic(left[0], left[1], left[2], left[3], toleranceMm, out, depth + 1);
  flattenCubic(
    right[0],
    right[1],
    right[2],
    right[3],
    toleranceMm,
    out,
    depth + 1,
  );
}

/** Flatten a closed spline path into a dense polyline (mm, no Z). */
export function flattenSpline(path: SplinePath, toleranceMm = 0.05): Point[] {
  const n = path.nodes.length;
  if (n === 0) return [];
  const out: Point[] = [[...path.nodes[0].anchor]];
  for (let i = 0; i < n; i += 1) {
    const a = path.nodes[i];
    const b = path.nodes[(i + 1) % n];
    if (segmentIsLinear(a, b)) {
      out.push([...b.anchor]);
    } else {
      const [p0, p1, p2, p3] = segmentControlPoints(a, b);
      flattenCubic(p0, p1, p2, p3, toleranceMm, out);
    }
  }
  // For a closed loop, drop the duplicate final vertex matching the start.
  if (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (
      Math.hypot(first[0] - last[0], first[1] - last[1]) <
      Math.max(1e-6, toleranceMm * 0.1)
    ) {
      out.pop();
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// De Casteljau split -> insert a new anchor on a segment
// ---------------------------------------------------------------------------

export function splitSegmentAt(
  path: SplinePath,
  segmentIndex: number,
  t: number,
): SplinePath {
  const n = path.nodes.length;
  const idx = ((segmentIndex % n) + n) % n;
  const aIdx = idx;
  const bIdx = (idx + 1) % n;
  const a = path.nodes[aIdx];
  const b = path.nodes[bIdx];
  const tt = Math.max(0.0001, Math.min(0.9999, t));

  let newA: SplineNode;
  let newMid: SplineNode;
  let newB: SplineNode;

  if (segmentIsLinear(a, b)) {
    const midX = lerp(a.anchor[0], b.anchor[0], tt);
    const midY = lerp(a.anchor[1], b.anchor[1], tt);
    newA = { ...a };
    newB = { ...b };
    newMid = {
      id: makeNodeId(),
      anchor: [midX, midY],
      handleIn: null,
      handleOut: null,
      kind: 'corner',
    };
  } else {
    const [p0, p1, p2, p3] = segmentControlPoints(a, b);
    const [left, right] = splitCubic(p0, p1, p2, p3, tt);
    // left  = [a.anchor, newOutA, newInMid, midAnchor]
    // right = [midAnchor, newOutMid, newInB, b.anchor]
    newA = {
      ...a,
      handleOut: [left[1][0], left[1][1]],
    };
    newMid = {
      id: makeNodeId(),
      anchor: [left[3][0], left[3][1]],
      handleIn: [left[2][0], left[2][1]],
      handleOut: [right[1][0], right[1][1]],
      kind: 'smooth',
    };
    newB = {
      ...b,
      handleIn: [right[2][0], right[2][1]],
    };
  }

  const nextNodes = path.nodes.slice();
  nextNodes[aIdx] = newA;
  nextNodes[bIdx] = newB;
  nextNodes.splice(bIdx, 0, newMid);
  return { ...path, nodes: nextNodes };
}

// ---------------------------------------------------------------------------
// Project a point to the closest point on the path (for the pen tool).
// ---------------------------------------------------------------------------

export interface ProjectHit {
  segmentIndex: number;
  t: number;
  point: Point;
  distanceMm: number;
}

function evalCubic(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  t: number,
): Point {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

function projectPointToSegment(
  p: Point,
  a: SplineNode,
  b: SplineNode,
): { t: number; point: Point; distance: number } {
  if (segmentIsLinear(a, b)) {
    const ax = a.anchor[0];
    const ay = a.anchor[1];
    const bx = b.anchor[0];
    const by = b.anchor[1];
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 0) {
      t = ((p[0] - ax) * dx + (p[1] - ay) * dy) / lenSq;
    }
    t = Math.max(0, Math.min(1, t));
    const point: Point = [ax + dx * t, ay + dy * t];
    const distance = Math.hypot(p[0] - point[0], p[1] - point[1]);
    return { t, point, distance };
  }

  const [p0, p1, p2, p3] = segmentControlPoints(a, b);
  let bestT = 0;
  let bestPoint: Point = [p0[0], p0[1]];
  let bestDist = Infinity;
  // Coarse sweep, then local refinement.
  const STEPS = 48;
  for (let k = 0; k <= STEPS; k += 1) {
    const t = k / STEPS;
    const pt = evalCubic(p0, p1, p2, p3, t);
    const d = Math.hypot(p[0] - pt[0], p[1] - pt[1]);
    if (d < bestDist) {
      bestDist = d;
      bestT = t;
      bestPoint = pt;
    }
  }
  for (let iter = 0; iter < 12; iter += 1) {
    const delta = 1 / (STEPS * Math.pow(2, iter + 1));
    const t1 = Math.max(0, bestT - delta);
    const t2 = Math.min(1, bestT + delta);
    const pt1 = evalCubic(p0, p1, p2, p3, t1);
    const pt2 = evalCubic(p0, p1, p2, p3, t2);
    const d1 = Math.hypot(p[0] - pt1[0], p[1] - pt1[1]);
    const d2 = Math.hypot(p[0] - pt2[0], p[1] - pt2[1]);
    if (d1 < bestDist) {
      bestDist = d1;
      bestT = t1;
      bestPoint = pt1;
    }
    if (d2 < bestDist) {
      bestDist = d2;
      bestT = t2;
      bestPoint = pt2;
    }
  }
  return { t: bestT, point: bestPoint, distance: bestDist };
}

export function projectPointToSpline(
  path: SplinePath,
  p: Point,
): ProjectHit | null {
  const n = path.nodes.length;
  if (n === 0) return null;
  let best: ProjectHit | null = null;
  for (let i = 0; i < n; i += 1) {
    const a = path.nodes[i];
    const b = path.nodes[(i + 1) % n];
    const hit = projectPointToSegment(p, a, b);
    if (!best || hit.distance < best.distanceMm) {
      best = {
        segmentIndex: i,
        t: hit.t,
        point: hit.point,
        distanceMm: hit.distance,
      };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Mutation helpers (pure)
// ---------------------------------------------------------------------------

function translatePt(p: Point, dx: number, dy: number): Point {
  return [p[0] + dx, p[1] + dy];
}

export function moveNode(
  path: SplinePath,
  id: string,
  dx: number,
  dy: number,
): SplinePath {
  return {
    ...path,
    nodes: path.nodes.map((n) =>
      n.id === id
        ? {
            ...n,
            anchor: translatePt(n.anchor, dx, dy),
            handleIn: n.handleIn ? translatePt(n.handleIn, dx, dy) : null,
            handleOut: n.handleOut ? translatePt(n.handleOut, dx, dy) : null,
          }
        : n,
    ),
  };
}

function mirrorHandleAcrossAnchor(anchor: Point, handle: Point): Point {
  return [2 * anchor[0] - handle[0], 2 * anchor[1] - handle[1]];
}

function reflectHandlePreservingLength(
  anchor: Point,
  sourceHandle: Point,
  targetHandle: Point,
): Point {
  // Place target handle opposite sourceHandle direction but keep targetHandle's
  // current length. Used for 'smooth' nodes so both handles stay collinear
  // but each keeps its own length.
  const sx = sourceHandle[0] - anchor[0];
  const sy = sourceHandle[1] - anchor[1];
  const sLen = Math.hypot(sx, sy);
  if (sLen === 0) return targetHandle;
  const tx = targetHandle[0] - anchor[0];
  const ty = targetHandle[1] - anchor[1];
  const tLen = Math.hypot(tx, ty);
  const ux = -sx / sLen;
  const uy = -sy / sLen;
  return [anchor[0] + ux * tLen, anchor[1] + uy * tLen];
}

export function moveHandle(
  path: SplinePath,
  id: string,
  which: 'in' | 'out',
  xMm: number,
  yMm: number,
): SplinePath {
  return {
    ...path,
    nodes: path.nodes.map((n) => {
      if (n.id !== id) return n;
      const updated: SplineNode = { ...n };
      const target: Point = [xMm, yMm];
      if (which === 'in') updated.handleIn = target;
      else updated.handleOut = target;

      if (updated.kind === 'symmetric') {
        const other = mirrorHandleAcrossAnchor(updated.anchor, target);
        if (which === 'in') updated.handleOut = other;
        else updated.handleIn = other;
      } else if (updated.kind === 'smooth') {
        const opposite = which === 'in' ? updated.handleOut : updated.handleIn;
        if (opposite) {
          const reflected = reflectHandlePreservingLength(
            updated.anchor,
            target,
            opposite,
          );
          if (which === 'in') updated.handleOut = reflected;
          else updated.handleIn = reflected;
        }
      }
      return updated;
    }),
  };
}

export function setNodeKind(
  path: SplinePath,
  id: string,
  kind: NodeKind,
): SplinePath {
  return {
    ...path,
    nodes: path.nodes.map((n) => {
      if (n.id !== id) return n;
      const next: SplineNode = { ...n, kind };
      if (kind === 'corner') {
        // Keep handles — users can drag them away for sharp corners,
        // and this preserves data if they toggle back.
      } else if (kind === 'smooth' || kind === 'symmetric') {
        // Synthesize default handles if missing so the user can drag them.
        if (!next.handleIn && !next.handleOut) {
          const idx = path.nodes.findIndex((x) => x.id === id);
          const prev = path.nodes[(idx - 1 + path.nodes.length) % path.nodes.length];
          const nxt = path.nodes[(idx + 1) % path.nodes.length];
          const tx = (nxt.anchor[0] - prev.anchor[0]) / 6;
          const ty = (nxt.anchor[1] - prev.anchor[1]) / 6;
          next.handleIn = [next.anchor[0] - tx, next.anchor[1] - ty];
          next.handleOut = [next.anchor[0] + tx, next.anchor[1] + ty];
        } else if (!next.handleIn && next.handleOut) {
          next.handleIn = mirrorHandleAcrossAnchor(next.anchor, next.handleOut);
        } else if (next.handleIn && !next.handleOut) {
          next.handleOut = mirrorHandleAcrossAnchor(next.anchor, next.handleIn);
        }
        if (kind === 'symmetric' && next.handleIn && next.handleOut) {
          next.handleOut = mirrorHandleAcrossAnchor(next.anchor, next.handleIn);
        }
      }
      return next;
    }),
  };
}

/**
 * Drag a bezier segment so that the on-curve point at parameter `t` moves by
 * (dx, dy). Distributes the delta across the two adjacent handles using a
 * least-squares weighting so that w1·d1 + w2·d2 = delta exactly.
 *
 * For linear segments (no handles), default tangent handles are synthesised
 * first (1/6 of chord length, collinear with chord). During the drag both
 * nodes are treated as 'corner' so opposing handles don't mirror.
 */
export function moveSegment(
  path: SplinePath,
  segmentIndex: number,
  t: number,
  dx: number,
  dy: number,
): SplinePath {
  const n = path.nodes.length;
  const aIdx = ((segmentIndex % n) + n) % n;
  const bIdx = (aIdx + 1) % n;

  const a = { ...path.nodes[aIdx] };
  const b = { ...path.nodes[bIdx] };

  // Synthesise default handles for linear segments.
  if (a.handleOut === null && b.handleIn === null) {
    const chordX = b.anchor[0] - a.anchor[0];
    const chordY = b.anchor[1] - a.anchor[1];
    a.handleOut = [a.anchor[0] + chordX / 3, a.anchor[1] + chordY / 3];
    b.handleIn = [b.anchor[0] - chordX / 3, b.anchor[1] - chordY / 3];
  } else if (a.handleOut === null) {
    a.handleOut = [...a.anchor];
  } else if (b.handleIn === null) {
    b.handleIn = [...b.anchor];
  }

  // Basis weights for handleOut (P1) and handleIn (P2) at parameter t.
  const mt = 1 - t;
  const w1 = 3 * mt * mt * t;
  const w2 = 3 * mt * t * t;
  const denom = w1 * w1 + w2 * w2;
  if (denom < 1e-12) return path;

  const d1x = dx * w1 / denom;
  const d1y = dy * w1 / denom;
  const d2x = dx * w2 / denom;
  const d2y = dy * w2 / denom;

  const nextA: SplineNode = {
    ...a,
    kind: 'corner',
    handleOut: [a.handleOut![0] + d1x, a.handleOut![1] + d1y],
  };
  const nextB: SplineNode = {
    ...b,
    kind: 'corner',
    handleIn: [b.handleIn![0] + d2x, b.handleIn![1] + d2y],
  };

  const nextNodes = path.nodes.slice();
  nextNodes[aIdx] = nextA;
  nextNodes[bIdx] = nextB;
  return { ...path, nodes: nextNodes };
}

export function removeNodes(path: SplinePath, ids: Set<string>): SplinePath {
  const next = path.nodes.filter((n) => !ids.has(n.id));
  return { ...path, nodes: next };
}

// ---------------------------------------------------------------------------
// Bounding box
// ---------------------------------------------------------------------------

export function splineBoundingBoxMm(
  path: SplinePath,
  toleranceMm = 0.1,
): [number, number, number, number] {
  const pts = flattenSpline(path, toleranceMm);
  if (pts.length === 0) return [0, 0, 0, 0];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

export function polygonSignedAreaMm2(polygon: Point[]): number {
  const n = polygon.length;
  if (n < 3) return 0;
  let a = 0;
  for (let i = 0; i < n; i += 1) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function polygonPerimeterMm(polygon: Point[]): number {
  const n = polygon.length;
  if (n < 2) return 0;
  let p = 0;
  for (let i = 0; i < n; i += 1) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % n];
    p += Math.hypot(x2 - x1, y2 - y1);
  }
  return p;
}
