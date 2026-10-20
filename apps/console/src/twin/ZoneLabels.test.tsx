import { act, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import type { HeatScene } from '../lib/twinHeat';
import type { LabelAnchor } from '../lib/twinScene';
import { useConsole } from '../store';
import { resetStore } from '../test-utils';
import { ZoneLabels } from './ZoneLabels';

const anchors: LabelAnchor[] = [
  { zoneId: 'BLD-DC', name: 'Data Center', kind: 'building', position: [0, 0, 0] },
  { zoneId: 'BLD-LAB', name: 'Laboratory', kind: 'building', position: [50, 0, 0] },
  { zoneId: 'UTL-PLANT', name: 'Utility Plant', kind: 'utility', position: [-50, 0, 0] },
];

const renderLabels = (heat: HeatScene | null = null) =>
  render(<ZoneLabels anchors={anchors} layerRef={createRef()} heat={heat} />);

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

describe('ZoneLabels heat line (V2-17.3)', () => {
  beforeEach(() => resetStore(useConsole));

  /** The overlay of the two buildings: `BLD-LAB` has no reading. The utility plant is not a building, so it has none. */
  const overlay = (): HeatScene => ({
    colours: new Map([['BLD-DC', '#3d4f99']]),
    silent: new Set(['BLD-LAB']),
    labels: new Map([
      ['BLD-DC', '22.0 °C'],
      ['BLD-LAB', 'No data'],
    ]),
    silentNames: ['Laboratory'],
    alarmed: new Set(),
    key: 'k',
  });

  /** The label's element, found by its name: the line is a child of it. */
  const label = (name: string) => screen.getByText(name);

  it('puts a building`s temperature under its name', () => {
    renderLabels(overlay());

    expect(screen.getByText('22.0 °C')).toBeInTheDocument();
    expect(label('Data Center')).toContainElement(screen.getByText('22.0 °C'));
  });

  it('says "No data" under a building whose sensor is silent', () => {
    renderLabels(overlay());

    expect(label('Laboratory')).toContainElement(screen.getByText('No data'));
  });

  it('gives a zone that is not a building no line', () => {
    renderLabels(overlay());

    expect(label('Utility Plant').children).toHaveLength(0);
    expect(screen.getAllByText(/°C|No data/)).toHaveLength(2);
  });

  it('draws no line without the overlay: the labels are as they were', () => {
    renderLabels(null);

    expect(screen.queryByText(/°C|No data/)).toBeNull();
    for (const { name } of anchors) expect(label(name).children).toHaveLength(0);
  });

  it('keeps the name as the label`s own text, so the projector`s label is the name', () => {
    renderLabels(overlay());

    expect(label('Data Center')).toHaveTextContent('Data Center22.0 °C');
    expect(screen.getAllByText(/./, { selector: 'div > span' })).toHaveLength(3);
  });

  it('fades the line with its label when another building is in focus', () => {
    renderLabels(overlay());

    act(() => useConsole.getState().focusBuilding('BLD-DC'));

    expect(label('Laboratory')).toHaveAttribute('data-faded', 'true');
    expect(label('Laboratory')).toContainElement(screen.getByText('No data'));
    expect(label('Data Center')).toHaveAttribute('data-faded', 'false');
  });

  it('shows and takes away the line as the overlay comes and goes', () => {
    const { rerender } = renderLabels(null);
    expect(screen.queryByText('22.0 °C')).toBeNull();

    rerender(<ZoneLabels anchors={anchors} layerRef={createRef()} heat={overlay()} />);
    expect(screen.getByText('22.0 °C')).toBeInTheDocument();

    rerender(<ZoneLabels anchors={anchors} layerRef={createRef()} heat={null} />);
    expect(screen.queryByText('22.0 °C')).toBeNull();
  });

  it('is decoration for the eye: the line is inside the hidden layer', () => {
    const { container } = renderLabels(overlay());

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(container.firstElementChild).toContainElement(screen.getByText('22.0 °C'));
  });
});
