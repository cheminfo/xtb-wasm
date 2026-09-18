import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Read one fixture file as text.
 *
 * Molecule files are ASCII, and the loaders take text because that is what
 * `File.text()` hands them in the browser.
 * @param name - File name inside `__tests__/data`.
 * @returns The file contents.
 */
export function readFixture(name: string): string {
  return readFileSync(join(import.meta.dirname, 'data', name), 'utf8');
}
