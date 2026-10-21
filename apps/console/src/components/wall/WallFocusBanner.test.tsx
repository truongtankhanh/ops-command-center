import type { AssetDetail, Incident, IncidentDetail, TelemetryPoint, Zone } from '@occ/contracts';
import { screen } from '@testing-library/react';
import { queryKeys } from '../../api/queries';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
} from '../../test-utils';
import { WallFocusBanner } from './WallFocusBanner';

const TEMP: TelemetryPoint = {
  key: 'motorTempC',
  label: 'Motor temperature',
  unit: '°C',
  kind: 'number',
  min: -40,
  max: 150,
  enumValues: null,
  expectedIntervalS: 1,
  headline: 1,
};

const ASSET: AssetDetail = {
  id: 'asset-ct-01',
  code: 'CT-01',
  name: 'Cooling tower 1',
  class: {
    id: 'class-cooling-tower',
    code: 'cooling_tower',
    name: 'Cooling tower',
    modelUrl: null,
    footprintM: { width: 1, depth: 1, height: 1 },
  },
  zoneId: 'zone-dc',
  position: [108.44, 11.95],
  elevationM: 14,
  headingDeg: 0,
  headline: [TEMP],
  points: [TEMP],
  rules: [],
};

const ZONE: Zone = {
  id: 'zone-dc',
  code: 'BLD-DC',
  name: 'Data Center roof',
  kind: 'building',
  heightM: 14,
  polygon: [],
  center: [108.44, 11.95],
};

const INCIDENT: Incident = {
  id: 'i1',
  code: 'INC-000107',
  type: 'equipment_fault',
  severity: 'critical',
  status: 'open',
  title: 'Motor over-temperature — Cooling tower 1',
  description: null,
  zoneId: ZONE.id,
  position: [108.44, 11.95],
  source: 'telemetry',
  assetId: ASSET.id,
  reportedAt: '2026-10-08T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
};

const withEvidence = (note: string | null): IncidentDetail => ({
  ...INCIDENT,
  timeline: [
    {
      id: 'e1',
      kind: 'reported',
      note,
      at: INCIDENT.reportedAt,
      actor: { kind: 'system', subject: 'telemetry', displayName: 'Telemetry rule' },
    },
  ],
});

function renderBanner(
  props: Partial<Parameters<typeof WallFocusBanner>[0]> = {},
  { detail = true, note = 'motorTempC 92 > 85 for 60 s' }: { detail?: boolean; note?: string } = {},
) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.incidents, [INCIDENT]);
  client.setQueryData(queryKeys.zones, [ZONE]);
  client.setQueryData(queryKeys.assets, [ASSET]);
  if (detail) {
    client.setQueryData(queryKeys.incident('i1'), withEvidence(note));
    client.setQueryData(queryKeys.asset('CT-01'), ASSET);
  }
  return renderWithQueryClient(
    <WallFocusBanner incidentId="i1" secondsLeft={48} returned={false} {...props} />,
    client,
  );
}

describe('WallFocusBanner', () => {
  beforeEach(() => {
    // A safety net: a query a case does not seed stays pending, and no request leaves the test.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('shows the title, the incident’s evidence line and the countdown', () => {
    renderBanner();

    expect(screen.getByText('Motor over-temperature — Cooling tower 1')).toBeInTheDocument();
    expect(
      screen.getByText('INC-000107 · Data Center roof · 92 °C, limit 85 °C · not acknowledged'),
    ).toBeInTheDocument();
    expect(screen.getByText('Campus view in')).toBeInTheDocument();
    expect(screen.getByText('48 s')).toBeInTheDocument();
  });

  it('shortens the line to what it knows when the evidence has not arrived', () => {
    renderBanner({}, { detail: false });

    expect(
      screen.getByText('INC-000107 · Data Center roof · not acknowledged'),
    ).toBeInTheDocument();
  });

  it('shortens the line for an incident that has no evidence (a person’s report)', () => {
    renderBanner({}, { note: 'Smoke seen near the gate' });

    expect(
      screen.getByText('INC-000107 · Data Center roof · not acknowledged'),
    ).toBeInTheDocument();
  });

  it('announces the arrival once, in a status that does not hold the countdown', () => {
    renderBanner();
    const status = screen.getByRole('status');

    expect(status).toHaveTextContent(
      'Critical incident INC-000107, Data Center roof: Motor over-temperature — Cooling tower 1',
    );
    expect(status).not.toHaveTextContent('48');
    expect(status).not.toHaveTextContent('Campus view in');
    expect(screen.getByText('48 s').closest('[role="status"]')).toBeNull();
  });

  it('says the return once, in the same status, and draws nothing', () => {
    renderBanner({ incidentId: null, secondsLeft: 0, returned: true });

    expect(screen.getByRole('status')).toHaveTextContent('Back to the campus view');
    expect(screen.queryByText('Campus view in')).not.toBeInTheDocument();
  });

  it('says nothing on the campus view before the first flight', () => {
    renderBanner({ incidentId: null, secondsLeft: 0, returned: false });

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('has no control to press and no axe violation', async () => {
    const { container } = renderBanner();

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});
