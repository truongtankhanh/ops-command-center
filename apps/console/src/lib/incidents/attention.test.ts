import type { Incident } from '@occ/contracts';
import { incidentToast } from './attention';

const incident = (overrides: Partial<Incident> = {}): Incident => ({
  id: 'incident-1',
  code: 'INC-000107',
  type: 'equipment_fault',
  severity: 'critical',
  status: 'open',
  title: 'Motor over-temperature — Cooling tower 1',
  description: null,
  zoneId: 'zone-dc',
  position: [108.44, 11.95],
  source: 'operator',
  reportedAt: '2026-10-16T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

const telemetry = (overrides: Partial<Incident> = {}) =>
  incident({ source: 'telemetry', assetId: 'asset-ct-01', ...overrides });

const zone = { name: 'Data Center', kind: 'building', heightM: 14 } as const;
const tower = { code: 'CT-01', elevationM: 14 };
const READING = '92 °C for 60 s, limit 85 °C';
const noop = () => {};

describe('incidentToast', () => {
  // V2-16.5: the 3D view's toast has two actions, chosen by whether the caller has a way to fly.
  describe('in the 3D view, with a way to fly (V2-16.5)', () => {
    it.each(['critical', 'high'] as const)(
      'offers "Fly to" and "Open incident" for a %s incident',
      (severity) => {
        const onView = vi.fn();
        const onFly = vi.fn();

        const toast = incidentToast(incident({ severity }), {}, onView, onFly);

        expect(toast?.action).toEqual({ label: 'Fly to', onAction: onFly });
        expect(toast?.secondaryAction).toEqual({ label: 'Open incident', onAction: onView });
      },
    );

    it('runs only the handler of the button that is pressed', () => {
      const onView = vi.fn();
      const onFly = vi.fn();
      const toast = incidentToast(incident(), {}, onView, onFly);

      toast?.secondaryAction?.onAction();
      expect(onView).toHaveBeenCalledTimes(1);
      expect(onFly).not.toHaveBeenCalled();

      toast?.action?.onAction();
      expect(onFly).toHaveBeenCalledTimes(1);
      expect(onView).toHaveBeenCalledTimes(1);
    });

    it('offers the same pair for an incident a telemetry rule raised', () => {
      const toast = incidentToast(telemetry(), { zone, asset: tower }, noop, noop);

      expect(toast?.action?.label).toBe('Fly to');
      expect(toast?.secondaryAction?.label).toBe('Open incident');
    });

    it('changes nothing else about the toast', () => {
      const context = { zone, asset: tower, evidence: READING };

      const { action, secondaryAction, ...fly } = incidentToast(telemetry(), context, noop, noop)!;
      const { action: single, ...view } = incidentToast(telemetry(), context, noop)!;

      expect(action).toBeDefined();
      expect(secondaryAction).toBeDefined();
      expect(single).toBeDefined();
      expect(fly).toEqual(view);
    });

    it('still gives no toast for a severity that gets none', () => {
      expect(incidentToast(incident({ severity: 'medium' }), {}, noop, noop)).toBeNull();
    });
  });

  describe('in the 2D view, with no way to fly', () => {
    it('keeps the single "View incident" action and no secondary action', () => {
      const onView = vi.fn();

      const toast = incidentToast(incident(), {}, onView);

      expect(toast?.action).toEqual({ label: 'View incident', onAction: onView });
      expect(toast).not.toHaveProperty('secondaryAction');
    });
  });

  describe('an incident a person or the simulator reported', () => {
    it('is the toast it has always been', () => {
      expect(incidentToast(incident(), { zone }, noop)).toEqual({
        key: 'incident-1',
        severity: 'critical',
        icon: expect.anything(),
        kicker: 'New critical · Equipment fault',
        title: 'Motor over-temperature — Cooling tower 1',
        detail: 'Data Center · INC-000107 · just now',
        urgent: true,
        action: { label: 'View incident', onAction: noop },
      });
    });

    it('leaves the zone out while the zones are not loaded', () => {
      expect(incidentToast(incident(), {}, noop)?.detail).toBe('INC-000107 · just now');
    });

    it('treats the simulator like a person', () => {
      const toast = incidentToast(incident({ source: 'simulator' }), { zone }, noop);

      expect(toast?.kicker).toBe('New critical · Equipment fault');
      expect(toast?.detail).toBe('Data Center · INC-000107 · just now');
    });

    it('ignores an asset and a reading it was given', () => {
      const toast = incidentToast(incident(), { zone, asset: tower, evidence: READING }, noop);

      expect(toast?.detail).toBe('Data Center · INC-000107 · just now');
    });

    it('is urgent only when critical', () => {
      expect(incidentToast(incident({ severity: 'high' }), { zone }, noop)?.urgent).toBe(false);
    });
  });

  it.each(['medium', 'low'] as const)('has no toast for a %s incident', (severity) => {
    expect(incidentToast(incident({ severity }), { zone }, noop)).toBeNull();
    expect(incidentToast(telemetry({ severity }), { zone, asset: tower }, noop)).toBeNull();
  });

  describe('an incident a telemetry rule raised', () => {
    it('says so in the kicker, with the severity and without "New"', () => {
      expect(incidentToast(telemetry(), { zone, asset: tower }, noop)?.kicker).toBe(
        'Critical · raised by telemetry rule',
      );
      expect(
        incidentToast(telemetry({ severity: 'high' }), { zone, asset: tower }, noop)?.kicker,
      ).toBe('High · raised by telemetry rule');
    });

    it('names the asset and where it stands, not who or when', () => {
      expect(incidentToast(telemetry(), { zone, asset: tower }, noop)?.detail).toBe(
        'CT-01 · Data Center · roof',
      );
    });

    it('adds the reading once it is known', () => {
      expect(
        incidentToast(telemetry(), { zone, asset: tower, evidence: READING }, noop)?.detail,
      ).toBe(`CT-01 · Data Center · roof · ${READING}`);
    });

    it('names the zone and the incident while the asset is not known', () => {
      expect(incidentToast(telemetry(), { zone }, noop)?.detail).toBe('Data Center · INC-000107');
    });

    it('still adds the reading when the asset is not known', () => {
      expect(
        incidentToast(telemetry(), { zone, evidence: '92 for 60 s, limit 85' }, noop)?.detail,
      ).toBe('Data Center · INC-000107 · 92 for 60 s, limit 85');
    });

    it('names the asset alone while the zones are not loaded', () => {
      expect(incidentToast(telemetry(), { asset: tower }, noop)?.detail).toBe('CT-01');
    });

    it('names the incident alone with neither the asset nor the zone', () => {
      expect(incidentToast(telemetry(), {}, noop)?.detail).toBe('INC-000107');
    });

    it('keeps the title, the key, the urgency and the action', () => {
      const onView = vi.fn();

      const toast = incidentToast(telemetry(), { zone, asset: tower }, onView);

      expect(toast).toMatchObject({
        key: 'incident-1',
        severity: 'critical',
        title: 'Motor over-temperature — Cooling tower 1',
        urgent: true,
        action: { label: 'View incident' },
      });
      toast?.action?.onAction();
      expect(onView).toHaveBeenCalledTimes(1);
    });
  });
});
