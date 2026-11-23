#!/usr/bin/env node
/** Guard: styles.css keeps shared chrome + dialog.modal-backdrop[open] flex (#138). */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const styles = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/styles.css'), 'utf8');
const checks = [
  [
    'dialog.modal-backdrop[open] flex',
    /dialog\.modal-backdrop\[open\]\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*padding:\s*24px/s,
  ],
  ['.eyebrow accent chrome', /\.eyebrow\s*\{[^}]*color:\s*var\(--accent\)[^}]*letter-spacing:\s*2\.3px/s],
  [
    'board-page card-quick-actions',
    /\.board-page\s+\.task-card\s+\.card-quick-actions\s*\{[^}]*display:\s*flex/s,
  ],
  [
    'board-page copy-card-link static',
    /\.board-page\s+\.task-card\s+\.card-quick-actions\s+\.copy-card-link\s*\{[^}]*position:\s*static/s,
  ],
];
let failed = false;
for (const [name, re] of checks) {
  if (!re.test(styles)) {
    console.error(`styles.css missing contract: ${name}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log('ok: styles.css shared chrome + dialog flex contracts');
