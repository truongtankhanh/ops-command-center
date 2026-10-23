import type { TelemetryPoint, TelemetryValue } from '@occ/contracts';
import { formatReading } from '../assets/readings';
import { bindingsFromNodes, type NodeInfo, partTree } from './twinBindings';

/*
 * The parts of a modelled asset, as the inspector lists them (V2-09.9, frames 03, 05 and 08) and the incident
 * sheet's link names them (V2-11.3), read from the model (V2-14.10): every named node of the class root in
 * document order, children straight after their parent (`partTree`), with the point a bound node follows
 * (`bindingsFromNodes`). Pure: the tree comes from `glbJson.ts`, the points from the asset's detail.
 *
 * The rows are the model's: a node the model has is a row, so the vendor's delivery decides which static
 * parts appear (asset-classes.md § Parts of an asset). This replaced the hand-written table of V2-09.9.
 */

export interface PartRow {
  /** The node's name in the model; unique within a class. */
  name: string;
  /** What the operator reads: a bound node's `extras.label`, else the node's name in sentence case. */
  label: string;
  /** The `key` of the point the part follows; `null` for a static part (and a bound one whose binding was dropped). */
  bind: string | null;
  /** The name of the part this one sits under, or `null` for a top-level part. */
  parent: string | null;
}

const upperFirst = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);
const lowerFirst = (word: string): string => word.charAt(0).toLowerCase() + word.slice(1);

/**
 * A node name as a label: words split where a lower-case letter or a digit meets a capital, the first word
 * capitalised and the others in lower case ("FanStack" → "Fan stack"). A word that starts with two capitals is
 * an acronym and is left as written ("HVACUnit" stays one word).
 */
export function sentenceCase(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' ');
  return words
    .map((word, index) =>
      index === 0 ? upperFirst(word) : /^[A-Z]{2}/.test(word) ? word : lowerFirst(word),
    )
    .join(' ');
}

/**
 * The rows of a model for an asset of the class whose points are `points`. A bound node whose binding the
 * catalogue cannot take (an unknown key, a missing range, …; `bindingsFromNodes` reports it) has no key here
 * and reads as a static row, like a node with no binding at all.
 */
export function partRows(root: NodeInfo, points: readonly TelemetryPoint[]): PartRow[] {
  const { bindings } = bindingsFromNodes(root, points);
  const byNode = new Map(bindings.map((binding) => [binding.node, binding]));
  return partTree(root).map(({ name, parent }) => {
    const binding = byNode.get(name);
    return {
      name,
      label: binding?.label ?? sentenceCase(name),
      bind: binding?.key ?? null,
      parent,
    };
  });
}

/** Whether another row sits under `row`: it is drawn open, with a chevron. */
export function hasChildren(row: PartRow, rows: readonly PartRow[]): boolean {
  return rows.some((other) => other.parent === row.name);
}

/**
 * What a part row says: "static" for a part that binds nothing, "—" for a bound one with no
 * reading yet, else the reading as the readings rows write it. While the asset is not live the
 * reading reads "last 1,420 rpm" (frame 05), so a remembered value is never taken for a live one.
 */
export function partText(
  row: Pick<PartRow, 'bind'>,
  point: TelemetryPoint | undefined,
  value: TelemetryValue | undefined,
  stale: boolean,
): string {
  if (row.bind === null) return 'static';
  if (point === undefined || value === undefined) return '—';
  const text = formatReading(point, value);
  return stale ? `last ${text}` : text;
}
