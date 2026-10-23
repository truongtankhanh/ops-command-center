import type { Incident, IncidentSeverity, IncidentStatus } from '@occ/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { queryKeys } from '../api/queries';
import { createTestQueryClient, queryWrapper } from '../test-utils';
import { useAttentionBadge } from './useAttentionBadge';

const TITLE = 'Ops Command Center';
const ICON = '/favicon.svg';
const DATA_URL = 'data:image/svg+xml,';

const incident = (id: string, severity: IncidentSeverity, status: IncidentStatus): Incident => ({
  id,
  code: 'INC-000001',
  type: 'fire_alarm',
  title: `Incident ${id}`,
  description: null,
  zoneId: 'z1',
  position: [0, 0],
  source: 'operator',
  reportedAt: '2026-10-08T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  severity,
  status,
});

const iconLink = () => document.querySelector<HTMLLinkElement>('link[rel="icon"]');
const icon = () => iconLink()!.getAttribute('href')!;
/** The badged icon's SVG markup. */
const decodedIcon = () => decodeURIComponent(icon().slice(DATA_URL.length));

// The browser tab shows the active critical count, so it is seen from another tab or window.
describe('useAttentionBadge', () => {
  let client: QueryClient;

  // `index.html` gives the console its title and icon; the hook must hand both back unchanged.
  beforeEach(() => {
    document.title = TITLE;
    const link = document.createElement('link');
    link.rel = 'icon';
    link.setAttribute('href', ICON);
    document.head.append(link);
    client = createTestQueryClient();
  });

  afterEach(() => {
    iconLink()?.remove();
    document.title = '';
  });

  /** `useIncidents` never goes stale, so a seeded list makes no request. */
  function renderBadge(incidents: Incident[]) {
    client.setQueryData(queryKeys.incidents, incidents);
    return renderHook(() => useAttentionBadge(), { wrapper: queryWrapper(client) });
  }

  /**
   * A later change, as a live event brings it: the cache keeps a copy only when its `version` is
   * higher (`mergeIncidentLists`), and tells the hook on a `setTimeout(0)`, so cases wait for it.
   */
  const update = (next: Incident[]) => act(() => client.setQueryData(queryKeys.incidents, next));
  const resolved = (id: string): Incident => ({
    ...incident(id, 'critical', 'resolved'),
    version: 2,
  });

  it('leaves the title and the icon alone without an active critical incident', () => {
    renderBadge([incident('a', 'high', 'open'), incident('b', 'medium', 'acknowledged')]);

    expect(document.title).toBe(TITLE);
    expect(icon()).toBe(ICON);
  });

  it('counts the active critical incidents in the title, as the KPI tile does', () => {
    renderBadge([
      incident('a', 'critical', 'open'),
      incident('b', 'critical', 'acknowledged'),
      incident('c', 'critical', 'resolved'),
      incident('d', 'high', 'open'),
    ]);

    expect(document.title).toBe(`(2) ${TITLE}`);
  });

  it('draws a critical dot over the mark in the icon', () => {
    renderBadge([incident('a', 'critical', 'open')]);

    expect(icon().startsWith(DATA_URL)).toBe(true);
    expect(decodedIcon()).toContain('viewBox="0 0 32 32"');
    expect(decodedIcon()).toContain('#ff5a4e');
  });

  it('follows the count without stacking numbers in the title', async () => {
    renderBadge([incident('a', 'critical', 'open'), incident('b', 'critical', 'open')]);
    expect(document.title).toBe(`(2) ${TITLE}`);

    update([incident('a', 'critical', 'open'), resolved('b')]);

    await waitFor(() => expect(document.title).toBe(`(1) ${TITLE}`));
  });

  it('puts the title and the icon back once no critical incident is active', async () => {
    renderBadge([incident('a', 'critical', 'open')]);

    update([resolved('a')]);

    await waitFor(() => expect(document.title).toBe(TITLE));
    expect(icon()).toBe(ICON);
  });

  it('puts the title and the icon back when the console goes (sign-out)', () => {
    const { unmount } = renderBadge([incident('a', 'critical', 'open')]);

    unmount();

    expect(document.title).toBe(TITLE);
    expect(icon()).toBe(ICON);
  });

  it('still updates the title when the page has no icon link', () => {
    iconLink()!.remove();

    const { unmount } = renderBadge([incident('a', 'critical', 'open')]);

    expect(document.title).toBe(`(1) ${TITLE}`);
    expect(() => unmount()).not.toThrow();
    expect(document.title).toBe(TITLE);
  });
});
