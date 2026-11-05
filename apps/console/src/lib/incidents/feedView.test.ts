import type { DisplayMode } from '../shell/useDisplayMode';
import {
  effectiveFeedView,
  readFeedView,
  readTableSort,
  writeFeedView,
  writeTableSort,
} from './feedView';
import { TABLE_COLUMNS } from './incidentTable';

const VIEW_KEY = 'occ.console.feedView';
const SORT_KEY = 'occ.console.tableSort';

beforeEach(() => localStorage.clear());

afterEach(() => vi.restoreAllMocks());

describe('the remembered view', () => {
  it('is the list in a fresh browser', () => {
    expect(readFeedView()).toBe('list');
  });

  it('reads back the table, stored as "table"', () => {
    writeFeedView('table');

    expect(readFeedView()).toBe('table');
    expect(localStorage.getItem(VIEW_KEY)).toBe('table');
  });

  it('forgets the choice when the list is chosen again', () => {
    writeFeedView('table');
    writeFeedView('list');

    expect(readFeedView()).toBe('list');
    expect(localStorage.getItem(VIEW_KEY)).toBeNull();
  });

  it.each(['list', 'TABLE', 'grid', ''])('reads %j as the list', (stored) => {
    localStorage.setItem(VIEW_KEY, stored);

    expect(readFeedView()).toBe('list');
  });
});

describe('the remembered sort', () => {
  it('is no sort (the feed order) in a fresh browser', () => {
    expect(readTableSort()).toBeNull();
  });

  it.each(
    TABLE_COLUMNS.flatMap((column) =>
      (['ascending', 'descending'] as const).map((direction) => ({ key: column.key, direction })),
    ),
  )('reads back $key $direction', (sort) => {
    writeTableSort(sort);

    expect(readTableSort()).toEqual(sort);
    expect(JSON.parse(localStorage.getItem(SORT_KEY) ?? 'null')).toEqual(sort);
  });

  it('forgets the sort when it goes back to the feed order', () => {
    writeTableSort({ key: 'raised', direction: 'descending' });
    writeTableSort(null);

    expect(readTableSort()).toBeNull();
    expect(localStorage.getItem(SORT_KEY)).toBeNull();
  });

  it.each([
    ['text that is not JSON', 'severity'],
    ['null', 'null'],
    ['an array', '["severity","descending"]'],
    ['a number', '42'],
    ['no key', '{"direction":"ascending"}'],
    ['a key no column has', '{"key":"sla","direction":"ascending"}'],
    ['a numeric key', '{"key":3,"direction":"ascending"}'],
    ['no direction', '{"key":"severity"}'],
    ['an unknown direction', '{"key":"severity","direction":"up"}'],
  ])('reads %s as no sort, and leaves it stored', (_, stored) => {
    localStorage.setItem(SORT_KEY, stored);

    expect(readTableSort()).toBeNull();
    expect(localStorage.getItem(SORT_KEY)).toBe(stored);
  });

  it('drops stored fields it does not know', () => {
    localStorage.setItem(SORT_KEY, '{"key":"code","direction":"ascending","pinned":true}');

    expect(readTableSort()).toEqual({ key: 'code', direction: 'ascending' });
  });

  it('stores only the key and the direction', () => {
    // A wider object, as a caller could hold one: only the two fields reach storage.
    const wider = { key: 'place', direction: 'ascending', extra: 1 } as const;
    writeTableSort(wider);

    expect(localStorage.getItem(SORT_KEY)).toBe('{"key":"place","direction":"ascending"}');
  });
});

describe('blocked storage', () => {
  beforeEach(() => {
    const blocked = () => {
      throw new Error('Storage is disabled');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked);
  });

  it('reads the defaults', () => {
    expect(readFeedView()).toBe('list');
    expect(readTableSort()).toBeNull();
  });

  it('does not throw on a write', () => {
    expect(() => writeFeedView('table')).not.toThrow();
    expect(() => writeFeedView('list')).not.toThrow();
    expect(() => writeTableSort({ key: 'severity', direction: 'descending' })).not.toThrow();
    expect(() => writeTableSort(null)).not.toThrow();
  });
});

describe('effectiveFeedView', () => {
  it('is the list on a phone, whatever is chosen', () => {
    expect(effectiveFeedView('table', 'phone')).toBe('list');
    expect(effectiveFeedView('list', 'phone')).toBe('list');
  });

  it.each<DisplayMode>(['tablet', 'laptop', 'wall', 'wall-4k'])(
    'is the chosen view on a %s',
    (mode) => {
      expect(effectiveFeedView('table', mode)).toBe('table');
      expect(effectiveFeedView('list', mode)).toBe('list');
    },
  );
});
