// Compose web-dev entrypoint. Keep the successful install marker inside its dependency volume.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { constants } from 'node:os';

const marker = 'node_modules/.web-dev-install.json';
const installedLock = 'node_modules/.package-lock.json';
const hash = value => createHash('sha256').update(value).digest('hex');
const fileHash = path => hash(readFileSync(path));
let child;
let stoppingSignal;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stoppingSignal = signal;
    if (child?.pid) {
      try { process.kill(-child.pid, signal); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  });
}

function npm(args, mode = 'inherit') {
  if (stoppingSignal) throw new Error('Startup stopped');
  return new Promise((resolve, reject) => {
    let stdout = '';
    child = spawn('npm', args, {
      detached: true,
      stdio: mode === 'capture' ? ['ignore', 'pipe', 'inherit'] : mode,
    });
    child.stdout?.on('data', data => { stdout += data; });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      child = undefined;
      resolve({ code: code ?? 128 + (constants.signals[signal] ?? 0), stdout });
    });
  });
}

async function main() {
  const version = await npm(['--version'], 'capture');
  if (version.code !== 0) return version.code;
  const inputs = hash(JSON.stringify({
    schema: 1,
    package: fileHash('package.json'),
    lock: fileHash('package-lock.json'),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    npm: version.stdout.trim(),
  }));
  let matches = false;
  try {
    const saved = JSON.parse(readFileSync(marker, 'utf8'));
    matches = saved.inputs === inputs && saved.installedLock === fileHash(installedLock);
  } catch { /* Missing, incomplete, or stale volume: install below. */ }
  const validTree = async () => (await npm(['ls', '--all', '--parseable'], 'ignore')).code === 0;
  if (!matches || !await validTree()) {
    rmSync(marker, { force: true });
    console.log('web-dev: installing dependencies (npm ci)');
    const installed = await npm(['ci']);
    if (installed.code !== 0) return installed.code;
    if (!await validTree()) throw new Error('Dependency tree is invalid after npm ci');
    writeFileSync(marker, JSON.stringify({ inputs, installedLock: fileHash(installedLock) }) + '\n');
  } else {
    console.log('web-dev: dependencies unchanged; skipping npm ci');
  }
  return (await npm(['run', 'start:docker'])).code;
}

try {
  process.exitCode = await main();
} catch (error) {
  if (!stoppingSignal) console.error(`web-dev: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (stoppingSignal) process.exitCode = 128 + constants.signals[stoppingSignal];
}
