import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  RotateCcw,
  Upload,
  AlertTriangle,
  Pencil,
  Download,
  Camera,
  FileImage,
  CheckCircle2,
} from 'lucide-react';

import { usePipelineStore } from '../store/pipelineStore';
import { useSettingsStore } from '../store/settingsStore';
import { useEditStore } from '../store/editStore';
import { EditOverlay, useEditKeyboardShortcuts } from './EditOverlay';
import { EditToolbar } from './EditToolbar';
import type { BoardDetectionDebug, RectifyResult } from '../engine/types';
import refboardA4PdfUrl from '../../../../assets/refboard_v1/refboard_v1_a4.pdf?url';
import refboardLetterPdfUrl from '../../../../assets/refboard_v1/refboard_v1_letter.pdf?url';
import refboardA4PreviewUrl from '../../../../assets/refboard_v1/refboard_v1_a4.png?url';
import refboardLetterPreviewUrl from '../../../../assets/refboard_v1/refboard_v1_letter.png?url';

// ---------------------------------------------------------------------------
// Sample gallery
// ---------------------------------------------------------------------------

const SAMPLE_PNG_MAP = import.meta.glob(
  '../../../../examples/photos/synthetic_pattern_set/*.png',
  { eager: true, query: '?url', import: 'default' },
) as Record<string, string>;

const SAMPLE_JPG_MAP = import.meta.glob(
  '../../../../examples/photos/synthetic_pattern_set/*.jpg',
  { eager: true, query: '?url', import: 'default' },
) as Record<string, string>;

interface Sample {
  name: string;
  url: string;
  thumbUrl: string;
}

