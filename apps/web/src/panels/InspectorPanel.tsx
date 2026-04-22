import { useEffect, useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';

import { usePipelineStore } from '../store/pipelineStore';
import { useSettingsStore } from '../store/settingsStore';
import { useEditStore } from '../store/editStore';
import { RunProgress } from '../components/RunProgress';
import type { RectifyResult } from '../engine/types';
import {
  computeExportBbox,
  exportDxf,
  exportJson,
  exportMaskPng,
  exportSvg,
} from '../export/exporters';
import {
  flattenSpline,
  polygonPerimeterMm,
  polygonSignedAreaMm2,
  type NodeKind,
  type SplinePath,
} from '../edit/splinePath';
import { Button } from '../components/ui';

function formatNumber(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toFixed(digits);
}

function baseName(fileName: string | null): string {
  if (!fileName) return 'pattern';
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadUrl(filename: string, url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pd-inspector-section">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function InspectorPanel() {
  const runStatus = usePipelineStore((s) => s.runStatus);
  const runError = usePipelineStore((s) => s.runError);
  const runProgress = usePipelineStore((s) => s.runProgress);
  const result = usePipelineStore((s) => s.result);
  const fileName = usePipelineStore((s) => s.fileName);
  const previewUrl = usePipelineStore((s) => s.previewUrl);
  const editMode = useEditStore((s) => s.editMode);

  if (!previewUrl) {
    return (
      <div className="pd-inspector">
        <p>Load an image to begin.</p>
      </div>
    );
  }

  if (editMode) {
    return (
      <div className="pd-inspector">
        <InspectorEditMode fileName={fileName} result={result} />
      </div>
    );
  }

  if (runStatus === 'idle') {
    return (
      <div className="pd-inspector">
        <Section title="Ready">
          <p className="pd-inspector-hint">
            Click <strong>Run</strong> to detect the board and extract the
            outline.
          </p>
        </Section>
        <SimplifyControl />
      </div>
    );
  }

  if (runStatus === 'running') {
    return (
      <div className="pd-inspector">
        <Section title="Running">
          <RunProgress items={runProgress} />
        </Section>
      </div>
    );
  }

  if (runStatus === 'error') {
    return (
      <div className="pd-inspector">
        <Section title="Failed">
          <p style={{ color: 'var(--danger)' }}>{runError ?? 'Unknown error'}</p>
        </Section>
        {result ? <DetectionSummary result={result} /> : null}
        {result ? <QualityStats result={result} /> : null}
      </div>
    );
  }

  return (
    <div className="pd-inspector">
      {result?.outline ? (
        <>
          <ExportButtons fileName={fileName} result={result} />
          <OutlineStats result={result} />
          <SimplifyControl />
          <QualityStats result={result} />
          <DetectionSummary result={result} />
        </>
      ) : (
        <Section title="No outline">
          <p>Rectification succeeded, but no outline could be extracted.</p>
        </Section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Standard (non-edit) exports — uses Rust-provided strings.
// ---------------------------------------------------------------------------

function ExportButtons({
  fileName,
  result,
}: {
  fileName: string | null;
  result: RectifyResult;
}) {
  const pushToast = usePipelineStore((s) => s.pushToast);
  const rectifiedUrl = usePipelineStore((s) => s.rectifiedUrl);
  const maskUrl = usePipelineStore((s) => s.maskUrl);
  const outline = result.outline;
  if (!outline) return null;
  const base = baseName(fileName);

  function done(name: string) {
    pushToast('success', `Exported ${name}`);
  }

  return (
    <Section title="Export">
      <div className="pd-export-grid">
        <Button
          type="button"
          variant="primary"
          size="sm"
          className="gap-1"
          onClick={() => {
            download(`${base}.svg`, new Blob([outline.svg], { type: 'image/svg+xml' }));
            done(`${base}.svg`);
          }}
        >
          <Download size={12} /> SVG
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="gap-1"
          onClick={() => {
            download(`${base}.dxf`, new Blob([outline.dxf], { type: 'application/dxf' }));
            done(`${base}.dxf`);
          }}
        >
          <Download size={12} /> DXF
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="gap-1"
          onClick={() => {
            const payload = {
              metadata: result.metadata,
              quality: result.quality,
              outline: outline.json,
              polygon_mm: outline.polygonMm,
            };
            download(
              `${base}.json`,
              new Blob([JSON.stringify(payload, null, 2)], {
                type: 'application/json',
              }),
            );
            done(`${base}.json`);
          }}
        >
          <Download size={12} /> JSON
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="gap-1"
          onClick={() => {
            if (rectifiedUrl) {
              downloadUrl(`${base}_rectified.png`, rectifiedUrl);
              done(`${base}_rectified.png`);
            }
          }}
        >
          <Download size={12} /> Rectified PNG
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="gap-1"
          onClick={() => {
            if (maskUrl) {
              downloadUrl(`${base}_mask.png`, maskUrl);
              done(`${base}_mask.png`);
            }
          }}
        >
          <Download size={12} /> Mask PNG
        </Button>
      </div>
    </Section>
  );
}

function OutlineStats({ result }: { result: RectifyResult }) {
  const o = result.outline;
  if (!o) return null;
  const [minX, minY, maxX, maxY] = o.metadata.bounding_box_mm;
  return (
    <Section title="Outline">
      <dl className="pd-kv">
        <dt>Area</dt>
        <dd>{formatNumber(o.metadata.area_mm2, 1)} mm²</dd>
        <dt>Perimeter</dt>
        <dd>{formatNumber(o.metadata.perimeter_mm, 1)} mm</dd>
        <dt>Vertices</dt>
        <dd>
          {o.metadata.vertex_count_simplified} / {o.metadata.vertex_count_raw}
        </dd>
        <dt>BBox</dt>
        <dd>
          {(maxX - minX).toFixed(1)} × {(maxY - minY).toFixed(1)} mm
        </dd>
      </dl>
    </Section>
  );
}

function SimplifyControl() {
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const runStatus = usePipelineStore((s) => s.runStatus);
  const rerunOutline = usePipelineStore((s) => s.rerunOutline);
  const result = usePipelineStore((s) => s.result);

  const [value, setValue] = useState(settings.simplifyMm);
  useEffect(() => setValue(settings.simplifyMm), [settings.simplifyMm]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onChange(next: number) {
    setValue(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateSettings({ simplifyMm: next });
      if (result && runStatus === 'success') {
        rerunOutline();
      }
    }, 250);
  }

  return (
    <Section title="Simplify">
      <div className="pd-row-between">
        <span>{value.toFixed(2)} mm</span>
        <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>
          Douglas–Peucker tolerance
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={3}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={runStatus === 'running'}
      />
    </Section>
  );
}

function QualityStats({ result }: { result: RectifyResult }) {
  const q = result.quality;
  const color =
    q.status === 'ok'
      ? 'var(--success)'
      : q.status === 'warning'
        ? 'var(--warning)'
        : 'var(--danger)';
  return (
    <Section title="Quality">
      <dl className="pd-kv">
        <dt>Status</dt>
        <dd style={{ color, textTransform: 'capitalize' }}>{q.status}</dd>
        <dt>Blur</dt>
        <dd>{formatNumber(q.metrics.blur_score, 2)}</dd>
        <dt>Exposure</dt>
        <dd>{formatNumber(q.metrics.exposure_score, 2)}</dd>
        <dt>Coverage</dt>
        <dd>{formatNumber(q.metrics.board_coverage, 3)}</dd>
        <dt>Confidence</dt>
        <dd>{formatNumber(q.metrics.board_confidence, 3)}</dd>
        <dt>Reproj. RMSE</dt>
        <dd>{formatNumber(q.metrics.board_reprojection_rmse_px, 3)} px</dd>
      </dl>
      {q.warnings.length ? (
        <ul className="pd-warnings">
          {q.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}

function DetectionSummary({ result }: { result: RectifyResult }) {
  const s = result.detection.summary;
  return (
    <Section title="Detection">
      <dl className="pd-kv">
        <dt>Board</dt>
        <dd>{s.board_id}</dd>
        <dt>Markers</dt>
        <dd>{s.marker_count}</dd>
        <dt>Corners</dt>
        <dd>{s.charuco_corner_count}</dd>
        <dt>Scale</dt>
        <dd>{formatNumber(result.pixelsPerMm, 2)} px/mm</dd>
      </dl>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Edit-mode inspector
// ---------------------------------------------------------------------------

function InspectorEditMode({
  fileName,
  result,
}: {
  fileName: string | null;
  result: RectifyResult | null;
}) {
  const spline = useEditStore((s) => s.spline);
  const selectedIds = useEditStore((s) => s.selectedIds);
  const flattenTol = useEditStore((s) => s.flattenToleranceMm);
  const setFlattenTol = useEditStore((s) => s.setFlattenTolerance);
  const setNodeKind = useEditStore((s) => s.setNodeKind);
  const autoSmooth = useEditStore((s) => s.autoSmooth);
  const resetFromPolygon = useEditStore((s) => s.resetFromPolygon);
  const exitEdit = useEditStore((s) => s.exitEdit);

  const polygon = result?.outline?.polygonMm ?? null;

  const [tension, setTension] = useState(0.5);

  const selectedNode = useMemo(() => {
    if (!spline || selectedIds.length === 0) return null;
    const id = selectedIds[selectedIds.length - 1];
    return spline.nodes.find((n) => n.id === id) ?? null;
  }, [spline, selectedIds]);

  const pushToast = usePipelineStore((s) => s.pushToast);
  const base = baseName(fileName);

  const bbox = useMemo(
    () => (spline ? computeExportBbox(spline, flattenTol) : null),
    [spline, flattenTol],
  );

  function exportAs(kind: 'svg' | 'dxf' | 'json' | 'mask') {
    if (!spline || !bbox) return;
    try {
      if (kind === 'svg') {
        const content = exportSvg(spline, bbox);
        download(
          `${base}.svg`,
          new Blob([content], { type: 'image/svg+xml' }),
        );
        pushToast('success', `Exported ${base}.svg`);
      } else if (kind === 'dxf') {
        const content = exportDxf(spline, bbox, flattenTol);
        download(
          `${base}.dxf`,
          new Blob([content], { type: 'application/dxf' }),
        );
        pushToast('success', `Exported ${base}.dxf`);
      } else if (kind === 'json') {
        const payload = {
          metadata: result?.metadata ?? null,
          quality: result?.quality ?? null,
          outline: exportJson(spline, bbox, flattenTol),
        };
        download(
          `${base}.json`,
          new Blob([JSON.stringify(payload, null, 2)], {
            type: 'application/json',
          }),
        );
        pushToast('success', `Exported ${base}.json`);
      } else if (kind === 'mask') {
        const pxPerMm = result?.pixelsPerMm ?? 10;
        exportMaskPng(spline, bbox, pxPerMm, flattenTol)
          .then((bytes) => {
            download(
              `${base}_mask.png`,
              new Blob([bytes as BlobPart], { type: 'image/png' }),
            );
            pushToast('success', `Exported ${base}_mask.png`);
          })
          .catch((err) => {
            pushToast('error', `Mask export failed: ${String(err)}`);
          });
      }
    } catch (err) {
      pushToast('error', `Export failed: ${String(err)}`);
    }
  }

  const outlineStats = useMemo(() => {
    if (!spline || !bbox) return null;
    return splineStats(spline, bbox);
  }, [spline, bbox]);

  return (
    <>
      <Section title="Edit mode">
        <div className="pd-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
            Select tool (V) to move anchors and handles. Pen tool (P) to insert
            a node on a segment.
          </span>
        </div>
      </Section>

      {selectedNode ? (
        <Section title="Selected node">
          <dl className="pd-kv">
            <dt>X</dt>
            <dd>{selectedNode.anchor[0].toFixed(2)} mm</dd>
            <dt>Y</dt>
            <dd>{selectedNode.anchor[1].toFixed(2)} mm</dd>
            <dt>Handle in</dt>
            <dd>{describeHandle(selectedNode.anchor, selectedNode.handleIn)}</dd>
            <dt>Handle out</dt>
            <dd>{describeHandle(selectedNode.anchor, selectedNode.handleOut)}</dd>
          </dl>
          <div className="pd-row" style={{ gap: 6, marginTop: 4 }}>
            {(['corner', 'smooth', 'symmetric'] as NodeKind[]).map((k) => (
              <Button
                key={k}
                type="button"
                variant="secondary"
                size="sm"
                isActive={selectedNode.kind === k}
                onClick={() => setNodeKind(selectedNode.id, k)}
              >
                {k}
              </Button>
            ))}
          </div>
        </Section>
      ) : (
        <Section title="Selected node">
          <p className="pd-inspector-hint">No node selected.</p>
        </Section>
      )}

      <Section title="Auto-smooth">
        <div className="pd-row-between">
          <span>Tension</span>
          <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>
            {tension.toFixed(2)}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={tension}
          onChange={(e) => setTension(Number(e.target.value))}
        />
        <div className="pd-row" style={{ gap: 6 }}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!polygon}
            onClick={() => polygon && autoSmooth(polygon, tension)}
          >
            Apply
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!polygon}
            onClick={() => polygon && resetFromPolygon(polygon)}
          >
            Reset to polygon
          </Button>
        </div>
      </Section>

      <Section title="Flatten tolerance">
        <div className="pd-row-between">
          <span>{flattenTol.toFixed(3)} mm</span>
          <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>
            DXF / JSON / mask
          </span>
        </div>
        <input
          type="range"
          min={0.005}
          max={0.5}
          step={0.005}
          value={flattenTol}
          onChange={(e) => setFlattenTol(Number(e.target.value))}
        />
      </Section>

      {outlineStats ? (
        <Section title="Outline">
          <dl className="pd-kv">
            <dt>Nodes</dt>
            <dd>{spline?.nodes.length ?? 0}</dd>
            <dt>Area</dt>
            <dd>{outlineStats.area.toFixed(1)} mm²</dd>
            <dt>Perimeter</dt>
            <dd>{outlineStats.perimeter.toFixed(1)} mm</dd>
            <dt>BBox</dt>
            <dd>
              {outlineStats.w.toFixed(1)} × {outlineStats.h.toFixed(1)} mm
            </dd>
          </dl>
        </Section>
      ) : null}

      <Section title="Export">
        <div className="pd-export-grid">
          <Button type="button" variant="primary" size="sm" className="gap-1" onClick={() => exportAs('svg')}>
            <Download size={12} /> SVG
          </Button>
          <Button type="button" variant="secondary" size="sm" className="gap-1" onClick={() => exportAs('dxf')}>
            <Download size={12} /> DXF
          </Button>
          <Button type="button" variant="secondary" size="sm" className="gap-1" onClick={() => exportAs('json')}>
            <Download size={12} /> JSON
          </Button>
          <Button type="button" variant="secondary" size="sm" className="gap-1" onClick={() => exportAs('mask')}>
            <Download size={12} /> Mask PNG
          </Button>
        </div>
      </Section>

      <div className="pd-row" style={{ gap: 6 }}>
        <Button type="button" variant="secondary" onClick={exitEdit}>
          Done
        </Button>
      </div>
    </>
  );
}

function describeHandle(
  anchor: [number, number],
  handle: [number, number] | null,
): string {
  if (!handle) return 'none';
  const dx = handle[0] - anchor[0];
  const dy = handle[1] - anchor[1];
  const len = Math.hypot(dx, dy);
  return `Δ ${dx.toFixed(2)}, ${dy.toFixed(2)} mm (len ${len.toFixed(2)})`;
}

function splineStats(
  spline: SplinePath,
  bbox: [number, number, number, number],
): { area: number; perimeter: number; w: number; h: number } {
  const flat = flattenSpline(spline, 0.05);
  return {
    area: Math.abs(polygonSignedAreaMm2(flat)),
    perimeter: polygonPerimeterMm(flat),
    w: bbox[2] - bbox[0],
    h: bbox[3] - bbox[1],
  };
}
