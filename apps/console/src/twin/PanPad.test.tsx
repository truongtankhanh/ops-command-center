import { act, fireEvent, screen, within } from '@testing-library/react';
import type { Mock } from 'vitest';
import { registerTwinCommands, type TwinCommands } from '../lib/twinCommands';
import { HOLD_START_MS, PAN_DIRECTIONS } from '../lib/twinPan';
import { useConsole } from '../store';
import { expectNoAxeViolations, renderWithQueryClient, resetStore } from '../test-utils';
import { PanPad } from './PanPad';

type FakeCommands = { [K in keyof TwinCommands]: Mock<TwinCommands[K]> };

function fakeCommands(): FakeCommands {
  return {
    flyTo: vi.fn<TwinCommands['flyTo']>(),
    home: vi.fn<TwinCommands['home']>(),
    fit: vi.fn<TwinCommands['fit']>(),
    fitAsset: vi.fn<TwinCommands['fitAsset']>(),
    flyToIncident: vi.fn<TwinCommands['flyToIncident']>(),
    showAsset: vi.fn<TwinCommands['showAsset']>(),
    zoomBy: vi.fn<TwinCommands['zoomBy']>(),
    rotateBy: vi.fn<TwinCommands['rotateBy']>(),
    tiltBy: vi.fn<TwinCommands['tiltBy']>(),
    panBy: vi.fn<TwinCommands['panBy']>(),
    faceNorth: vi.fn<TwinCommands['faceNorth']>(),
    panStep: vi.fn<TwinCommands['panStep']>(),
    panHold: vi.fn<TwinCommands['panHold']>(),
    centreOn: vi.fn<TwinCommands['centreOn']>(),
    current: vi.fn<TwinCommands['current']>(() => null),
  };
}

const button = (name: string) => screen.getByRole('button', { name });
const down = (name: string, init: PointerEventInit = {}) =>
  fireEvent.pointerDown(button(name), { button: 0, pointerId: 1, ...init });
const up = (name: string) => fireEvent.pointerUp(button(name), { pointerId: 1 });

