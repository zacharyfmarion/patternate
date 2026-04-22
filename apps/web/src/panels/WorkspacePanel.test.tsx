import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkspacePanel } from './WorkspacePanel';
import type { RectifyResult } from '../engine/types';
import { TooltipProvider } from '../components/ui';
import { useEditStore } from '../store/editStore';
import { usePipelineStore } from '../store/pipelineStore';
import { WORKSPACE_PREFS_STORAGE_KEY, useWorkspacePrefsStore } from '../store/workspacePrefsStore';

function renderWorkspacePanel() {
  return render(
    <TooltipProvider>
      <WorkspacePanel />
    </TooltipProvider>,
  );
}

function makeRectifyResult(): RectifyResult {
  return {
    detection: {
      summary: {
        board_id: 'refboard_v1',
        marker_count: 8,
        charuco_corner_count: 24,
        confidence: 0.99,
        board_outline_image: null,
        board_reprojection_rmse_px: 0.5,
      },
      homography_board_mm_to_image: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      markers: [],
      charuco_corners: [],
    },
    quality: {
      schema_version: 1,
      status: 'ok',
      warnings: [],
      metrics: {
        blur_score: 1,
        exposure_score: 1,
        board_coverage: 1,
        board_confidence: 1,
        board_reprojection_rmse_px: 0.5,
      },
    },
    metadata: {
      schema_version: 1,
      phase: 'finalize_results',
      input_image: { width_px: 2400, height_px: 1600 },
      prepared_image: { width_px: 1600, height_px: 1067 },
      reference_board: {
        board_id: 'refboard_v1',
        squares_x: 11,
        squares_y: 8,
        square_size_mm: 15,
        marker_size_mm: 11,
      },
      board_detection: {
        board_id: 'refboard_v1',
        marker_count: 8,
        charuco_corner_count: 24,
        confidence: 0.99,
        board_outline_image: null,
        board_reprojection_rmse_px: 0.5,
      },
      rectified_image: { width_px: 2400, height_px: 1200 },
      rectified_bounds_mm: [0, 0, 1200, 600],
      scale: {
        pixels_per_mm: 2,
        mm_per_pixel: 0.5,
      },
    },
    pixelsPerMm: 2,
    qualityFailed: false,
    preparedPng: new Uint8Array([1, 2, 3]),
    rectifiedPng: new Uint8Array([4, 5, 6]),
    options: {
      extract: true,
      simplify_mm: 1,
      min_piece_area_mm2: 10,
      board_margin_mm: null,
      smooth: true,
    },
    outline: {
      svg: '<svg />',
      dxf: '0',
      json: {},
      polygonMm: [
        [0, 0],
        [1200, 0],
        [1200, 600],
        [0, 600],
      ],
      metadata: {
        vertex_count_raw: 4,
        vertex_count_simplified: 4,
        simplify_tolerance_mm: 1,
        bounding_box_mm: [0, 0, 1200, 600],
        area_mm2: 720000,
        perimeter_mm: 3600,
        segmentation: {
          background_rgb: [255, 255, 255],
          otsu_threshold: 128,
          component_count: 1,
          piece_area_mm2: 720000,
          piece_pixel_count: 1000,
        },
      },
      maskPng: new Uint8Array([7, 8, 9]),
    },
  };
}

