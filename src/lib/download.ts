/**
 * Kept out of `src/lib/plan/` and `src/lib/calc/` so those stay DOM-free (ADR-0013). Not
 * unit-testable under the current `environment: 'node'` vitest config — verified manually by
 * running the app.
 */
export function downloadTextFile(
  filename: string,
  text: string,
  mimeType = 'application/json',
): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  // Firefox/Safari require the anchor to be in the document for click() to trigger a download,
  // and revoking the object URL before the download starts can abort it — so revoke on a
  // deferred tick, after the click has been dispatched, not synchronously.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
