import { act, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import type { LabelAnchor } from '../lib/twinScene';
import { useConsole } from '../store';
import { resetStore } from '../test-utils';
import { ZoneLabels } from './ZoneLabels';

const anchors: LabelAnchor[] = [
  { zoneId: 'BLD-DC', name: 'Data Center', kind: 'building', position: [0, 0, 0] },
  { zoneId: 'BLD-LAB', name: 'Laboratory', kind: 'building', position: [50, 0, 0] },
  { zoneId: 'UTL-PLANT', name: 'Utility Plant', kind: 'utility', position: [-50, 0, 0] },
];

const renderLabels = () => render(<ZoneLabels anchors={anchors} layerRef={createRef()} />);

/** Whether each label is faded, by its text: `data-faded` is the attribute the CSS reads. */
const faded = () =>
  Object.fromEntries(
    anchors.map(({ name }) => [name, screen.getByText(name).getAttribute('data-faded')]),
  );

describe('ZoneLabels fade (V2-15.8)', () => {
  beforeEach(() => resetStore(useConsole));

  it('shows every name as it is at campus level', () => {
    renderLabels();

    expect(faded()).toEqual({
      'Data Center': 'false',
      Laboratory: 'false',
      'Utility Plant': 'false',
    });
  });

  it('fades every name but the focused building’s at building level', () => {
    renderLabels();

    act(() => useConsole.getState().focusBuilding('BLD-DC'));

    expect(faded()).toEqual({
      'Data Center': 'false',
      Laboratory: 'true',
      'Utility Plant': 'true',
    });
  });

  it('keeps the fade while an asset of the building is isolated', () => {
    renderLabels();

    act(() => useConsole.getState().selectAsset('CT-01', 'BLD-DC'));

    expect(faded()).toEqual({
      'Data Center': 'false',
      Laboratory: 'true',
      'Utility Plant': 'true',
    });
  });

  it('fades nothing for an asset outside every building: no building is in focus', () => {
    renderLabels();

    act(() => useConsole.getState().selectAsset('TR-01', null));

    expect(faded()).toEqual({
      'Data Center': 'false',
      Laboratory: 'false',
      'Utility Plant': 'false',
    });
  });

  it('moves the fade with the focus, and gives every name back when the building is left', () => {
    renderLabels();
    act(() => useConsole.getState().focusBuilding('BLD-DC'));

    act(() => useConsole.getState().focusBuilding('BLD-LAB'));
    expect(faded()).toEqual({
      'Data Center': 'true',
      Laboratory: 'false',
      'Utility Plant': 'true',
    });

    act(() => useConsole.getState().goCampus());
    expect(faded()).toEqual({
      'Data Center': 'false',
      Laboratory: 'false',
      'Utility Plant': 'false',
    });
  });

  it('is decoration for the eye: hidden from assistive technology', () => {
    const { container } = renderLabels();

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});
