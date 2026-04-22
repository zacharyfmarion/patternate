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
  RotateCw,
  Minus,
  Plus,
  Maximize2,
} from 'lucide-react';
import {
  TransformWrapper,
  TransformComponent,
  useControls,
  useTransformComponent,
} from 'react-zoom-pan-pinch';
import { Modal } from '../components/Modal';

import { usePipelineStore } from '../store/pipelineStore';
import { useSettingsStore } from '../store/settingsStore';
import { useEditStore } from '../store/editStore';
import { useWorkspacePrefsStore, type WelcomeMode } from '../store/workspacePrefsStore';
import { Button, IconButton } from '../components/ui';
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

const VISIBLE_SAMPLES = FEATURED_SAMPLE
  ? [
      FEATURED_SAMPLE,
      ...SAMPLES.filter((sample) => sample.name !== FEATURED_SAMPLE.name).slice(0, 3),
    ]
  : SAMPLES.slice(0, 4);

const PHOTO_TIPS = [
  'Print the paper at 100% scale and keep it flat on a table or floor.',
  'Keep the whole paper visible with a little margin around the edges.',
  'Place the printed paper beside the pattern piece, on the same flat surface.',
  'Use even, bright light so the markers stay crisp and easy to detect.',
  'Hold the camera steady and avoid blur, glare, hard shadows, or folds in the paper.',
  'Frame both the printed paper and the pattern piece in the same photo.',
] as const;

type WelcomeStep = 'reference' | 'photo' | 'upload';

// ---------------------------------------------------------------------------
// Overlay renderers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Orientation helpers
// ---------------------------------------------------------------------------

async function getImageDimensions(bytes: Uint8Array): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const { width, height } = bitmap;
  bitmap.close();
  return { width, height };
}

const MAX_DIMENSION_PX = 3000;

async function rotateCW90(bytes: Uint8Array): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const { width: w, height: h } = bitmap;
  const canvas = new OffscreenCanvas(h, w);
  const ctx = canvas.getContext('2d')!;
  ctx.translate(h, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
  return new Uint8Array(await blob.arrayBuffer());
}

async function resizeIfNeeded(bytes: Uint8Array): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const { width: w, height: h } = bitmap;
  if (Math.max(w, h) <= MAX_DIMENSION_PX) {
    bitmap.close();
    return bytes;
  }
  const scale = MAX_DIMENSION_PX / Math.max(w, h);
  const nw = Math.round(w * scale);
  const nh = Math.round(h * scale);
  const canvas = new OffscreenCanvas(nw, nh);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, nw, nh);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
  return new Uint8Array(await blob.arrayBuffer());
}

interface OrientationPending {
  name: string;
  bytes: Uint8Array;
  previewUrl: string;
  autoRun: boolean;
}

function OrientationCheckDialog({
  pending,
  onRotate,
  onUseAsIs,
  onCancel,
}: {
  pending: OrientationPending;
  onRotate: () => void;
  onUseAsIs: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open
      onOpenChange={(open) => { if (!open) onCancel(); }}
      title="Portrait photo detected"
      description="Board detection works best with landscape photos. Rotate 90° clockwise to convert this photo to landscape before processing."
      footer={
        <div className="pd-row">
          <Button type="button" variant="primary" className="gap-1.5" onClick={onRotate}>
            <RotateCw size={14} /> Rotate and continue
          </Button>
          <Button type="button" variant="secondary" onClick={onUseAsIs}>
            Use as-is
          </Button>
        </div>
      }
    >
      <img
        src={pending.previewUrl}
        alt="Preview of uploaded photo"
        style={{ maxHeight: 300, maxWidth: '100%', objectFit: 'contain', borderRadius: 6 }}
      />
    </Modal>
  );
}

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

function formatSampleName(name: string) {
  return name.replace(/_/g, ' ');
}

