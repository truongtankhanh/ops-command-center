/*
 * The one place the console writes a file (V3-24.2): the incident table's Export CSV (V3-24.6) is its first caller. The
 * file is built in the browser and never leaves it; there is no server call.
 *
 * No `try/catch`: `Blob`, `URL.createObjectURL` and `click()` do not throw in a supported browser, and swallowing a
 * failure would leave the export button doing nothing with no sign of why.
 */

/** Saves `text` as `filename` through a temporary `a[download]`; `type` is the file's MIME type. */
export function downloadText(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  // Attached for the click: older Firefox ignores a click on a detached anchor.
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked on the next task, not at once: Safari, and Firefox in some versions, drop a download whose blob URL is
  // revoked in the same task as the click.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
