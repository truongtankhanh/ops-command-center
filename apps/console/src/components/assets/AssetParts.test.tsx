import type { TelemetryPoint } from '@occ/contracts';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { PartRow } from '../../lib/twin-core/modelParts';
import { focusSelection } from '../../lib/twin-core/twinFocus';
import { useConsole } from '../../store';
import { expectNoAxeViolations, resetStore } from '../../test-utils';
import { AssetParts } from './AssetParts';

vi.mock('../../lib/twin-core/twinFocus', () => ({ focusSelection: vi.fn() }));

const point = (key: string, label: string, unit: string): TelemetryPoint => ({
  key,
  label,
  unit,
  kind: 'number',
  min: 0,
  max: 3000,
  enumValues: null,
  expectedIntervalS: 5,
  headline: null,
});

const POINTS = [point('fanSpeedRpm', 'Fan speed', 'rpm'), point('basinTempC', 'Basin', '°C')];

/** A static enclosure, a static stack with a bound blade under it, and a bound basin. */
const PARTS: PartRow[] = [
  { name: 'Enclosure', label: 'Enclosure', bind: null, parent: null },
  { name: 'FanStack', label: 'Fan stack', bind: null, parent: null },
  { name: 'FanBlade', label: 'Fan blade', bind: 'fanSpeedRpm', parent: 'FanStack' },
  { name: 'Basin', label: 'Basin', bind: 'basinTempC', parent: null },
];

function renderParts() {
  return render(
    <AssetParts assetCode="CT-01" parts={PARTS} points={POINTS} entry={undefined} stale={false} />,
  );
}

const row = (label: string) => screen.getByRole('treeitem', { name: new RegExp(label) });

