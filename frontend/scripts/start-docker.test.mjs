import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';

const script = resolve(import.meta.dirname, 'start-docker.mjs');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'web-dev-start-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'package.json'), '{}');
  writeFileSync(join(root, 'package-lock.json'), '{}');
  writeFileSync(join(root, 'bin/npm'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync('calls', args.join(' ') + '\\n');
if (args[0] === '--version') { console.log(process.env.NPM_VERSION || '11.0.0'); }
else if (args[0] === 'ls') { process.exit(fs.existsSync('node_modules/healthy') && !process.env.BAD_TREE ? 0 : 1); }
else if (args[0] === 'ci') {
  fs.rmSync('node_modules', { recursive: true, force: true });
  fs.mkdirSync('node_modules');
  if (process.env.FAIL_CI) process.exit(7);
  if (process.env.HOLD_CI) {
    console.log('READY');
    process.on('SIGTERM', () => { fs.writeFileSync('signal', 'SIGTERM'); process.exit(0); });
    setInterval(() => {}, 1000);
  } else {
    fs.writeFileSync('node_modules/healthy', 'ok');
    fs.writeFileSync('node_modules/.package-lock.json', '{}');
  }
} else if (args[0] === 'run') {
  if (process.env.HOLD_SERVER) {
    console.log('READY');
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { fs.writeFileSync('signal', signal); process.exit(0); });
    setInterval(() => {}, 1000);
  } else process.exit(Number(process.env.SERVER_EXIT || 0));
} else process.exit(9);
`, { mode: 0o755 });
  const env = { ...process.env, PATH: join(root, 'bin') + ':' + process.env.PATH };
  const calls = () => readFileSync(join(root, 'calls'), 'utf8').trim().split('\n');
  return { root, env, calls, stamp: join(root, 'node_modules/.web-dev-install.json'),
    run: (extra = {}) => spawnSync(process.execPath, [script], { cwd: root, env: { ...env, ...extra }, encoding: 'utf8', timeout: 5000 }) };
}

test('first start installs; unchanged restart preserves dependencies and skips ci', t => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  assert.equal(f.run().status, 0);
  assert.equal(f.calls().filter(x => x === 'ci').length, 1);
  assert.equal(f.calls().filter(x => x === 'run start:docker').length, 2);
});

for (const change of ['package.json', 'package-lock.json', 'hidden-lock', 'broken-stamp', 'runtime-key', 'missing-dependency', 'npm-version']) {
  test(`reinstalls after ${change}`, t => {
    const f = fixture(t);
    assert.equal(f.run().status, 0);
    if (change === 'hidden-lock') writeFileSync(join(f.root, 'node_modules/.package-lock.json'), '{"changed":true}');
    else if (change === 'broken-stamp') writeFileSync(f.stamp, 'broken');
    else if (change === 'runtime-key') writeFileSync(f.stamp, '{"inputs":"other","installedLock":"other"}');
    else if (change === 'missing-dependency') rmSync(join(f.root, 'node_modules/healthy'));
    else if (change !== 'npm-version') writeFileSync(join(f.root, change), '{"changed":true}');
    assert.equal(f.run(change === 'npm-version' ? { NPM_VERSION: '12.0.0' } : {}).status, 0);
    assert.equal(f.calls().filter(x => x === 'ci').length, 2);
  });
}

test('failed install removes prior success marker and never starts the server', t => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  writeFileSync(join(f.root, 'package-lock.json'), '{"changed":true}');
  assert.equal(f.run({ FAIL_CI: '1' }).status, 7);
  assert.equal(existsSync(f.stamp), false);
  assert.equal(f.calls().filter(x => x === 'run start:docker').length, 1);
});

test('a still-invalid tree after ci never gains a success marker or starts server', t => {
  const f = fixture(t);
  assert.notEqual(f.run({ BAD_TREE: '1' }).status, 0);
  assert.equal(existsSync(f.stamp), false);
  assert.equal(f.calls().includes('run start:docker'), false);
});

test('propagates server exit status', t => {
  const f = fixture(t);
  assert.equal(f.run({ SERVER_EXIT: '6' }).status, 6);
});

for (const [phase, signal, code] of [['HOLD_CI', 'SIGTERM', 143], ['HOLD_SERVER', 'SIGTERM', 143], ['HOLD_SERVER', 'SIGINT', 130]]) {
  test(`forwards ${signal} during ${phase} and stops subsequent work`, async t => {
    const f = fixture(t);
    const child = spawn(process.execPath, [script], { cwd: f.root, env: { ...f.env, [phase]: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => child.kill('SIGKILL'));
    const exited = once(child, 'exit');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    t.after(() => clearTimeout(timer));
    await new Promise((resolveReady, reject) => {
      let output = '';
      child.stdout.on('data', data => { output += data; if (output.includes('READY')) resolveReady(); });
      child.once('exit', () => reject(new Error('exited before ready')));
    });
    child.kill(signal);
    assert.equal((await exited)[0], code);
    assert.equal(readFileSync(join(f.root, 'signal'), 'utf8'), signal);
    if (phase === 'HOLD_CI') {
      assert.equal(existsSync(f.stamp), false);
      assert.equal(f.calls().includes('run start:docker'), false);
    }
  });
}
