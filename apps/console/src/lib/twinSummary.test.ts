import type { Incident } from '@occ/contracts';
import { activeIncidentCount, twinSummary } from './twinSummary';

const incident = (overrides: Partial<Incident>): Incident => ({
  id: 'id',
  code: 'INC-000001',
  type: 'intrusion',
  severity: 'medium',
  status: 'open',
  title: 'Test',
  description: null,
  zoneId: 'z1',
  position: [108.44, 11.95],
  source: 'operator',
  reportedAt: '2026-10-01T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

const POINTER = 'Drag to rotate. The incident list and the Assets tab list everything shown here.';

describe('activeIncidentCount', () => {
  it('counts the open and the acknowledged incidents, not the resolved ones', () => {
    expect(
      activeIncidentCount([
        incident({ status: 'open' }),
        incident({ status: 'acknowledged' }),
        incident({ status: 'resolved' }),
      ]),
    ).toBe(2);
  });

  it('is 0 for an empty list', () => {
    expect(activeIncidentCount([])).toBe(0);
  });

  it('does not depend on the severity or the type', () => {
    expect(
      activeIncidentCount([
        incident({ severity: 'low' }),
        incident({ severity: 'critical', type: 'fire' }),
      ]),
    ).toBe(2);
  });
});

describe('twinSummary', () => {
  it('names the site and the active incidents, then says where the rest is', () => {
    expect(twinSummary({ siteName: 'Langbiang Tech Campus', activeIncidents: 8 })).toBe(
      `3D view of Langbiang Tech Campus with 8 active incidents. ${POINTER}`,
    );
  });

  it('says "1 active incident" for one', () => {
    expect(twinSummary({ siteName: 'Langbiang Tech Campus', activeIncidents: 1 })).toBe(
      `3D view of Langbiang Tech Campus with 1 active incident. ${POINTER}`,
    );
  });

  it('says there are none rather than a bare 0', () => {
    expect(twinSummary({ siteName: 'Langbiang Tech Campus', activeIncidents: 0 })).toBe(
      `3D view of Langbiang Tech Campus with no active incidents. ${POINTER}`,
    );
  });

  it('leaves the count out while the incidents are not loaded, never reading it as 0', () => {
    const summary = twinSummary({ siteName: 'Langbiang Tech Campus', activeIncidents: null });

    expect(summary).toBe(`3D view of Langbiang Tech Campus. ${POINTER}`);
    expect(summary).not.toContain('active incident');
    expect(summary).not.toContain('no active');
    expect(summary).not.toMatch(/\b0\b/);
  });

  it('calls a site without a name "the campus"', () => {
    expect(twinSummary({ siteName: undefined, activeIncidents: 3 })).toBe(
      `3D view of the campus with 3 active incidents. ${POINTER}`,
    );
    expect(twinSummary({ siteName: '   ', activeIncidents: 3 })).toContain('3D view of the campus');
  });

  it('reads only the pointer after the site when neither the name nor the count is known', () => {
    expect(twinSummary({ siteName: undefined, activeIncidents: null })).toBe(
      `3D view of the campus. ${POINTER}`,
    );
  });
});

describe('twinSummary with the heat overlay (V2-17.3)', () => {
  const SCALE =
    'Campus coloured by indoor temperature per building, 19 to 27 °C; lighter is warmer.';
  const domain = [19, 27] as const;
  const base = { siteName: 'Langbiang Tech Campus', activeIncidents: 8 };
  const heatOf = (...silentNames: string[]) => ({ silentNames, domain });

  it('says what the colours mean between the incidents and the pointer', () => {
    expect(twinSummary({ ...base, heat: heatOf() })).toBe(
      `3D view of Langbiang Tech Campus with 8 active incidents. ${SCALE} ${POINTER}`,
    );
  });

  it('names a faded building, agreeing the number: "its sensor" for one', () => {
    expect(twinSummary({ ...base, heat: heatOf('Security Office') })).toBe(
      `3D view of Langbiang Tech Campus with 8 active incidents. ${SCALE} Security Office faded: its sensor is silent. ${POINTER}`,
    );
  });

  it('names several: "A and B", "A, B and C", "their sensor"', () => {
    expect(twinSummary({ ...base, heat: heatOf('Library', 'Security Office') })).toContain(
      'Library and Security Office faded: their sensor is silent.',
    );
    expect(twinSummary({ ...base, heat: heatOf('Library', 'Gym', 'Security Office') })).toContain(
      'Library, Gym and Security Office faded: their sensor is silent.',
    );
  });

  it('leaves the faded sentence out when every building reports', () => {
    const summary = twinSummary({ ...base, heat: heatOf() });

    expect(summary).not.toContain('faded');
    expect(summary).not.toContain('silent');
  });

  it('writes the scale it is given, so the numbers are never typed twice', () => {
    expect(twinSummary({ ...base, heat: { silentNames: [], domain: [10, 30] } })).toContain(
      '10 to 30 °C',
    );
  });

  it('is the summary it was without the overlay when there is none', () => {
    const without = twinSummary(base);

    expect(twinSummary({ ...base, heat: null })).toBe(without);
    expect(twinSummary({ ...base, heat: undefined })).toBe(without);
    expect(without).not.toContain('Campus coloured');
  });

  it('keeps the unknown count out of it, as before', () => {
    expect(twinSummary({ siteName: undefined, activeIncidents: null, heat: heatOf() })).toBe(
      `3D view of the campus. ${SCALE} ${POINTER}`,
    );
  });
});
