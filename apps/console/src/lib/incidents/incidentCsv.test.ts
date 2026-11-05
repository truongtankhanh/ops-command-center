import type {
  Incident,
  IncidentSeverity,
  IncidentSource,
  IncidentStatus,
  IncidentType,
} from '@occ/contracts';
import { CSV_BOM, csvFilename, incidentsToCsv, neutralizeCell } from './incidentCsv';

const HEADER = 'Code,Severity,Type,Title,Place,Status,Source,Raised,Acknowledged,Resolved';
const CRLF = '\r\n';

const ZONES = new Map([
  ['z-lib', 'Library'],
  ['z-vn', 'Thư viện'],
  ['z-eq', '=Zone'],
]);
const CONTEXT = { zoneName: ZONES };

/** A value this console does not know yet, as the API could send it first. */
const unknown = <T extends string>(value: string): T => value as T;

const incident = (id: string, overrides: Partial<Incident> = {}): Incident => ({
  id,
  code: `INC-${id}`,
  type: 'water_leak',
  severity: 'medium',
  status: 'open',
  title: `Incident ${id}`,
  description: null,
  zoneId: 'z-lib',
  position: [108.44, 11.95],
  source: 'operator',
  reportedAt: '2026-11-05T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

/**
 * A small RFC 4180 reader, enough to round-trip what the builder writes: quoted fields with doubled quotes, CRLF records.
 * Kept in the spec on purpose: a parser library would be a dependency for tests only.
 */
function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (quoted) {
      if (ch === '"' && text.charAt(i + 1) === '"') {
        field += '"';
        i += 2;
      } else if (ch === '"') {
        quoted = false;
        i += 1;
      } else {
        field += ch;
        i += 1;
      }
    } else if (ch === '"') {
      quoted = true;
      i += 1;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
    } else if (ch === '\r' && text.charAt(i + 1) === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 2;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (field !== '' || row.length > 0) rows.push([...row, field]);
  return rows;
}

/** The data rows of one export, header checked and dropped. */
function exported(rows: readonly Incident[]): string[][] {
  const [header, ...data] = readCsv(incidentsToCsv(rows, CONTEXT));
  expect(header?.join(',')).toBe(HEADER);
  return data;
}

const COLUMN = {
  code: 0,
  severity: 1,
  type: 2,
  title: 3,
  place: 4,
  status: 5,
  source: 6,
  raised: 7,
  acknowledged: 8,
  resolved: 9,
} as const;

/** One field of the single row an export of `row` gives. */
function cell(row: Incident, column: keyof typeof COLUMN): string | undefined {
  return exported([row])[0]?.[COLUMN[column]];
}

describe('incidentsToCsv', () => {
  describe('the header and the lines', () => {
    it('gives only the header line for an empty list', () => {
      expect(incidentsToCsv([], CONTEXT)).toBe(HEADER + CRLF);
    });

    it('writes one line per incident, every line ending with CRLF, the last included', () => {
      const csv = incidentsToCsv([incident('1'), incident('2')], CONTEXT);
      const lines = csv.split(CRLF);
      expect(lines).toHaveLength(4);
      expect(lines[0]).toBe(HEADER);
      expect(lines[3]).toBe('');
      expect(csv.replaceAll(CRLF, '')).not.toMatch(/[\r\n]/);
    });

    it('writes a plain row without quotes', () => {
      const [, line] = incidentsToCsv([incident('000101')], CONTEXT).split(CRLF);
      expect(line).toBe(
        'INC-000101,Medium,Water leak,Incident 000101,Library,Open,Operator,2026-11-05T08:00:00.000Z,,',
      );
    });

    it('keeps the order given and does not sort', () => {
      const rows = [
        incident('3', { severity: 'low' }),
        incident('1', { severity: 'critical' }),
        incident('2', { status: 'resolved' }),
      ];
      expect(exported(rows).map((fields) => fields[COLUMN.code])).toEqual([
        'INC-3',
        'INC-1',
        'INC-2',
      ]);
    });
  });

  describe('quoting (RFC 4180)', () => {
    it.each([
      ['a comma', 'Smoke, east stair'],
      ['a double quote', 'The "red" door'],
      ['an LF', 'First line\nsecond line'],
      ['a CR', 'First line\rsecond line'],
      ['a CRLF', 'First line\r\nsecond line'],
      ['all of them', 'A, "B"\r\nC'],
    ])('round-trips a title with %s', (_, title) => {
      expect(cell(incident('1', { title }), 'title')).toBe(title);
    });

    it('quotes a field with a quote and doubles the quote', () => {
      const csv = incidentsToCsv([incident('1', { title: 'The "red" door' })], CONTEXT);
      expect(csv).toContain(',"The ""red"" door",');
    });

    it('keeps one record per incident when a title holds line breaks', () => {
      const rows = [incident('1', { title: 'a\r\nb' }), incident('2', { title: 'c\nd' })];
      expect(exported(rows)).toHaveLength(2);
    });
  });

  describe('formula injection', () => {
    it('exports =HYPERLINK("x") as text', () => {
      const row = incident('1', { title: '=HYPERLINK("x")' });
      expect(cell(row, 'title')).toBe(`'=HYPERLINK("x")`);
      expect(incidentsToCsv([row], CONTEXT)).toContain(`,"'=HYPERLINK(""x"")",`);
    });

    it.each([
      ['+', '+1'],
      ['-', '-2'],
      ['@', '@SUM(A1)'],
      ['a tab', '\tcmd'],
      ['a CR', '\rcmd'],
    ])('neutralises a title starting with %s', (_, title) => {
      expect(cell(incident('1', { title }), 'title')).toBe(`'${title}`);
    });

    it.each([
      ['an ordinary word', 'Smoke in lab'],
      ['a trigger inside the text', 'a=b'],
      ['a space before =', ' =1'],
      ['an empty title', ''],
    ])('leaves a title with %s untouched', (_, title) => {
      expect(cell(incident('1', { title }), 'title')).toBe(title);
    });

    it('neutralises a zone name that starts a formula', () => {
      expect(cell(incident('1', { zoneId: 'z-eq' }), 'place')).toBe(`'=Zone`);
    });

    it('neutralises an unknown raw value in every labelled column', () => {
      const row = incident('1', {
        code: '-INC',
        severity: unknown<IncidentSeverity>('=sev'),
        type: unknown<IncidentType>('+type'),
        status: unknown<IncidentStatus>('@status'),
        source: unknown<IncidentSource>('=cmd'),
      });
      const [fields] = exported([row]);
      expect(fields?.[COLUMN.code]).toBe(`'-INC`);
      expect(fields?.[COLUMN.severity]).toBe(`'=sev`);
      expect(fields?.[COLUMN.type]).toBe(`'+type`);
      expect(fields?.[COLUMN.status]).toBe(`'@status`);
      expect(fields?.[COLUMN.source]).toBe(`'=cmd`);
    });

    it('never prefixes a time cell', () => {
      const row = incident('1', {
        status: 'resolved',
        acknowledgedAt: '2026-11-05T08:05:00.000Z',
        resolvedAt: '2026-11-05T08:10:00.000Z',
      });
      const [fields] = exported([row]);
      for (const column of ['raised', 'acknowledged', 'resolved'] as const) {
        expect(fields?.[COLUMN[column]]).toMatch(/^\d{4}-/);
      }
    });
  });

  describe('accents', () => {
    it('keeps a Vietnamese title and zone name exactly, not folded', () => {
      const title = 'Rò rỉ nước tầng 2';
      const [fields] = exported([incident('1', { title, zoneId: 'z-vn' })]);
      expect(fields?.[COLUMN.title]).toBe(title);
      expect(fields?.[COLUMN.place]).toBe('Thư viện');
      expect(fields?.[COLUMN.title]?.normalize('NFC')).toBe(fields?.[COLUMN.title]);
    });

    it('leaves the byte order mark to the caller', () => {
      expect(CSV_BOM).toBe('﻿');
      expect(incidentsToCsv([incident('1')], CONTEXT).startsWith(CSV_BOM)).toBe(false);
      expect(incidentsToCsv([incident('1')], CONTEXT).startsWith('Code,')).toBe(true);
    });
  });

  describe('labels', () => {
    it('uses the words the console shows', () => {
      const [fields] = exported([
        incident('1', { severity: 'critical', type: 'water_leak', status: 'acknowledged' }),
      ]);
      expect(fields?.[COLUMN.severity]).toBe('Critical');
      expect(fields?.[COLUMN.type]).toBe('Water leak');
      expect(fields?.[COLUMN.status]).toBe('Being handled');
    });

    it.each([
      ['operator', 'Operator'],
      ['telemetry', 'Telemetry rule'],
      ['simulator', 'Simulator'],
    ] as const)('names the %s source "%s"', (source, label) => {
      expect(cell(incident('1', { source }), 'source')).toBe(label);
    });

    it('writes an unknown source, status, severity and type as the raw value, without throwing', () => {
      const row = incident('1', {
        source: unknown<IncidentSource>('drone'),
        status: unknown<IncidentStatus>('escalated'),
        severity: unknown<IncidentSeverity>('catastrophic'),
        type: unknown<IncidentType>('teleporter_fault'),
      });
      const [fields] = exported([row]);
      expect(fields?.[COLUMN.source]).toBe('drone');
      expect(fields?.[COLUMN.status]).toBe('escalated');
      expect(fields?.[COLUMN.severity]).toBe('catastrophic');
      expect(fields?.[COLUMN.type]).toBe('teleporter_fault');
    });
  });

  describe('place', () => {
    it("is the zone's name", () => {
      expect(cell(incident('1', { zoneId: 'z-lib' }), 'place')).toBe('Library');
    });

    it('is empty for a zone the map lacks', () => {
      expect(cell(incident('1', { zoneId: 'z-gone' }), 'place')).toBe('');
    });
  });

  describe('the ISO columns', () => {
    it('writes a time with an offset in its UTC form', () => {
      expect(cell(incident('1', { reportedAt: '2026-11-05T15:42:00+07:00' }), 'raised')).toBe(
        '2026-11-05T08:42:00.000Z',
      );
    });

    it('writes the acknowledged and resolved times', () => {
      const [fields] = exported([
        incident('1', {
          status: 'resolved',
          acknowledgedAt: '2026-11-05T08:05:00Z',
          resolvedAt: '2026-11-05T15:10:00+07:00',
        }),
      ]);
      expect(fields?.[COLUMN.acknowledged]).toBe('2026-11-05T08:05:00.000Z');
      expect(fields?.[COLUMN.resolved]).toBe('2026-11-05T08:10:00.000Z');
    });

    it('leaves a time not yet set empty', () => {
      const [fields] = exported([incident('1')]);
      expect(fields?.[COLUMN.acknowledged]).toBe('');
      expect(fields?.[COLUMN.resolved]).toBe('');
    });

    it('leaves an unparseable time empty, never "Invalid Date"', () => {
      const csv = incidentsToCsv([incident('1', { reportedAt: 'not a time' })], CONTEXT);
      expect(readCsv(csv)[1]?.[COLUMN.raised]).toBe('');
      expect(csv).not.toContain('Invalid');
    });
  });

  describe('what is not exported', () => {
    it('leaves out the description and the position', () => {
      const csv = incidentsToCsv(
        [incident('1', { description: 'secret, =1', position: [123.456789, 9.876543] })],
        CONTEXT,
      );
      expect(csv).not.toContain('secret');
      expect(csv).not.toContain('123.456789');
      expect(csv).not.toContain('9.876543');
      expect(readCsv(csv)[1]).toHaveLength(10);
    });
  });
});

describe('neutralizeCell', () => {
  it.each(['=1+1', '+1', '-2', '@SUM(A1)', '\tx', '\rx'])('prefixes %j with a quote', (text) => {
    expect(neutralizeCell(text)).toBe(`'${text}`);
  });

  it.each(['', 'Smoke in lab', 'a=b', ' =1', "'=already text", 'INC-000101'])(
    'leaves %j as it is',
    (text) => {
      expect(neutralizeCell(text)).toBe(text);
    },
  );
});

describe('csvFilename', () => {
  it('names the file by local date and time', () => {
    expect(csvFilename(new Date(2026, 9, 21, 15, 42).getTime())).toBe(
      'incidents-20261021-1542.csv',
    );
  });

  it('pads single digits', () => {
    expect(csvFilename(new Date(2026, 0, 5, 7, 3).getTime())).toBe('incidents-20260105-0703.csv');
  });

  it('drops the seconds', () => {
    expect(csvFilename(new Date(2026, 11, 31, 23, 59, 59, 999).getTime())).toBe(
      'incidents-20261231-2359.csv',
    );
  });
});
