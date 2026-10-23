import { categoryOf, type LngLat, type Zone } from '@occ/contracts';
import { reportPresetOf } from './assetReport';
import { REPORT_TITLE_MAX } from './incidents/incidents';

/** A closed square ring, `size` degrees a side, from its south-west corner. */
const square = (west: number, south: number, size: number): LngLat[] => [
  [west, south],
  [west + size, south],
  [west + size, south + size],
  [west, south + size],
  [west, south],
];

const zone = (id: string, west: number): Zone => ({
  id,
  code: id.toUpperCase(),
  name: id,
  kind: 'building',
  polygon: square(west, 11.9, 0.01),
  center: [west + 0.005, 11.905],
});

const DATA_CENTER = zone('data-center', 108.4);
const LIBRARY = zone('library', 108.42);

const INSIDE: LngLat = [108.405, 11.905];
/** East of the data center's edge (108.41) and in no zone, as GEN-01 stands beside its building. */
const BESIDE: LngLat = [108.4101, 11.905];
const IN_LIBRARY: LngLat = [108.425, 11.905];

const asset = (overrides: Partial<Parameters<typeof reportPresetOf>[0]> = {}) => ({
  name: 'Cooling tower 1',
  code: 'CT-01',
  zoneId: DATA_CENTER.id,
  position: INSIDE,
  ...overrides,
});

describe('reportPresetOf', () => {
  describe('what the report is', () => {
    it('is a Facilities equipment fault, and the category is the type’s own', () => {
      const preset = reportPresetOf(asset(), [DATA_CENTER]);

      expect(preset.type).toBe('equipment_fault');
      expect(preset.category).toBe('facilities');
      expect(categoryOf(preset.type)).toBe(preset.category);
    });
  });

  describe('the zone and the pin', () => {
    it("keeps the asset's zone and its own position when it stands inside the zone", () => {
      const preset = reportPresetOf(asset(), [DATA_CENTER, LIBRARY]);

      expect(preset.zoneId).toBe(DATA_CENTER.id);
      expect(preset.position).toEqual(INSIDE);
    });

    it('keeps the zone and sends no pin for an asset beside its zone (the API would answer 400)', () => {
      const preset = reportPresetOf(asset({ position: BESIDE }), [DATA_CENTER, LIBRARY]);

      expect(preset.zoneId).toBe(DATA_CENTER.id);
      expect(preset.position).toBeNull();
    });

    it("sends no pin when the asset's position lies in another zone", () => {
      const preset = reportPresetOf(asset({ position: IN_LIBRARY }), [DATA_CENTER, LIBRARY]);

      expect(preset.zoneId).toBe(DATA_CENTER.id);
      expect(preset.position).toBeNull();
    });

    it('chooses no zone and no pin for a zone the console does not have', () => {
      const preset = reportPresetOf(asset(), [LIBRARY]);

      expect(preset.zoneId).toBeNull();
      expect(preset.position).toBeNull();
    });

    it('chooses no zone and no pin while the zones are loading', () => {
      const preset = reportPresetOf(asset(), undefined);

      expect(preset.zoneId).toBeNull();
      expect(preset.position).toBeNull();
      // The rest of the preset does not wait for reference data.
      expect(preset.type).toBe('equipment_fault');
      expect(preset.title).toBe('Fault — Cooling tower 1 (CT-01)');
    });
  });

  describe('the title', () => {
    it("carries the asset's name and its tag, the only trace of which asset it was", () => {
      expect(reportPresetOf(asset(), [DATA_CENTER]).title).toBe('Fault — Cooling tower 1 (CT-01)');
    });

    it('is not shortened when it fits the limit exactly', () => {
      const room = REPORT_TITLE_MAX - 'Fault — '.length - ' (CT-01)'.length;
      const { title } = reportPresetOf(asset({ name: 'A'.repeat(room) }), [DATA_CENTER]);

      expect(title).toHaveLength(REPORT_TITLE_MAX);
      expect(title).not.toContain('…');
    });

    it('shortens a long name with an ellipsis and keeps the tag, within the limit', () => {
      const { title } = reportPresetOf(asset({ name: 'A'.repeat(300) }), [DATA_CENTER]);

      expect(title.length).toBeLessThanOrEqual(REPORT_TITLE_MAX);
      expect(title.startsWith('Fault — A')).toBe(true);
      expect(title.endsWith('… (CT-01)')).toBe(true);
    });
  });
});
