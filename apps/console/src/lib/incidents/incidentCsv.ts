import type { Incident } from '@occ/contracts';
import { severityLabel, sourceLabel, statusLabel, typeLabel } from './incidents';
import type { TableSortContext } from './incidentTable';

/*
 * The incident table's CSV export (V3-24.2, frame 19, brief § Operations aids, Table mode; Open questions 14 and 22 of the
 * phase-2 tasks). Pure: no React, no store, no `Date.now()`, no DOM; the button (V3-24.6) passes the rows exactly as the
 * table shows them and hands the text to `downloadText` (`lib/shared/download.ts`).
 *
 * What it exports is what every role can already read (`GET /api/incidents` limits no role in what it reads): the table's
 * fields, never the description or the position. The rows keep the order given; nothing here filters or sorts.
 *
 * Every text cell goes through `neutralizeCell` before RFC 4180 quoting, because a title is free text an operator or a
 * rule's name types, and a spreadsheet would run `=HYPERLINK(...)` as a formula. The time cells are not neutralised: they
 * are written here as `toISOString()`, which starts with the year's first digit for any year from 0 to 9999 (only a year
 * outside that range is written with a sign, and no incident time is one).
 */

/**
 * Written before the CSV by the caller, so Excel on Windows reads UTF-8 (Vietnamese accents) instead of the system code
 * page; LibreOffice, Google Sheets and Numbers skip it. Kept out of `incidentsToCsv` so the CSV itself stays exactly the
 * header and the rows (Open question 22).
 */
export const CSV_BOM = '﻿';

/** The same zone map the table sorts by, so the button passes one map to both. */
export type IncidentCsvContext = Pick<TableSortContext, 'zoneName'>;

const HEADER = [
  'Code',
  'Severity',
  'Type',
  'Title',
  'Place',
  'Status',
  'Source',
  'Raised',
  'Acknowledged',
  'Resolved',
] as const;

/** RFC 4180 ends every line with CRLF; the last line keeps it too, so the empty export is the header and one CRLF. */
const LINE_END = '\r\n';

/** The characters a spreadsheet reads as the start of a formula (OWASP's CSV injection list). */
const FORMULA_TRIGGERS: ReadonlySet<string> = new Set(['=', '+', '-', '@', '\t', '\r']);

/**
 * A text cell that would start a formula, prefixed with `'` so a spreadsheet shows it as text. Only the first character
 * counts: a leading space before `=` is not evaluated. It changes the exported text, never the incident.
 */
export function neutralizeCell(text: string): string {
  return FORMULA_TRIGGERS.has(text.charAt(0)) ? `'${text}` : text;
}

/** RFC 4180: a field holding a comma, a double quote, a CR or an LF is quoted, and its quotes are doubled. */
function quoteField(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}

/**
 * A time as UTC ISO 8601, so every row reads alike whatever offset the API sent. A missing time (not yet acknowledged or
 * resolved) and one that does not parse are an empty cell, never `Invalid Date`.
 */
function isoCell(at: string | null): string {
  if (at === null) return '';
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? '' : new Date(ms).toISOString();
}

function rowCells(incident: Incident, { zoneName }: IncidentCsvContext): string[] {
  // `severityLabel` and `statusLabel` give `undefined` for a value this console does not know yet; the raw value is
  // exported instead (`typeLabel` and `sourceLabel` already fall back to it).
  const text = [
    incident.code,
    severityLabel(incident.severity) ?? incident.severity,
    typeLabel(incident.type),
    incident.title,
    zoneName.get(incident.zoneId) ?? '',
    statusLabel(incident.status) ?? incident.status,
    sourceLabel(incident.source),
  ].map(neutralizeCell);
  const times = [incident.reportedAt, incident.acknowledgedAt, incident.resolvedAt].map(isoCell);
  return [...text, ...times];
}

/** The rows as CSV, in the order given: one header line, one line per incident, every line ending with CRLF. No BOM. */
export function incidentsToCsv(rows: readonly Incident[], context: IncidentCsvContext): string {
  const lines = [HEADER, ...rows.map((incident) => rowCells(incident, context))];
  return lines.map((cells) => cells.map(quoteField).join(',') + LINE_END).join('');
}

const pad2 = (value: number): string => String(value).padStart(2, '0');

/**
 * `incidents-YYYYMMDD-HHmm.csv` in the browser's local time, the time the operator reads on the header clock (Open
 * question 22). `now` is epoch ms, as every other pure module here takes it.
 */
export function csvFilename(now: number): string {
  const at = new Date(now);
  const date = `${at.getFullYear()}${pad2(at.getMonth() + 1)}${pad2(at.getDate())}`;
  const time = `${pad2(at.getHours())}${pad2(at.getMinutes())}`;
  return `incidents-${date}-${time}.csv`;
}
