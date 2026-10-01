import type { Camera } from '@occ/contracts';

/** Online cameras in the given zone first, then the rest; offline cameras last. */
export function prioritise(cameras: Camera[], zoneId: string | undefined): Camera[] {
  const score = (c: Camera) => (c.zoneId === zoneId ? 0 : 1) + (c.online ? 0 : 2);
  return [...cameras].sort((a, b) => score(a) - score(b) || a.code.localeCompare(b.code));
}
