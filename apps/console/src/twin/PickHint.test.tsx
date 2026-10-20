import { act, render, screen } from '@testing-library/react';
import { useConsole } from '../store';
import { resetStore } from '../test-utils';
import { PickHint } from './PickHint';

const TEXT = /Click the scene to place the incident/;

describe('PickHint (V2-16.7)', () => {
  beforeEach(() => resetStore(useConsole));

  it('shows nothing while no location is picked', () => {
    render(<PickHint />);

    expect(screen.queryByText(TEXT)).toBeNull();
  });

  it('says where to click and how to stop, with Esc as a key, while a location is picked', () => {
    useConsole.setState({ picking: true });

    render(<PickHint />);

    const hint = screen.getByText(TEXT);
    expect(hint).toHaveTextContent('Click the scene to place the incident · Esc stops picking');
    expect(hint.querySelector('kbd')).toHaveTextContent('Esc');
  });

  it('is decoration: hidden from assistive tech', () => {
    useConsole.setState({ picking: true });

    render(<PickHint />);

    expect(screen.getByText(TEXT).closest('p')).toHaveAttribute('aria-hidden', 'true');
  });

  it('follows the store: it comes when picking starts and goes when it stops', () => {
    render(<PickHint />);

    act(() => useConsole.getState().setPicking(true));
    expect(screen.getByText(TEXT)).toBeInTheDocument();

    act(() => useConsole.getState().setPicking(false));
    expect(screen.queryByText(TEXT)).toBeNull();
  });

  it('goes when the report is closed, which stops picking', () => {
    useConsole.setState({ reporting: true, picking: true });
    render(<PickHint />);

    act(() => useConsole.getState().closeReport());

    expect(screen.queryByText(TEXT)).toBeNull();
  });
});
