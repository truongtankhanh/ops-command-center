import { act, fireEvent, render, screen } from '@testing-library/react';
import { useConsole } from '../store';
import { resetStore } from '../test-utils';
import { DragHint } from './DragHint';

const KEY = 'occ.console.twinDragHintSeen';
const TEXT = /Drag to rotate/;

/** The hint inside a stage box, whose pointer events it watches. */
function renderOnStage() {
  const view = render(
    <div data-testid="stage">
      <DragHint />
    </div>,
  );
  return { ...view, stage: screen.getByTestId('stage') };
}

const down = (stage: HTMLElement, x = 0, y = 0) =>
  fireEvent.pointerDown(stage, { clientX: x, clientY: y, buttons: 1 });
const move = (stage: HTMLElement, x: number, y = 0, buttons = 1) =>
  fireEvent.pointerMove(stage, { clientX: x, clientY: y, buttons });

describe('DragHint', () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetStore(useConsole);
  });

  afterEach(() => vi.restoreAllMocks());

  it('shows the instruction, with Shift as a key, until the first drag', () => {
    renderOnStage();

    const hint = screen.getByText(TEXT);
    expect(hint).toHaveTextContent('Drag to rotate · Pan tool or Shift + drag to pan');
    expect(hint.querySelector('kbd')).toHaveTextContent('Shift');
  });

  it('says it the other way round while the Pan tool is on', () => {
    renderOnStage();

    act(() => useConsole.getState().setPanTool(true));

    const hint = screen.getByText(/Drag to pan/);
    expect(hint).toHaveTextContent('Drag to pan · Shift + drag to rotate');
    expect(hint.querySelector('kbd')).toHaveTextContent('Shift');
  });

  it('is decoration: hidden from assistive tech', () => {
    renderOnStage();

    expect(screen.getByText(TEXT)).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('paragraph')).toBeNull();
  });

  it('goes after a drag of more than 4 px, and is remembered for this tab', () => {
    const { stage } = renderOnStage();

    down(stage, 10, 10);
    move(stage, 30, 10);

    expect(screen.queryByText(TEXT)).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBe('true');
  });

  it('stays for a click, and for a movement of 4 px or less, and for a move with no button down', () => {
    const { stage } = renderOnStage();

    down(stage, 10, 10);
    move(stage, 12, 12);
    expect(screen.getByText(TEXT)).toBeInTheDocument();

    fireEvent.pointerUp(stage, { clientX: 12, clientY: 12 });
    move(stage, 90, 90, 0);
    expect(screen.getByText(TEXT)).toBeInTheDocument();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('does not count a move after the button went up as the start of a drag', () => {
    const { stage } = renderOnStage();

    down(stage, 0, 0);
    fireEvent.pointerUp(stage, { clientX: 0, clientY: 0 });
    move(stage, 80, 0);

    expect(screen.getByText(TEXT)).toBeInTheDocument();
  });

  it('stays gone for a new mount in the same tab', () => {
    const first = renderOnStage();
    down(first.stage);
    move(first.stage, 50);
    first.unmount();

    renderOnStage();

    expect(screen.queryByText(TEXT)).toBeNull();
  });

  it('comes back in a new tab, which has no session storage of its own yet', () => {
    sessionStorage.setItem(KEY, 'true');
    sessionStorage.clear();

    renderOnStage();

    expect(screen.getByText(TEXT)).toBeInTheDocument();
  });

  it('sits at the top of the visible part while the sheet is open', () => {
    renderOnStage();
    expect(screen.getByText(TEXT)).not.toHaveAttribute('data-at');

    act(() => useConsole.getState().select('inc-1'));

    expect(screen.getByText(TEXT)).toHaveAttribute('data-at', 'top');
  });

  it('shows, and is dismissed in memory, when storage is blocked', () => {
    const blocked = () => {
      throw new Error('Storage is disabled');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    const { stage } = renderOnStage();
    expect(screen.getByText(TEXT)).toBeInTheDocument();

    down(stage);
    move(stage, 50);

    expect(screen.queryByText(TEXT)).toBeNull();
  });
});