const SAMPLES: Sample[] = Object.entries(SAMPLE_PNG_MAP)
  .map(([pngPath, pngUrl]) => {
    const name = (pngPath.split('/').pop() ?? pngPath).replace(/\.png$/, '');
    const jpgPath = pngPath.replace(/\.png$/, '.jpg');
    const thumbUrl = SAMPLE_JPG_MAP[jpgPath] ?? pngUrl;
    return { name, url: pngUrl, thumbUrl };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const FEATURED_SAMPLE =
  SAMPLES.find((sample) => sample.name === 'dark_on_light') ?? SAMPLES[0] ?? null;

const PHOTO_TIPS = [
  'Print the paper at 100% scale and keep it flat on a table or floor.',
  'Keep the whole paper visible with a little margin around the edges.',
  'Place the printed paper beside the pattern piece, on the same flat surface.',
  'Use even, bright light so the markers stay crisp and easy to detect.',
  'Hold the camera steady and avoid blur, glare, hard shadows, or folds in the paper.',
  'Frame both the printed paper and the pattern piece in the same photo.',
] as const;

// ---------------------------------------------------------------------------
// Overlay renderers
// ---------------------------------------------------------------------------

function drawDetectionOverlay(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  detection: BoardDetectionDebug,
) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (w === 0 || h === 0) return;
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${img.clientWidth}px`;
  canvas.style.height = `${img.clientHeight}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);

  const lineWidthBase = Math.max(2, Math.min(w, h) / 500);

  if (detection.summary.board_outline_image) {
    const pts = detection.summary.board_outline_image;
    ctx.strokeStyle = 'rgba(76, 154, 255, 0.9)';
    ctx.lineWidth = lineWidthBase * 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 1) {
      const [x, y] = pts[i];
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(47, 201, 138, 0.85)';
  ctx.fillStyle = 'rgba(47, 201, 138, 0.12)';
  ctx.lineWidth = lineWidthBase;
  for (const m of detection.markers) {
    ctx.beginPath();
    const c = m.corners_image;
    ctx.moveTo(c[0][0], c[0][1]);
    ctx.lineTo(c[1][0], c[1][1]);
    ctx.lineTo(c[2][0], c[2][1]);
    ctx.lineTo(c[3][0], c[3][1]);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(240, 180, 0, 0.95)';
  const r = Math.max(3, lineWidthBase * 1.5);
  for (const c of detection.charuco_corners) {
    const [x, y] = c.image_xy;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function WorkspacePanel() {
  const fileName = usePipelineStore((s) => s.fileName);
  const previewUrl = usePipelineStore((s) => s.previewUrl);
  const preparedUrl = usePipelineStore((s) => s.preparedUrl);
  const rectifiedUrl = usePipelineStore((s) => s.rectifiedUrl);
  const runStatus = usePipelineStore((s) => s.runStatus);
  const runError = usePipelineStore((s) => s.runError);
  const result = usePipelineStore((s) => s.result);
  const setInput = usePipelineStore((s) => s.setInput);
  const run = usePipelineStore((s) => s.run);
  const pushToast = usePipelineStore((s) => s.pushToast);
  const showOverlays = useSettingsStore((s) => s.settings.showOverlays);

  const editMode = useEditStore((s) => s.editMode);
  const enterEdit = useEditStore((s) => s.enterEdit);

  useEditKeyboardShortcuts();

  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const outlineMeta = result?.outline?.metadata ?? null;
  const fileStem = fileName?.replace(/\.[^.]+$/, '') ?? '';

  const workspaceState = useMemo(() => {
    if (editMode) {
      return {
        tone: 'editing',
        label: 'Editing',
        summary: 'Curve editor is active. Refine the outline directly on the image.',
      };
    }

    if (runStatus === 'running') {
      return {
        tone: 'running',
        label: 'Processing',
        summary: 'Rectifying the image and extracting an outline.',
      };
    }

    if (runStatus === 'error') {
      return {
        tone: 'error',
        label: 'Needs Attention',
        summary: runError ?? 'The pipeline could not extract a reliable outline.',
      };
    }

    if (runStatus === 'success' && outlineMeta) {
      return {
        tone: 'success',
        label: 'Outline Ready',
        summary: `${outlineMeta.area_mm2.toFixed(0)} mm² area · ${outlineMeta.vertex_count_simplified} vertices`,
      };
    }

    if (runStatus === 'success') {
      return {
        tone: 'ready',
        label: 'Rectified',
        summary: 'Rectification completed. No outline was extracted from this pass.',
      };
    }

    return {
      tone: 'ready',
      label: 'Ready',
      summary: 'Choose when to run the pipeline. Results will appear in the viewport below.',
    };
  }, [editMode, outlineMeta, runError, runStatus]);

  async function handleFile(file: File) {
    try {
      const arrayBuf = await file.arrayBuffer();
      setInput(file.name, new Uint8Array(arrayBuf));
      pushToast('info', `Loaded ${file.name}`);
    } catch (err) {
      pushToast('error', `Failed to load ${file.name}: ${String(err)}`);
    }
  }

  async function handleSample(sample: Sample) {
    try {
      const res = await fetch(sample.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arrayBuf = await res.arrayBuffer();
      setInput(`${sample.name}.png`, new Uint8Array(arrayBuf));
      pushToast('info', `Loaded sample: ${sample.name}`);
    } catch (err) {
      pushToast('error', `Failed to load sample: ${String(err)}`);
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  // ---------- STATE: no file loaded ----------
  if (!fileName) {
    return (
      <div className="pd-panel">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.currentTarget.value = '';
          }}
        />

        <section className="pd-onboarding">
          <div className="pd-onboarding-grid">
            <section className="pd-step-card">
              <div className="pd-step-badge">Step 1</div>
              <div className="pd-step-header">
                <div className="pd-step-icon">
                  <Download size={18} />
                </div>
                <div>
                  <h3>Print the reference paper</h3>
                  <p>Download the PDF that matches your paper size.</p>
                </div>
              </div>

              <div className="pd-board-downloads">
                <a className="pd-board-card" href={refboardLetterPdfUrl} download>
                  <img src={refboardLetterPreviewUrl} alt="Printable reference paper, US Letter" />
                  <strong>US Letter PDF</strong>
                  <span>Best for standard printers in the U.S.</span>
                </a>
                <a className="pd-board-card" href={refboardA4PdfUrl} download>
                  <img src={refboardA4PreviewUrl} alt="Printable reference paper, A4" />
                  <strong>A4 PDF</strong>
                  <span>Use this if your printer or region defaults to A4.</span>
                </a>
              </div>

              <div className="pd-tip-list" role="list" aria-label="Printing and photo tips">
                {PHOTO_TIPS.map((tip) => (
                  <div key={tip} className="pd-tip-item" role="listitem">
                    <CheckCircle2 size={16} />
                    <span>{tip}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="pd-step-card pd-step-card-upload">
              <div className="pd-step-badge">Step 2</div>
              <div className="pd-step-header">
                <div className="pd-step-icon">
                  <Camera size={18} />
                </div>
                <div>
                  <h3>Upload a photo</h3>
                  <p>Use your own image, or try the sample.</p>
                </div>
              </div>

              <div
                className="pd-dropzone pd-dropzone-lg"
                data-drag={dragging}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                <FileImage size={32} />
                <strong>Drop a photo here or click to upload</strong>
                <div className="pd-dropzone-hint">JPEG, PNG, or WebP.</div>
                <div className="pd-row">
                  <button
                    type="button"
                    className="pd-btn pd-btn-primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    <Upload size={14} /> Upload photo
                  </button>
                  {FEATURED_SAMPLE ? (
                    <button
                      type="button"
                      className="pd-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleSample(FEATURED_SAMPLE);
                      }}
                    >
                      Try example
                    </button>
                  ) : null}
                </div>
              </div>
            </section>
          </div>
        </section>

        <h3>Or try a synthetic example</h3>
        <div
          className="pd-sample-grid"
          role="list"
          aria-label="Synthetic samples"
        >
          {SAMPLES.map((s) => (
            <button
              key={s.url}
              className="pd-sample-card"
              onClick={() => handleSample(s)}
              title={s.name}
              role="listitem"
            >
              <img src={s.thumbUrl} alt={s.name} loading="lazy" />
              <span>{s.name}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---------- STATE: file loaded (running / success / error) ----------
  return (
    <div className="pd-panel">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.currentTarget.value = '';
        }}
      />

      <section className="pd-workspace-header">
        <div className="pd-workspace-header-copy">
          <div className="pd-workspace-eyebrow">Current image</div>
          <div className="pd-workspace-title-row">
            <h2 className="pd-workspace-title" title={fileName}>
              {fileStem}
            </h2>
            <span className={`pd-status-pill pd-status-pill-${workspaceState.tone}`}>
              {workspaceState.label}
            </span>
          </div>
          <p className="pd-workspace-summary">{workspaceState.summary}</p>
          <button
            className="pd-workspace-link"
            onClick={() => fileInputRef.current?.click()}
            title="Replace the current image"
          >
            <Upload size={14} /> Replace image
          </button>
        </div>

        <div className="pd-workspace-header-actions">
          {runStatus === 'success' && result?.outline && !editMode ? (
            <button
              className="pd-btn"
              onClick={() => result.outline && enterEdit(result.outline.polygonMm)}
              title="Edit the outline as spline curves"
            >
              <Pencil size={14} /> Edit curve
            </button>
          ) : null}
          <button
            className="pd-btn pd-btn-primary pd-btn-run"
            disabled={runStatus === 'running'}
            onClick={() => run()}
          >
            <span className="pd-btn-icon" aria-hidden="true">
              {runStatus === 'running' ? (
                <span className="pd-spinner pd-spinner-sm" />
              ) : runStatus === 'idle' ? (
                <Play size={14} />
              ) : (
                <RotateCcw size={14} />
              )}
            </span>
            <span>
              {runStatus === 'running'
                ? 'Running…'
                : runStatus === 'idle'
                  ? 'Run'
                : 'Re-run'}
            </span>
          </button>
        </div>
      </section>

      {runStatus === 'error' ? (
        <ValidationBanner
          message={runError ?? 'Run failed'}
          detection={result?.detection ?? null}
          qualityWarnings={result?.quality.warnings ?? []}
        />
      ) : null}

      {editMode ? <EditToolbar /> : null}

      <Viewport
        runStatus={runStatus}
        previewUrl={previewUrl}
        preparedUrl={preparedUrl}
        rectifiedUrl={rectifiedUrl}
        result={result}
        showOverlays={showOverlays}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Validation banner — shown when run fails
// ---------------------------------------------------------------------------

function ValidationBanner({
  message,
  detection,
  qualityWarnings,
}: {
  message: string;
  detection: BoardDetectionDebug | null;
  qualityWarnings: string[];
}) {
  const summary = detection?.summary;
  return (
    <div className="pd-validation">
      <div className="pd-validation-header">
        <AlertTriangle size={16} />
        <strong>Can't extract the outline</strong>
      </div>
      <div className="pd-validation-body">
        <div>{message}</div>
        {qualityWarnings.length > 1 ? (
          <ul>
            {qualityWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
        {summary ? (
          <dl className="pd-kv">
            <dt>Markers detected</dt>
            <dd>{summary.marker_count}</dd>
            <dt>ChArUco corners</dt>
            <dd>{summary.charuco_corner_count}</dd>
            <dt>Confidence</dt>
            <dd>{summary.confidence.toFixed(2)}</dd>
          </dl>
        ) : null}
        <div className="pd-validation-hints">
          Try a sharper, evenly-lit photo with the full paper visible beside
          the pattern piece on the same flat surface.
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Viewport — shows input preview, detection overlay, or rectified+outline
// ---------------------------------------------------------------------------

function Viewport({
  runStatus,
  previewUrl,
  preparedUrl,
  rectifiedUrl,
  result,
  showOverlays,
}: {
  runStatus: 'idle' | 'running' | 'success' | 'error';
  previewUrl: string | null;
  preparedUrl: string | null;
  rectifiedUrl: string | null;
  result: RectifyResult | null;
  showOverlays: boolean;
}) {
  const editMode = useEditStore((s) => s.editMode);
  const showRectified =
    runStatus === 'success' && rectifiedUrl !== null && result !== null;
  const baseUrl = preparedUrl ?? previewUrl;

  return (
    <div className="pd-viewport">
      {editMode && showRectified ? (
        <RectifiedWithEditOverlay url={rectifiedUrl!} result={result!} />
      ) : showRectified ? (
        <RectifiedWithOutline url={rectifiedUrl!} result={result!} />
      ) : baseUrl ? (
        <InputWithDetection
          key={baseUrl}
          url={baseUrl}
          detection={showOverlays && result?.detection ? result.detection : null}
        />
      ) : null}
    </div>
  );
}

function InputWithDetection({
  url,
  detection,
}: {
  url: string;
  detection: BoardDetectionDebug | null;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    if (!detection) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const draw = () => drawDetectionOverlay(canvas, img, detection);
    if (img.complete) draw();
    else img.addEventListener('load', draw, { once: true });
    const ro = new ResizeObserver(() => draw());
    ro.observe(img);
    return () => ro.disconnect();
  }, [detection, url]);

  return (
    <div className="pd-overlay-stack">
      <img ref={imgRef} src={url} alt="input" />
      <canvas ref={canvasRef} />
    </div>
  );
}

function RectifiedWithOutline({
  url,
  result,
}: {
  url: string;
  result: RectifyResult;
}) {
  const svg = useMemo(() => {
    const outline = result.outline;
    if (!outline) return null;
    const pxPerMm = result.pixelsPerMm;
    const width = result.metadata.rectified_image?.width_px ?? 0;
    const height = result.metadata.rectified_image?.height_px ?? 0;
    if (width === 0 || height === 0) return null;

    const bounds = result.metadata.rectified_bounds_mm ?? [0, 0, 0, 0];
    const minX = bounds[0];
    const minY = bounds[1];

    const d = outline.polygonMm
      .map(([x, y], i) => {
        const sx = (x - minX) * pxPerMm;
        const sy = (y - minY) * pxPerMm;
        return `${i === 0 ? 'M' : 'L'} ${sx.toFixed(2)} ${sy.toFixed(2)}`;
      })
      .join(' ');

    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMinYMin meet"
        style={{ width: '100%', height: '100%' }}
      >
        <path
          d={`${d} Z`}
          fill="rgba(240, 180, 0, 0.15)"
          stroke="rgba(240, 180, 0, 0.95)"
          strokeWidth={Math.max(1, Math.min(width, height) / 600)}
          strokeLinejoin="round"
        />
      </svg>
    );
  }, [result]);

  return (
    <div className="pd-overlay-stack">
      <img src={url} alt="rectified" />
      {svg}
    </div>
  );
}

function RectifiedWithEditOverlay({
  url,
  result,
}: {
  url: string;
  result: RectifyResult;
}) {
  const width = result.metadata.rectified_image?.width_px ?? 0;
  const height = result.metadata.rectified_image?.height_px ?? 0;
  const bounds = result.metadata.rectified_bounds_mm ?? [0, 0, 0, 0];
  const origin: [number, number] = [bounds[0], bounds[1]];

  return (
    <div className="pd-overlay-stack">
      <img src={url} alt="rectified" />
      {width > 0 && height > 0 ? (
        <EditOverlay
          widthPx={width}
          heightPx={height}
          originMm={origin}
          pxPerMm={result.pixelsPerMm}
        />
      ) : null}
    </div>
  );
}