function ReferenceDownloads({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`pd-board-downloads${compact ? ' pd-board-downloads-compact' : ''}`}>
      <a className="pd-board-card" href={refboardLetterPdfUrl} download>
        <img src={refboardLetterPreviewUrl} alt="Printable reference paper, US Letter" />
        <strong>US Letter PDF</strong>
      </a>
      <a className="pd-board-card" href={refboardA4PdfUrl} download>
        <img src={refboardA4PreviewUrl} alt="Printable reference paper, A4" />
        <strong>A4 PDF</strong>
      </a>
    </div>
  );
}

function WelcomeSamples({
  title,
  samples,
  onSample,
}: {
  title: string;
  samples: Sample[];
  onSample: (sample: Sample) => void;
}) {
  return (
    <section className="pd-welcome-section">
      <div className="pd-welcome-section-header">
        <div>
          <h3 className="pd-welcome-section-title">{title}</h3>
          <p className="pd-welcome-section-copy">Load an example image to see how it works</p>
        </div>
      </div>
      <div className="pd-sample-grid pd-sample-grid-compact" role="list" aria-label={title}>
        {samples.map((sample) => (
          <button
            key={sample.url}
            className="pd-sample-card pd-sample-card-compact"
            onClick={() => onSample(sample)}
            title={formatSampleName(sample.name)}
            role="listitem"
            type="button"
          >
            <img src={sample.thumbUrl} alt={formatSampleName(sample.name)} loading="lazy" />
            <span>{formatSampleName(sample.name)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function UploadDropzone({
  dragging,
  fileInputRef,
  onFeaturedSample,
}: {
  dragging: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFeaturedSample: (() => void) | null;
}) {
  return (
    <div
      className="pd-dropzone pd-dropzone-lg pd-dropzone-hero"
      data-drag={dragging}
      onClick={() => fileInputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          fileInputRef.current?.click();
        }
      }}
    >
      <FileImage size={32} />
      <strong>Drop a photo here or click to upload</strong>
      <div className="pd-dropzone-hint">
        JPEG, PNG, or WebP. Processing starts immediately after upload.
      </div>
      <div className="pd-row">
        <Button
          type="button"
          variant="primary"
          className="gap-1.5"
          onClick={(e) => {
            e.stopPropagation();
            fileInputRef.current?.click();
          }}
        >
          <Upload size={14} /> Upload photo
        </Button>
        {onFeaturedSample ? (
          <Button
            type="button"
            variant="secondary"
            onClick={(e) => {
              e.stopPropagation();
              onFeaturedSample();
            }}
          >
            Try example
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function GuidedWelcome({
  dragging,
  fileInputRef,
  onSample,
  onSkipGuided,
}: {
  dragging: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onSample: (sample: Sample) => void;
  onSkipGuided: () => void;
}) {
  const [currentStep, setCurrentStep] = useState<WelcomeStep>('reference');

  const stepOrder: WelcomeStep[] = ['reference', 'photo', 'upload'];
  const currentIndex = stepOrder.indexOf(currentStep);

  function renderStepAction(step: WelcomeStep, index: number) {
    if (currentStep === step || index > currentIndex) return null;
    return (
      <Button type="button" variant="ghost" onClick={() => setCurrentStep(step)}>
        Review step
      </Button>
    );
  }

  return (
    <section className="pd-welcome-flow">
      <div className="pd-welcome-header">
        <div>
          <div className="pd-welcome-eyebrow">Guided Setup</div>
          <h2 className="pd-welcome-title">Go one step at a time, or drop a photo anytime.</h2>
          <p className="pd-welcome-copy">
            The quickest successful run is: print the reference paper, frame it beside the
            pattern piece, then upload the photo.
          </p>
        </div>
        <Button type="button" variant="ghost" onClick={onSkipGuided}>
          Skip guided setup
        </Button>
      </div>

      <section
        className="pd-welcome-step"
        data-step-state={currentStep === 'reference' ? 'current' : currentIndex > 0 ? 'complete' : 'upcoming'}
      >
        <div className="pd-welcome-step-top">
          <div className="pd-step-badge">Step 1</div>
          {renderStepAction('reference', 0)}
        </div>
        <div className="pd-step-header">
          <div className="pd-step-icon">
            <Download size={18} />
          </div>
          <div>
            <h3>Get the reference paper</h3>
          </div>
        </div>
        {currentStep === 'reference' ? (
          <div className="pd-welcome-step-body">
            <ReferenceDownloads />
            <div className="pd-row">
              <Button type="button" variant="primary" onClick={() => setCurrentStep('photo')}>
                I have it printed out
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <section
        className="pd-welcome-step"
        data-step-state={currentStep === 'photo' ? 'current' : currentIndex > 1 ? 'complete' : 'upcoming'}
      >
        <div className="pd-welcome-step-top">
          <div className="pd-step-badge">Step 2</div>
          {renderStepAction('photo', 1)}
        </div>
        <div className="pd-step-header">
          <div className="pd-step-icon">
            <Camera size={18} />
          </div>
          <div>
            <h3>Take the photo</h3>
          </div>
        </div>
        {currentStep === 'photo' ? (
          <div className="pd-welcome-step-body">
            <div className="pd-tip-list" role="list" aria-label="Photo tips">
              {PHOTO_TIPS.map((tip) => (
                <div key={tip} className="pd-tip-item" role="listitem">
                  <CheckCircle2 size={16} />
                  <span>{tip}</span>
                </div>
              ))}
            </div>
            <div className="pd-row">
              <Button type="button" variant="primary" onClick={() => setCurrentStep('upload')}>
                I&apos;m ready to upload
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="pd-welcome-step" data-step-state={currentStep === 'upload' ? 'current' : 'upcoming'}>
        <div className="pd-welcome-step-top">
          <div className="pd-step-badge">Step 3</div>
          {renderStepAction('upload', 2)}
        </div>
        <div className="pd-step-header">
          <div className="pd-step-icon">
            <Upload size={18} />
          </div>
          <div>
            <h3>Upload the photo</h3>
          </div>
        </div>
        {currentStep === 'upload' ? (
          <div className="pd-welcome-step-body">
            <UploadDropzone
              dragging={dragging}
              fileInputRef={fileInputRef}
              onFeaturedSample={FEATURED_SAMPLE ? () => onSample(FEATURED_SAMPLE) : null}
            />
            <WelcomeSamples title="Synthetic examples" samples={VISIBLE_SAMPLES} onSample={onSample} />
          </div>
        ) : null}
      </section>
    </section>
  );
}

function StreamlinedWelcome({
  dragging,
  fileInputRef,
  onSample,
  onShowGuide,
}: {
  dragging: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onSample: (sample: Sample) => void;
  onShowGuide: () => void;
}) {
  const [showDownloads, setShowDownloads] = useState(false);

  return (
    <section className="pd-welcome-flow pd-welcome-flow-streamlined">
      <div className="pd-welcome-header">
        <div>
          <div className="pd-welcome-eyebrow">Quick Start</div>
          <p className="pd-welcome-copy">
            You can always reopen the guide if you want the step-by-step version again.
          </p>
        </div>
        <div className="pd-row">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setShowDownloads((value) => !value)}
          >
            {showDownloads ? 'Hide reference paper' : 'Need the reference paper?'}
          </Button>
          <Button type="button" variant="ghost" onClick={onShowGuide}>
            Show setup guide
          </Button>
        </div>
      </div>

      {showDownloads ? (
        <section className="pd-welcome-section">
          <div className="pd-welcome-section-header">
            <div>
              <h3 className="pd-welcome-section-title">Reference paper downloads</h3>
              <p className="pd-welcome-section-copy">
                Print at 100% scale and keep the full page visible in the photo.
              </p>
            </div>
          </div>
          <ReferenceDownloads compact />
        </section>
      ) : null}

      <UploadDropzone
        dragging={dragging}
        fileInputRef={fileInputRef}
        onFeaturedSample={FEATURED_SAMPLE ? () => onSample(FEATURED_SAMPLE) : null}
      />

      <WelcomeSamples title="Synthetic examples" samples={VISIBLE_SAMPLES} onSample={onSample} />
    </section>
  );
}

function WelcomeEmptyState({
  welcomeMode,
  dragging,
  fileInputRef,
  onFileDrop,
  onSample,
  onShowGuide,
  onSkipGuided,
  setDragging,
}: {
  welcomeMode: WelcomeMode;
  dragging: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileDrop: (file: File) => void;
  onSample: (sample: Sample) => void;
  onShowGuide: () => void;
  onSkipGuided: () => void;
  setDragging: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void onFileDrop(file);
    }
  }

  function onDragLeave(e: React.DragEvent<HTMLDivElement>) {
    const nextTarget = e.relatedTarget;
    if (!(nextTarget instanceof Node) || !e.currentTarget.contains(nextTarget)) {
      setDragging(false);
    }
  }

  return (
    <div
      className="pd-panel"
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragging) setDragging(true);
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {welcomeMode === 'guided' ? (
        <GuidedWelcome
          dragging={dragging}
          fileInputRef={fileInputRef}
          onSample={onSample}
          onSkipGuided={onSkipGuided}
        />
      ) : (
        <StreamlinedWelcome
          dragging={dragging}
          fileInputRef={fileInputRef}
          onSample={onSample}
          onShowGuide={onShowGuide}
        />
      )}
    </div>
  );
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
  const welcomeMode = useWorkspacePrefsStore((s) => s.welcomeMode);
  const showGuidedWelcome = useWorkspacePrefsStore((s) => s.showGuidedWelcome);
  const showStreamlinedWelcome = useWorkspacePrefsStore((s) => s.showStreamlinedWelcome);

  const editMode = useEditStore((s) => s.editMode);
  const enterEdit = useEditStore((s) => s.enterEdit);

  useEditKeyboardShortcuts();

  const [dragging, setDragging] = useState(false);
  const [orientationPending, setOrientationPending] = useState<OrientationPending | null>(null);
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

  async function loadInput(
    name: string,
    bytes: Uint8Array,
    {
      autoRun = false,
      loadedMessage = `Loaded ${name}`,
    }: { autoRun?: boolean; loadedMessage?: string } = {},
  ) {
    setInput(name, bytes);
    pushToast('info', loadedMessage);
    if (autoRun) {
      await run();
    }
  }

  async function handleFile(file: File, { autoRun = false }: { autoRun?: boolean } = {}) {
    try {
      const arrayBuf = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      const { width, height } = await getImageDimensions(bytes);
      if (height > width) {
        const previewUrl = URL.createObjectURL(new Blob([bytes], { type: file.type }));
        setOrientationPending({ name: file.name, bytes, previewUrl, autoRun });
        return;
      }
      const resized = await resizeIfNeeded(bytes);
      await loadInput(file.name, resized, { autoRun });
    } catch (err) {
      pushToast('error', `Failed to load ${file.name}: ${String(err)}`);
    }
  }

  async function handleSample(sample: Sample, { autoRun = false }: { autoRun?: boolean } = {}) {
    try {
      const res = await fetch(sample.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arrayBuf = await res.arrayBuffer();
      await loadInput(`${sample.name}.png`, new Uint8Array(arrayBuf), {
        autoRun,
        loadedMessage: `Loaded sample: ${sample.name}`,
      });
    } catch (err) {
      pushToast('error', `Failed to load sample: ${String(err)}`);
    }
  }

  async function commitOrientation(bytes: Uint8Array, name: string, autoRun: boolean) {
    if (orientationPending) {
      URL.revokeObjectURL(orientationPending.previewUrl);
      setOrientationPending(null);
    }
    const resized = await resizeIfNeeded(bytes);
    await loadInput(name, resized, { autoRun });
  }

  // ---------- STATE: no file loaded ----------
  if (!fileName) {
    return (
      <>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f, { autoRun: true });
            e.currentTarget.value = '';
          }}
        />

        {orientationPending ? (
          <OrientationCheckDialog
            pending={orientationPending}
            onRotate={() => {
              const { name, bytes, autoRun } = orientationPending;
              void rotateCW90(bytes).then((rotated) => commitOrientation(rotated, name, autoRun));
            }}
            onUseAsIs={() => {
              const { name, bytes, autoRun } = orientationPending;
              void commitOrientation(bytes, name, autoRun);
            }}
            onCancel={() => {
              URL.revokeObjectURL(orientationPending.previewUrl);
              setOrientationPending(null);
            }}
          />
        ) : null}

        <WelcomeEmptyState
          welcomeMode={welcomeMode}
          dragging={dragging}
          fileInputRef={fileInputRef}
          onFileDrop={(file) => handleFile(file, { autoRun: true })}
          onSample={(sample) => void handleSample(sample, { autoRun: true })}
          onShowGuide={showGuidedWelcome}
          onSkipGuided={showStreamlinedWelcome}
          setDragging={setDragging}
        />
      </>
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
          if (f) void handleFile(f);
          e.currentTarget.value = '';
        }}
      />

      {orientationPending ? (
        <OrientationCheckDialog
          pending={orientationPending}
          onRotate={() => {
            const { name, bytes, autoRun } = orientationPending;
            void rotateCW90(bytes).then((rotated) => commitOrientation(rotated, name, autoRun));
          }}
          onUseAsIs={() => {
            const { name, bytes, autoRun } = orientationPending;
            void commitOrientation(bytes, name, autoRun);
          }}
          onCancel={() => {
            URL.revokeObjectURL(orientationPending.previewUrl);
            setOrientationPending(null);
          }}
        />
      ) : null}

      <section className="pd-workspace-header">
        <div className="pd-workspace-header-copy">
          <div className="pd-workspace-title-row">
            <h2 className="pd-workspace-title" title={fileName}>
              {fileStem}
            </h2>
            <span className={`pd-status-pill pd-status-pill-${workspaceState.tone}`}>
              {workspaceState.label}
            </span>
          </div>
          <p className="pd-workspace-summary">{workspaceState.summary}</p>
        </div>

        <div className="pd-workspace-header-actions">
          <IconButton
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            title="Replace image"
            aria-label="Replace image"
          >
            <Upload size={14} />
          </IconButton>
          {runStatus === 'success' && result?.outline && !editMode ? (
            <Button
              type="button"
              variant="secondary"
              className="gap-1.5"
              onClick={() => result.outline && enterEdit(result.outline.polygonMm)}
              title="Edit the outline as spline curves"
            >
              <Pencil size={14} /> Edit curve
            </Button>
          ) : null}
          <Button
            type="button"
            variant="primary"
            className="gap-2 px-4 font-semibold"
            disabled={runStatus === 'running'}
            onClick={() => run()}
          >
            <span aria-hidden="true">
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
          </Button>
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
  const transformKey = rectifiedUrl ?? preparedUrl ?? previewUrl ?? '';

  return (
    <div className="pd-viewport">
      <TransformWrapper
        key={transformKey}
        minScale={0.25}
        maxScale={8}
        centerOnInit
        wheel={{ wheelDisabled: true }}
        trackPadPanning={{ disabled: false }}
        panning={{ excluded: ['pd-edit-overlay'] }}
      >
        <TransformComponent
          wrapperStyle={{ width: '100%', height: '100%' }}
          contentStyle={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
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
        </TransformComponent>
        <ZoomControls />
      </TransformWrapper>
    </div>
  );
}

function ZoomControls() {
  const { zoomIn, zoomOut, resetTransform } = useControls();
  const scale = useTransformComponent(({ state }) => state.scale);

  return (
    <div className="pd-zoom-controls">
      <IconButton size="sm" onClick={() => zoomOut()} title="Zoom out" aria-label="Zoom out">
        <Minus size={12} />
      </IconButton>
      <span className="pd-zoom-label">{Math.round(scale * 100)}%</span>
      <IconButton size="sm" onClick={() => zoomIn()} title="Zoom in" aria-label="Zoom in">
        <Plus size={12} />
      </IconButton>
      <div className="pd-zoom-sep" />
      <IconButton size="sm" onClick={() => resetTransform()} title="Fit to view" aria-label="Fit to view">
        <Maximize2 size={12} />
      </IconButton>
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