describe('WorkspacePanel welcome flow', () => {
  it('shows guided mode by default and advances one step at a time', async () => {
    renderWorkspacePanel();

    expect(screen.getByText('Guided Setup')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'I have it printed out' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ready to upload/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'I have it printed out' }));

    expect(screen.getByRole('button', { name: /ready to upload/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /ready to upload/i }));

    expect(screen.getByText('Upload the photo')).toBeInTheDocument();
    expect(
      screen.queryByText('Upload your image or use an example. Either path starts processing right away.'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Drop a photo here or click to upload')).toBeInTheDocument();
  });

  it('switches to streamlined mode and persists when skipping guided setup', () => {
    renderWorkspacePanel();

    fireEvent.click(screen.getByRole('button', { name: /skip guided setup/i }));

    expect(screen.getByText('Quick Start')).toBeInTheDocument();
    expect(useWorkspacePrefsStore.getState().welcomeMode).toBe('streamlined');
    expect(localStorage.getItem(WORKSPACE_PREFS_STORAGE_KEY)).toBe(
      JSON.stringify({ welcomeMode: 'streamlined' }),
    );
  });

  it('renders streamlined mode from saved preference and can reopen the guide', () => {
    localStorage.setItem(
      WORKSPACE_PREFS_STORAGE_KEY,
      JSON.stringify({ welcomeMode: 'streamlined' }),
    );
    useWorkspacePrefsStore.setState({ welcomeMode: 'streamlined' });

    renderWorkspacePanel();

    expect(screen.getByText('Quick Start')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /need the reference paper/i })).toBeInTheDocument();
    expect(screen.getByText('Synthetic examples')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /show setup guide/i }));

    expect(screen.getByText('Guided Setup')).toBeInTheDocument();
    expect(localStorage.getItem(WORKSPACE_PREFS_STORAGE_KEY)).toBe(
      JSON.stringify({ welcomeMode: 'guided' }),
    );
  });

  it('auto-runs after selecting a file from the empty state', async () => {
    const setInput = vi.fn();
    const run = vi.fn().mockResolvedValue(undefined);
    const pushToast = vi.fn();
    usePipelineStore.setState({ setInput, run, pushToast });

    const { container } = renderWorkspacePanel();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['pixels'], 'pattern.jpg', { type: 'image/jpeg' });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(setInput).toHaveBeenCalledWith('pattern.jpg', expect.any(Uint8Array));
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('accepts drag-and-drop in guided mode before step completion and auto-runs', async () => {
    const setInput = vi.fn();
    const run = vi.fn().mockResolvedValue(undefined);
    const pushToast = vi.fn();
    usePipelineStore.setState({ setInput, run, pushToast });

    const { container } = renderWorkspacePanel();
    const file = new File(['pixels'], 'dragged.png', { type: 'image/png' });
    const panel = container.querySelector('.pd-panel') as HTMLElement;

    fireEvent.dragOver(panel, { dataTransfer: { files: [file] } });
    fireEvent.drop(panel, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(setInput).toHaveBeenCalledWith('dragged.png', expect.any(Uint8Array));
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('loads and auto-runs a sample from the compact sample row', async () => {
    const setInput = vi.fn();
    const run = vi.fn().mockResolvedValue(undefined);
    const pushToast = vi.fn();
    const sampleBytes = new Uint8Array([1, 2, 3, 4]);
    usePipelineStore.setState({ setInput, run, pushToast });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: async () => sampleBytes.buffer,
    } as Response);

    renderWorkspacePanel();
    fireEvent.click(screen.getByRole('button', { name: 'I have it printed out' }));
    fireEvent.click(screen.getByRole('button', { name: /ready to upload/i }));
    fireEvent.click(screen.getByRole('listitem', { name: /dark on light/i }));

    await waitFor(() => {
      expect(setInput).toHaveBeenCalledWith('dark_on_light.png', expect.any(Uint8Array));
    });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('WorkspacePanel loaded workspace regression', () => {
  it('shows the existing loaded workspace instead of the welcome flow', () => {
    usePipelineStore.setState({
      fileName: 'pattern.jpg',
      fileBytes: new Uint8Array([1, 2, 3]),
      previewUrl: 'blob:preview-url',
      runStatus: 'idle',
    });

    renderWorkspacePanel();

    expect(screen.queryByText('Guided Setup')).not.toBeInTheDocument();
    expect(screen.queryByText('Quick Start')).not.toBeInTheDocument();
    expect(screen.getByText('pattern')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /replace image/i })).toBeInTheDocument();
  });
});

describe('WorkspacePanel rectified viewport regression', () => {
  it('renders rectified results inside a dedicated fit stage with centered overlays', () => {
    usePipelineStore.setState({
      fileName: 'pattern.jpg',
      fileBytes: new Uint8Array([1, 2, 3]),
      previewUrl: 'blob:preview-url',
      rectifiedUrl: 'blob:rectified-url',
      runStatus: 'success',
      result: makeRectifyResult(),
    });

    const { container } = renderWorkspacePanel();

    const stage = container.querySelector('.pd-rectified-stage');
    const rectifiedImage = screen.getByAltText('rectified');
    const overlay = stage?.querySelector('svg');

    expect(stage).toBeInTheDocument();
    expect(rectifiedImage).toHaveClass('pd-rectified-media');
    expect(overlay).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet');
  });

  it('keeps the full rectified stage interactive while editing curves', () => {
    usePipelineStore.setState({
      fileName: 'pattern.jpg',
      fileBytes: new Uint8Array([1, 2, 3]),
      previewUrl: 'blob:preview-url',
      rectifiedUrl: 'blob:rectified-url',
      runStatus: 'success',
      result: makeRectifyResult(),
    });
    useEditStore.getState().enterEdit(makeRectifyResult().outline!.polygonMm);

    const { container } = renderWorkspacePanel();

    const stage = container.querySelector('.pd-rectified-stage');
    const overlay = container.querySelector('svg.pd-edit-overlay') as SVGElement | null;

    expect(stage).toContainElement(overlay);
    expect(overlay).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet');
  });
});