describe('AssetParts', () => {
  beforeEach(() => {
    resetStore(useConsole);
    vi.mocked(focusSelection).mockClear();
    useConsole.getState().selectAsset('CT-01', null);
    useConsole.setState({ view: '3d' });
  });

  describe('which rows can be selected', () => {
    it('marks a bound row selectable and says whether it is selected; a static row says nothing', () => {
      renderParts();

      expect(row('Fan blade')).toHaveAttribute('aria-selected', 'false');
      expect(row('Basin')).toHaveAttribute('aria-selected', 'false');
      expect(row('Enclosure')).not.toHaveAttribute('aria-selected');
      expect(row('Fan stack')).not.toHaveAttribute('aria-selected');
    });

    it('is read only in the 2D view: no selection to show, nothing happens on a click', () => {
      useConsole.setState({ view: '2d' });
      renderParts();

      expect(row('Fan blade')).not.toHaveAttribute('aria-selected');
      fireEvent.click(row('Fan blade'));
      fireEvent.keyDown(row('Fan blade'), { key: 'Enter' });

      expect(useConsole.getState().selectedPart).toBeNull();
      expect(focusSelection).not.toHaveBeenCalled();
    });

    it('is still not a control with a button in it: rows are tree items', () => {
      renderParts();

      expect(within(screen.getByRole('tree')).queryByRole('button')).toBeNull();
    });
  });

  describe('selecting', () => {
    it('selects the part with a click and flies to it', () => {
      renderParts();

      fireEvent.click(row('Fan blade'));

      expect(useConsole.getState().selectedPart).toBe('FanBlade');
      expect(useConsole.getState().selectedAssetCode).toBe('CT-01');
      expect(focusSelection).toHaveBeenCalledExactlyOnceWith('CT-01', 'FanBlade');
      expect(row('Fan blade')).toHaveAttribute('aria-selected', 'true');
      expect(row('Basin')).toHaveAttribute('aria-selected', 'false');
    });

    it('selects with Enter and with Space, and Space does not scroll the sheet', () => {
      renderParts();

      expect(fireEvent.keyDown(row('Basin'), { key: 'Enter' })).toBe(false);
      expect(useConsole.getState().selectedPart).toBe('Basin');

      // `fireEvent` returns `false` when the handler called `preventDefault`.
      expect(fireEvent.keyDown(row('Fan blade'), { key: ' ' })).toBe(false);
      expect(useConsole.getState().selectedPart).toBe('FanBlade');
      expect(focusSelection).toHaveBeenCalledTimes(2);
    });

    it('does nothing for a static row, by click or by key', () => {
      renderParts();

      fireEvent.click(row('Enclosure'));
      fireEvent.keyDown(row('Fan stack'), { key: 'Enter' });
      fireEvent.keyDown(row('Fan stack'), { key: ' ' });

      expect(useConsole.getState().selectedPart).toBeNull();
      expect(focusSelection).not.toHaveBeenCalled();
    });

    it('deselects on a second activation, as a second click on the part does, and does not fly', () => {
      renderParts();
      fireEvent.click(row('Fan blade'));
      vi.mocked(focusSelection).mockClear();

      fireEvent.click(row('Fan blade'));

      expect(useConsole.getState().selectedPart).toBeNull();
      expect(useConsole.getState().selectedAssetCode).toBe('CT-01');
      expect(row('Fan blade')).toHaveAttribute('aria-selected', 'false');
      expect(focusSelection).not.toHaveBeenCalled();
    });

    it('moves the selection to another row', () => {
      renderParts();
      fireEvent.click(row('Fan blade'));

      fireEvent.click(row('Basin'));

      expect(useConsole.getState().selectedPart).toBe('Basin');
      expect(row('Fan blade')).toHaveAttribute('aria-selected', 'false');
      expect(row('Basin')).toHaveAttribute('aria-selected', 'true');
    });

    it('marks the row of a part selected elsewhere (the scene), and unmarks it', () => {
      renderParts();

      act(() => useConsole.getState().selectPart('FanBlade'));
      expect(row('Fan blade')).toHaveAttribute('aria-selected', 'true');

      act(() => useConsole.getState().selectPart(null));
      expect(row('Fan blade')).toHaveAttribute('aria-selected', 'false');
      expect(focusSelection).not.toHaveBeenCalled();
    });
  });

  describe('keys', () => {
    it('keeps one tab stop and moves it with the arrow keys, Home and End', () => {
      renderParts();
      const items = within(screen.getByRole('tree')).getAllByRole('treeitem');
      const last = items.length - 1;
      expect(items.map((item) => item.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);

      fireEvent.keyDown(items[0] as HTMLElement, { key: 'ArrowDown' });
      expect(items[1]).toHaveFocus();
      expect(items[1]).toHaveAttribute('tabindex', '0');

      fireEvent.keyDown(items[1] as HTMLElement, { key: 'End' });
      expect(items[last]).toHaveFocus();
      fireEvent.keyDown(items[last] as HTMLElement, { key: 'ArrowDown' });
      expect(items[last]).toHaveFocus();

      fireEvent.keyDown(items[last] as HTMLElement, { key: 'Home' });
      expect(items[0]).toHaveFocus();
      expect(useConsole.getState().selectedPart).toBeNull();
    });

    it('leaves the other keys to the browser', () => {
      renderParts();

      expect(fireEvent.keyDown(row('Basin'), { key: 'Tab' })).toBe(true);
      expect(useConsole.getState().selectedPart).toBeNull();
    });
  });

  describe('hover', () => {
    it('writes the asset and the part, as the pointer does, and takes both back on leave', () => {
      renderParts();

      fireEvent.mouseEnter(row('Fan blade'));
      expect(useConsole.getState()).toMatchObject({
        hoveredAssetCode: 'CT-01',
        hoveredPart: 'FanBlade',
      });
      expect(row('Fan blade')).toHaveAttribute('data-hovered', 'true');
      expect(row('Basin')).not.toHaveAttribute('data-hovered');

      fireEvent.mouseLeave(row('Fan blade'));
      expect(useConsole.getState()).toMatchObject({ hoveredAssetCode: null, hoveredPart: null });
      expect(row('Fan blade')).not.toHaveAttribute('data-hovered');
    });

    it('does not hover a static row', () => {
      renderParts();

      fireEvent.mouseEnter(row('Enclosure'));

      expect(useConsole.getState()).toMatchObject({ hoveredAssetCode: null, hoveredPart: null });
    });

    it('marks the row of a part hovered in the scene, and only for this asset', () => {
      renderParts();

      act(() => {
        useConsole.getState().hoverAsset('CT-01');
        useConsole.getState().hoverPart('Basin');
      });
      expect(row('Basin')).toHaveAttribute('data-hovered', 'true');

      act(() => useConsole.getState().hoverAsset('CT-02'));
      expect(row('Basin')).not.toHaveAttribute('data-hovered');
    });

    it('takes back its hover when the list goes away under the pointer', () => {
      const { unmount } = renderParts();
      fireEvent.mouseEnter(row('Fan blade'));

      unmount();

      expect(useConsole.getState()).toMatchObject({ hoveredAssetCode: null, hoveredPart: null });
    });

    it('leaves a hover that someone else wrote in the meantime alone', () => {
      const { unmount } = renderParts();
      fireEvent.mouseEnter(row('Fan blade'));
      act(() => {
        useConsole.getState().hoverAsset('CT-02');
        useConsole.getState().hoverPart('Basin');
      });

      unmount();

      expect(useConsole.getState()).toMatchObject({
        hoveredAssetCode: 'CT-02',
        hoveredPart: 'Basin',
      });
    });
  });

  it('has no accessibility violations with a row selected', async () => {
    renderParts();
    fireEvent.click(row('Fan blade'));

    await expectNoAxeViolations();
  });
});
