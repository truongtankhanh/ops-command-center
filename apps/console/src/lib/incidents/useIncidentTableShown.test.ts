import { act, renderHook } from '@testing-library/react';
import { useConsole } from '../../store';
import { resetStore, stubViewportWidth } from '../../test-utils';
import { useIncidentTableShown } from './useIncidentTableShown';

const shown = () => renderHook(() => useIncidentTableShown()).result;

beforeEach(() => {
  localStorage.clear();
  resetStore(useConsole);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useIncidentTableShown', () => {
  it('is false for the list, the default view', () => {
    expect(shown().current).toBe(false);
  });

  it('is true for the table on the Incidents panel of a laptop', () => {
    useConsole.setState({ feedView: 'table' });

    expect(shown().current).toBe(true);
  });

  it('is true for the table on a tablet, where the stage still has room for it', () => {
    stubViewportWidth(1100);
    useConsole.setState({ feedView: 'table' });

    expect(shown().current).toBe(true);
  });

  it('is false for the table on a phone width, and the stored choice is kept', () => {
    stubViewportWidth(720);
    useConsole.setState({ feedView: 'table' });

    expect(shown().current).toBe(false);
    expect(useConsole.getState().feedView).toBe('table');
  });

  it('follows the width across the phone boundary', () => {
    const viewport = stubViewportWidth(721);
    useConsole.setState({ feedView: 'table' });
    const result = shown();
    expect(result.current).toBe(true);

    act(() => viewport.resize(720));
    expect(result.current).toBe(false);

    act(() => viewport.resize(721));
    expect(result.current).toBe(true);
  });

  it('is false while the Assets panel is shown, and back with the Incidents panel', () => {
    useConsole.setState({ feedView: 'table', sidePanel: 'assets' });
    const result = shown();
    expect(result.current).toBe(false);

    act(() => useConsole.getState().setSidePanel('incidents'));
    expect(result.current).toBe(true);
  });

  it('is false on a video wall, whatever is stored', () => {
    useConsole.setState({ feedView: 'table', wall: 1 });

    expect(shown().current).toBe(false);
  });

  it('follows the switch', () => {
    const result = shown();

    act(() => useConsole.getState().setFeedView('table'));
    expect(result.current).toBe(true);

    act(() => useConsole.getState().setFeedView('list'));
    expect(result.current).toBe(false);
  });
});
