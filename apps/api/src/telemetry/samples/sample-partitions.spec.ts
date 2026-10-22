import {
  bucketOf,
  dayOfPartition,
  isExpired,
  PARTITION_NAME,
  partitionName,
  partitionRange,
  partitionsToEnsure,
  utcDay,
} from './sample-partitions';

const at = (iso: string) => new Date(iso);

describe('bucketOf', () => {
  it('floors to a multiple of 5 s', () => {
    expect(bucketOf(at('2026-10-14T10:00:07.999Z')).toISOString()).toBe('2026-10-14T10:00:05.000Z');
    expect(bucketOf(at('2026-10-14T10:00:04.999Z')).toISOString()).toBe('2026-10-14T10:00:00.000Z');
  });

  it('keeps an instant that is already on a boundary', () => {
    expect(bucketOf(at('2026-10-14T10:00:05.000Z')).toISOString()).toBe('2026-10-14T10:00:05.000Z');
  });

  it('never leaves its UTC day: the last bucket of a day is still that day', () => {
    expect(bucketOf(at('2026-10-14T23:59:59.999Z')).toISOString()).toBe('2026-10-14T23:59:55.000Z');
    expect(bucketOf(at('2026-10-15T00:00:00.000Z')).toISOString()).toBe('2026-10-15T00:00:00.000Z');
  });
});

describe('utcDay', () => {
  it('is midnight UTC of the day, whatever the time of day', () => {
    expect(utcDay(at('2026-10-14T23:59:59.999Z')).toISOString()).toBe('2026-10-14T00:00:00.000Z');
    expect(utcDay(at('2026-10-14T00:00:00.000Z')).toISOString()).toBe('2026-10-14T00:00:00.000Z');
  });
});

describe('partitionName and partitionRange', () => {
  it('name a UTC day, with the month and day padded', () => {
    expect(partitionName(at('2026-03-04T15:30:00.000Z'))).toBe('telemetry_sample_20260304');
  });

  it('give the half-open range of that day', () => {
    expect(partitionRange(at('2026-10-14T10:00:00.000Z'))).toEqual({
      from: '2026-10-14T00:00:00.000Z',
      to: '2026-10-15T00:00:00.000Z',
    });
  });

  it('cross a year end', () => {
    expect(partitionName(at('2026-12-31T23:00:00.000Z'))).toBe('telemetry_sample_20261231');
    expect(partitionRange(at('2026-12-31T23:00:00.000Z'))).toEqual({
      from: '2026-12-31T00:00:00.000Z',
      to: '2027-01-01T00:00:00.000Z',
    });
  });

  it('produce names the pattern accepts, and that read back to the same day', () => {
    const name = partitionName(at('2026-10-14T10:00:00.000Z'));

    expect(PARTITION_NAME.test(name)).toBe(true);
    expect(dayOfPartition(name)?.toISOString()).toBe('2026-10-14T00:00:00.000Z');
  });
});

describe('dayOfPartition', () => {
  it('reads a leap day', () => {
    expect(dayOfPartition('telemetry_sample_20280229')?.toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
  });

  it.each([
    ['the parent', 'telemetry_sample'],
    ['too few digits', 'telemetry_sample_2026101'],
    ['too many digits', 'telemetry_sample_202610140'],
    ['another table', 'other_20261014'],
    ['a suffix', 'telemetry_sample_20261014_old'],
    ['an impossible month', 'telemetry_sample_20261340'],
    ['an impossible day', 'telemetry_sample_20261032'],
    ['a day that rolls over', 'telemetry_sample_20270229'],
  ])('rejects %s', (_, name) => {
    expect(dayOfPartition(name)).toBeUndefined();
  });
});

describe('partitionsToEnsure', () => {
  it('is today and the next two UTC days', () => {
    const days = partitionsToEnsure(at('2026-10-14T10:00:00.000Z'));

    expect(days.map(partitionName)).toEqual([
      'telemetry_sample_20261014',
      'telemetry_sample_20261015',
      'telemetry_sample_20261016',
    ]);
  });

  it('crosses a month end', () => {
    const days = partitionsToEnsure(at('2026-10-30T12:00:00.000Z'));

    expect(days.map(partitionName)).toEqual([
      'telemetry_sample_20261030',
      'telemetry_sample_20261031',
      'telemetry_sample_20261101',
    ]);
  });

  it('honours the number of days ahead', () => {
    expect(partitionsToEnsure(at('2026-10-14T10:00:00.000Z'), 0).map(partitionName)).toEqual([
      'telemetry_sample_20261014',
    ]);
  });
});

describe('isExpired', () => {
  const now = at('2026-10-14T10:00:00.000Z');

  it('keeps the last N whole days and today, with a retention of 7', () => {
    expect(isExpired(at('2026-10-06T00:00:00.000Z'), now, 7)).toBe(true);
    expect(isExpired(at('2026-10-07T00:00:00.000Z'), now, 7)).toBe(false);
    expect(isExpired(at('2026-10-13T00:00:00.000Z'), now, 7)).toBe(false);
  });

  it('never expires today or a day ahead', () => {
    expect(isExpired(at('2026-10-14T00:00:00.000Z'), now, 1)).toBe(false);
    expect(isExpired(at('2026-10-15T00:00:00.000Z'), now, 1)).toBe(false);
  });

  it('keeps yesterday and drops the day before, with a retention of 1', () => {
    expect(isExpired(at('2026-10-13T00:00:00.000Z'), now, 1)).toBe(false);
    expect(isExpired(at('2026-10-12T00:00:00.000Z'), now, 1)).toBe(true);
  });

  it('moves at UTC midnight, not at 24 hours from the partition', () => {
    const day = at('2026-10-13T00:00:00.000Z');

    expect(isExpired(day, at('2026-10-14T23:59:59.999Z'), 1)).toBe(false);
    expect(isExpired(day, at('2026-10-15T00:00:00.000Z'), 1)).toBe(true);
  });

  it('decides by the day of the partition, whatever instant of it is passed', () => {
    expect(isExpired(at('2026-10-06T23:59:59.999Z'), now, 7)).toBe(true);
    expect(isExpired(at('2026-10-07T23:59:59.999Z'), now, 7)).toBe(false);
  });
});
