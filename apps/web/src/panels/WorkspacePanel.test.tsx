import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkspacePanel } from './WorkspacePanel';
import { TooltipProvider } from '../components/ui';
import { usePipelineStore } from '../store/pipelineStore';
import { WORKSPACE_PREFS_STORAGE_KEY, useWorkspacePrefsStore } from '../store/workspacePrefsStore';

function renderWorkspacePanel() {
  return render(
    <TooltipProvider>
      <WorkspacePanel />
    </TooltipProvider>,
  );
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
