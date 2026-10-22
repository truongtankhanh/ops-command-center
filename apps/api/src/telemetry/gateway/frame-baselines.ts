import type { TelemetryValue } from '@occ/contracts';

/**
 * What each watched room last received, per asset code, so a frame of `telemetry.frames` carries the keys
 * that changed (ADR-0019). `TelemetryIngestService.changedSince` cannot say that by itself: it
 * lists every key a reading *arrived* for, whether or not the value differs.
 *
 * A baseline is seeded from the snapshot a socket gets when it starts watching the asset, so the
 * first frame is not a repeat of that snapshot, and re-listing keys from an old ingest cursor is
 * harmless: whatever is already held is already in the baseline. The gateway drops the baselines
 * of rooms nobody is in (`retain`), which keeps this bounded by the number of watched assets.
 */
export class FrameBaselines {
  /** A `Map` per asset, never an object: keys come from a device's catalogue. */
  private readonly sent = new Map<string, Map<string, TelemetryValue>>();

  has(assetCode: string): boolean {
    return this.sent.has(assetCode);
  }

  /** Replaces the baseline of one asset with a copy of `values`. */
  seed(assetCode: string, values: Readonly<Record<string, TelemetryValue>>): void {
    this.sent.set(assetCode, new Map(Object.entries(values)));
  }

  /**
   * The keys of `values` that differ from what the room last received, or that it has not
   * received yet; those are now what it has received. `undefined` when nothing differs, so the
   * caller sends no frame at all.
   */
  diff(
    assetCode: string,
    values: Readonly<Record<string, TelemetryValue>>,
  ): Record<string, TelemetryValue> | undefined {
    let known = this.sent.get(assetCode);
    if (!known) {
      known = new Map();
      this.sent.set(assetCode, known);
    }
    let changed: Record<string, TelemetryValue> | undefined;
    for (const [key, value] of Object.entries(values)) {
      if (known.get(key) === value) continue;
      known.set(key, value);
      changed ??= {};
      changed[key] = value;
    }
    return changed;
  }

  /** Forgets every asset that is not in `watched`. */
  retain(watched: ReadonlySet<string>): void {
    for (const assetCode of this.sent.keys()) {
      if (!watched.has(assetCode)) this.sent.delete(assetCode);
    }
  }

  clear(): void {
    this.sent.clear();
  }
}
