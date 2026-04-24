import { fireEvent, render } from '@testing-library/react';

import { EditOverlay } from './EditOverlay';
import { useEditStore } from '../store/editStore';

describe('EditOverlay shift gesture', () => {
  it('does not clear the current selection when shift-drag starts on the overlay', () => {
    useEditStore.getState().enterEdit([
      [0, 0],
      [50, 0],
      [50, 30],
      [0, 30],
    ]);

    const spline = useEditStore.getState().spline;
    expect(spline).not.toBeNull();

    const selectedId = spline!.nodes[0]!.id;
    useEditStore.getState().setSelection([selectedId]);

    const { container } = render(
      <EditOverlay
        widthPx={200}
        heightPx={100}
        originMm={[0, 0]}
        pxPerMm={2}
      />,
    );

    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeInTheDocument();

    fireEvent.pointerDown(svg, {
      button: 0,
      shiftKey: true,
      clientX: 200,
      clientY: 160,
      pointerId: 1,
    });
    fireEvent.pointerMove(svg, {
      shiftKey: true,
      clientX: 170,
      clientY: 120,
      pointerId: 1,
    });
    fireEvent.pointerUp(svg, { shiftKey: true, pointerId: 1 });

    expect(useEditStore.getState().selectedIds).toEqual([selectedId]);
  });
});