describe('PanPad', () => {
  let rig: FakeCommands;
  let unregister: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    resetStore(useConsole);
    rig = fakeCommands();
    unregister = registerTwinCommands(rig);
    // The selected incident's detail and the catalogue are asked for; neither answers.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
  });

  afterEach(() => {
    unregister();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('is a labelled group of eight direction buttons and a centre button', () => {
    renderWithQueryClient(<PanPad />);

    const group = screen.getByRole('group', { name: 'Pan the view' });
    const names = within(group)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual([...PAN_DIRECTIONS.map((d) => d.name), 'Centre on the selection']);
  });

  it('steps once, at once, in the pressed direction', () => {
    renderWithQueryClient(<PanPad />);

    down('Pan up and right');

    expect(rig.panStep).toHaveBeenCalledExactlyOnceWith(Math.SQRT1_2, Math.SQRT1_2);
    expect(rig.panHold).toHaveBeenCalledTimes(1); // the release of any earlier hold, never a direction
    expect(rig.panHold).toHaveBeenLastCalledWith(null);
  });

  it('turns into a held move after the hold delay, and stops on release', () => {
    renderWithQueryClient(<PanPad />);

    down('Pan left');
    act(() => vi.advanceTimersByTime(HOLD_START_MS - 1));
    expect(rig.panHold).not.toHaveBeenCalledWith({ dx: -1, dy: 0 });

    act(() => vi.advanceTimersByTime(1));
    expect(rig.panHold).toHaveBeenLastCalledWith({ dx: -1, dy: 0 });

    up('Pan left');
    expect(rig.panHold).toHaveBeenLastCalledWith(null);
  });

  it('never starts the held move when it is let go before the delay', () => {
    renderWithQueryClient(<PanPad />);

    down('Pan down');
    act(() => vi.advanceTimersByTime(100));
    up('Pan down');
    act(() => vi.advanceTimersByTime(HOLD_START_MS));

    expect(rig.panStep).toHaveBeenCalledTimes(1);
    expect(rig.panHold.mock.calls.every(([direction]) => direction === null)).toBe(true);
  });

  it.each([
    ['a cancelled pointer', (name: string) => fireEvent.pointerCancel(button(name))],
    ['a lost capture', (name: string) => fireEvent.lostPointerCapture(button(name))],
    ['a window blur', () => fireEvent.blur(window)],
  ])('lets a held move go on %s', (_, release) => {
    renderWithQueryClient(<PanPad />);
    down('Pan right');
    act(() => vi.advanceTimersByTime(HOLD_START_MS));
    expect(rig.panHold).toHaveBeenLastCalledWith({ dx: 1, dy: 0 });

    release('Pan right');

    expect(rig.panHold).toHaveBeenLastCalledWith(null);
  });

  it('lets a held move go when it unmounts', () => {
    const { unmount } = renderWithQueryClient(<PanPad />);
    down('Pan up');
    act(() => vi.advanceTimersByTime(HOLD_START_MS));

    unmount();

    expect(rig.panHold).toHaveBeenLastCalledWith(null);
  });

  it('ignores a press with another button than the main one', () => {
    renderWithQueryClient(<PanPad />);

    down('Pan up', { button: 2 });

    expect(rig.panStep).not.toHaveBeenCalled();
  });

  it('steps from a keyboard activation once, and not again from the click a pointer press ends in', () => {
    renderWithQueryClient(<PanPad />);

    // A keyboard activation is a click with no detail.
    fireEvent.click(button('Pan up and left'), { detail: 0 });
    expect(rig.panStep).toHaveBeenCalledExactlyOnceWith(-Math.SQRT1_2, Math.SQRT1_2);

    // A pointer press steps on its own pointer-down; its click carries a detail and adds nothing.
    rig.panStep.mockClear();
    fireEvent.click(button('Pan up'), { detail: 1 });
    expect(rig.panStep).not.toHaveBeenCalled();
  });

  describe('the centre button', () => {
    it('is aria-disabled with nothing selected, keeps focus, and does nothing', () => {
      renderWithQueryClient(<PanPad />);
      const centre = button('Centre on the selection');

      expect(centre).toHaveAttribute('aria-disabled', 'true');
      expect(centre).not.toBeDisabled();
      act(() => centre.focus());
      expect(centre).toHaveFocus();

      fireEvent.click(centre);
      expect(rig.centreOn).not.toHaveBeenCalled();
    });

    it('centres on the selected asset', () => {
      renderWithQueryClient(<PanPad />);

      act(() => useConsole.getState().selectAsset('CT-01', null));
      const centre = button('Centre on the selection');
      expect(centre).not.toHaveAttribute('aria-disabled');
      fireEvent.click(centre);

      expect(rig.centreOn).toHaveBeenCalledExactlyOnceWith({ kind: 'asset', code: 'CT-01' });
    });

    it('centres a selected part on its asset', () => {
      renderWithQueryClient(<PanPad />);

      act(() => {
        useConsole.getState().selectAsset('CT-01', null);
        useConsole.getState().selectPart('FanBlade');
      });
      fireEvent.click(button('Centre on the selection'));

      expect(rig.centreOn).toHaveBeenCalledExactlyOnceWith({ kind: 'asset', code: 'CT-01' });
    });

    it('centres on the beacon of a selected incident that has no asset', () => {
      renderWithQueryClient(<PanPad />);

      act(() => useConsole.getState().select('incident-1'));
      fireEvent.click(button('Centre on the selection'));

      expect(rig.centreOn).toHaveBeenCalledExactlyOnceWith({ kind: 'incident', id: 'incident-1' });
    });
  });

  it('does nothing, and does not throw, while no rig is registered', () => {
    unregister();
    renderWithQueryClient(<PanPad />);

    expect(() => {
      down('Pan up');
      act(() => vi.advanceTimersByTime(HOLD_START_MS));
      up('Pan up');
    }).not.toThrow();
    expect(rig.panStep).not.toHaveBeenCalled();
  });

  it('is the same for every role: it reads no permission', () => {
    // The pad takes nothing from the session, so a viewer has it exactly as an operator does.
    renderWithQueryClient(<PanPad />);

    expect(screen.getByRole('group', { name: 'Pan the view' })).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    vi.useRealTimers();
    renderWithQueryClient(<PanPad />);

    await expectNoAxeViolations();
  });
});
