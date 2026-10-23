/**
 * A random v4 UUID for the `Idempotency-Key` header (ADR-0009).
 *
 * Built from `crypto.getRandomValues()` rather than `crypto.randomUUID()`: the latter only exists
 * in secure contexts (HTTPS or localhost), and the console is served over plain HTTP on the LAN.
 */
export function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
