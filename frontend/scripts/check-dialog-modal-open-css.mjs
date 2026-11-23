#!/usr/bin/env node
/** Guard: styles.css keeps dialog.modal-backdrop[open] flex centering (#138). */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const styles = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/styles.css'), 'utf8');
const ok =
  /dialog\.modal-backdrop\[open\]\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*padding:\s*24px/s.test(
    styles,
  );
if (!ok) {
  console.error(
    'styles.css missing dialog.modal-backdrop[open] { display:flex; align-items:center; justify-content:center; padding:24px }',
  );
  process.exit(1);
}
console.log('ok: dialog.modal-backdrop[open] flex contract');
