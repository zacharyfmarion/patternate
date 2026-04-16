/**
 * Frontend export helpers, used when the user has edited the outline in the
 * spline editor. When no edits exist, the Inspector falls back to the
 * Rust-generated `result.outline.svg | dxf | json | maskPng` strings.
 *
 * The DXF emitted here mirrors the R12 `LWPOLYLINE` format produced by
 * `rectify-core/src/vector_export.rs` exactly, so downstream CAD tools see
 * the same file regardless of whether edits were made.
 */

import {
  flattenSpline,
  polygonSignedAreaMm2,
  polygonPerimeterMm,
  splineBoundingBoxMm,
  splineToSvgPathMm,
  type Point,
  type SplinePath,
} from '../edit/splinePath';

function fmt(n: number, d = 4): string {
  if (!Number.isFinite(n)) return '0';
  return n.toFixed(d);
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

/**
 * Matches the shape of `rectify-core::render_svg`:
 * - mm units, viewBox from bbox, single `<path d="...">` in a styled `<g>`.
 * - Difference: emits cubic `C` segments where the spline defines them.
 */
export function exportSvg(
  spline: SplinePath,
  bboxMm: [number, number, number, number],
): string {
  const [minX, minY, maxX, maxY] = bboxMm;
  const width = Math.max(0.001, maxX - minX);
  const height = Math.max(0.001, maxY - minY);

  const d = splineToSvgPathMm(spline, [minX, minY], 4);

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" ` +
    `width="${fmt(width)}mm" height="${fmt(height)}mm" ` +
    `viewBox="0 0 ${fmt(width)} ${fmt(height)}">\n` +
    `<g fill="none" stroke="#000000" stroke-width="0.2" ` +
    `stroke-linejoin="round" stroke-linecap="round">\n` +
    `<path d="${d}"/>\n` +
    `</g>\n` +
    `</svg>\n`
  );
}

// ---------------------------------------------------------------------------
// DXF (R12 LWPOLYLINE, Y-flipped to match Rust output)
// ---------------------------------------------------------------------------

export function exportDxf(
  spline: SplinePath,
  bboxMm: [number, number, number, number],
  toleranceMm: number,
): string {
  const flat = flattenSpline(spline, toleranceMm);
  const [, , , maxY] = bboxMm;
  const n = flat.length;

  let body = '';
  body += '0\nSECTION\n2\nHEADER\n';
  body += '9\n$ACADVER\n1\nAC1009\n';
  body += '9\n$INSUNITS\n70\n4\n';
  body += '9\n$MEASUREMENT\n70\n1\n';
  body += '0\nENDSEC\n';

  body += '0\nSECTION\n2\nTABLES\n';
  body += '0\nTABLE\n2\nLAYER\n70\n1\n';
  body += '0\nLAYER\n2\nPATTERN\n70\n0\n62\n7\n6\nCONTINUOUS\n';
  body += '0\nENDTAB\n0\nENDSEC\n';

  body += '0\nSECTION\n2\nENTITIES\n';
  body += '0\nLWPOLYLINE\n';
  body += '8\nPATTERN\n';
  body += '100\nAcDbEntity\n';
  body += '100\nAcDbPolyline\n';
  body += `90\n${n}\n`;
  body += '70\n1\n';
  for (const [x, y] of flat) {
    body += `10\n${fmt(x, 6)}\n20\n${fmt(maxY - y, 6)}\n`;
  }
  body += '0\nENDSEC\n';
  body += '0\nEOF\n';
  return body;
}

// ---------------------------------------------------------------------------
// JSON (polygon + spline nodes + metadata)
// ---------------------------------------------------------------------------

export interface ExportedOutlineJson {
  schema_version: 1;
  source: 'edited-spline';
  polygon_mm: Point[];
  nodes: Array<{
    anchor: Point;
    handleIn: Point | null;
    handleOut: Point | null;
    kind: string;
  }>;
  bounding_box_mm: [number, number, number, number];
  area_mm2: number;
  perimeter_mm: number;
  flatten_tolerance_mm: number;
}

export function exportJson(
  spline: SplinePath,
  bboxMm: [number, number, number, number],
  toleranceMm: number,
): ExportedOutlineJson {
  const polygon = flattenSpline(spline, toleranceMm);
  return {
    schema_version: 1,
    source: 'edited-spline',
    polygon_mm: polygon,
    nodes: spline.nodes.map((n) => ({
      anchor: n.anchor,
      handleIn: n.handleIn,
      handleOut: n.handleOut,
      kind: n.kind,
    })),
    bounding_box_mm: bboxMm,
    area_mm2: Math.abs(polygonSignedAreaMm2(polygon)),
    perimeter_mm: polygonPerimeterMm(polygon),
    flatten_tolerance_mm: toleranceMm,
  };
}

// ---------------------------------------------------------------------------
// Mask PNG — rasterize the flattened polygon to an offscreen canvas.
// ---------------------------------------------------------------------------

export async function exportMaskPng(
  spline: SplinePath,
  bboxMm: [number, number, number, number],
  pxPerMm: number,
  toleranceMm: number,
): Promise<Uint8Array> {
  const [minX, minY, maxX, maxY] = bboxMm;
  const widthMm = Math.max(0.001, maxX - minX);
  const heightMm = Math.max(0.001, maxY - minY);
  const w = Math.max(1, Math.round(widthMm * pxPerMm));
  const h = Math.max(1, Math.round(heightMm * pxPerMm));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas not available');

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);

  const flat = flattenSpline(spline, toleranceMm);
  if (flat.length >= 3) {
    ctx.beginPath();
    for (let i = 0; i < flat.length; i += 1) {
      const [xMm, yMm] = flat[i];
      const x = (xMm - minX) * pxPerMm;
      const y = (yMm - minY) * pxPerMm;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill('evenodd');
  }

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('canvas toBlob failed'));
    }, 'image/png');
  });
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

// ---------------------------------------------------------------------------
// Convenience: compute bbox once for all exporters.
// ---------------------------------------------------------------------------

export function computeExportBbox(
  spline: SplinePath,
  toleranceMm: number,
): [number, number, number, number] {
  return splineBoundingBoxMm(spline, toleranceMm);
}
