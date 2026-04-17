import { fireEvent, render, screen } from '@testing-library/react';
import { EditToolbar } from './EditToolbar';
import { TooltipProvider } from '../components/ui';
import { useEditStore } from '../store/editStore';

describe('EditToolbar', () => {
  it('switches tools and reflects undo/redo availability', () => {
    useEditStore.getState().enterEdit([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);

    const spline = useEditStore.getState().spline;
    if (!spline) {
      throw new Error('expected edit spline to exist');
    }

    useEditStore.setState({
      history: {
        past: [spline],
        future: [spline],
      },
    });

    render(
      <TooltipProvider>
        <EditToolbar />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Pen' }));
    expect(useEditStore.getState().activeTool).toBe('pen');

    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled();
  });
});
