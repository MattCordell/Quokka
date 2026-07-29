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
  anchor.click();
  URL.revokeObjectURL(url);
}
