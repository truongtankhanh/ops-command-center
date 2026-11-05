import type { Mock } from 'vitest';
import { downloadText } from './download';

/*
 * jsdom has no `URL.createObjectURL` / `revokeObjectURL`, and a click on an `a[href]` would try a navigation it does not
 * implement. Both URL methods are defined for each case and put back as they were after it, and the anchor's `click` is
 * spied on and records what the browser would have seen at that moment.
 */

const OBJECT_URL = 'blob:test';

interface Clicked {
  readonly href: string | null;
  readonly download: string;
  readonly attached: boolean;
}

let createObjectURL: Mock<(blob: Blob) => string>;
let revokeObjectURL: Mock<(url: string) => void>;
let clicks: Clicked[];

type UrlMethod = 'createObjectURL' | 'revokeObjectURL';

// Kept so `afterEach` puts back exactly what was there (nothing, in today's jsdom).
const original: Record<UrlMethod, PropertyDescriptor | undefined> = {
  createObjectURL: Object.getOwnPropertyDescriptor(URL, 'createObjectURL'),
  revokeObjectURL: Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL'),
};

function defineOnUrl(name: UrlMethod, value: unknown): void {
  Object.defineProperty(URL, name, { configurable: true, writable: true, value });
}

function restoreOnUrl(name: UrlMethod): void {
  const descriptor = original[name];
  if (descriptor) Object.defineProperty(URL, name, descriptor);
  else Reflect.deleteProperty(URL, name);
}

/** jsdom's `Blob` read back through jsdom's `FileReader`, which knows it. */
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(blob);
  });
}

/** The one `Blob` handed to `createObjectURL`. */
function createdBlob(): Blob {
  expect(createObjectURL).toHaveBeenCalledTimes(1);
  const blob = createObjectURL.mock.calls[0]?.[0];
  expect(blob).toBeInstanceOf(Blob);
  return blob as Blob;
}

beforeEach(() => {
  vi.useFakeTimers();
  createObjectURL = vi.fn<(blob: Blob) => string>(() => OBJECT_URL);
  revokeObjectURL = vi.fn<(url: string) => void>();
  defineOnUrl('createObjectURL', createObjectURL);
  defineOnUrl('revokeObjectURL', revokeObjectURL);
  clicks = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicks.push({
      href: this.getAttribute('href'),
      download: this.download,
      attached: this.isConnected,
    });
  });
});

afterEach(() => {
  // Any revoke still pending runs while the stubs exist, so it never fires against a missing method. The Blob case has
  // already flushed it and gone back to real timers to read the Blob.
  if (vi.isFakeTimers()) {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  }
  vi.restoreAllMocks();
  restoreOnUrl('createObjectURL');
  restoreOnUrl('revokeObjectURL');
});

describe('downloadText', () => {
  it('builds one Blob of the given type holding the text', async () => {
    const text = 'Code,Title\r\nINC-1,Rò rỉ nước\r\n';
    downloadText('incidents.csv', text, 'text/csv;charset=utf-8');

    const blob = createdBlob();
    expect(blob.type).toBe('text/csv;charset=utf-8');
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    await expect(readBlob(blob)).resolves.toBe(text);
  });

  it('clicks one anchor carrying the filename and the object URL, attached at the click', () => {
    downloadText('incidents-20261021-1542.csv', 'x', 'text/csv');

    expect(clicks).toEqual([
      { href: OBJECT_URL, download: 'incidents-20261021-1542.csv', attached: true },
    ]);
  });

  it('leaves no anchor in the document', () => {
    downloadText('incidents.csv', 'x', 'text/csv');

    expect(document.body.querySelector('a')).toBeNull();
  });

  it('revokes the URL once, on the next task and not at the click', () => {
    downloadText('incidents.csv', 'x', 'text/csv');
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL);
  });
});
