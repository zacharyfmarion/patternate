import { fireEvent, render, screen } from '@testing-library/react';
import { SettingsModal } from './SettingsModal';
import { useSettingsStore } from '../store/settingsStore';
import { TooltipProvider } from './ui';

describe('SettingsModal', () => {
  it('exposes an accessible close button and closes the dialog', () => {
    useSettingsStore.setState({ settingsOpen: true });

    render(
      <TooltipProvider>
        <SettingsModal />
      </TooltipProvider>,
    );

    expect(screen.getByRole('button', { name: 'Reset pipeline to defaults' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));

    expect(useSettingsStore.getState().settingsOpen).toBe(false);
  });
});
