#!/usr/bin/env node
// Usage: node scripts/with-tmp.js <bin> [args...]
// Runs a tool from node_modules/.bin with a TMPDIR that can actually be resolved.
// Jest and the CDK call realpath/lstat on os.tmpdir(). Some agent sandboxes hand
// out a TMPDIR whose parent cannot be stat'ed, which makes both tools fail with
// EPERM. In that case fall back to ./.tmp (gitignored).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const [bin, ...args] = process.argv.slice(2);
if (!bin) {
  console.error('usage: node scripts/with-tmp.js <bin> [args...]');
  process.exit(2);
}

const root = path.join(__dirname, '..');
const env = { ...process.env };
try {
  fs.realpathSync.native(os.tmpdir());
  fs.lstatSync(path.dirname(os.tmpdir()));
} catch {
  const local = path.join(root, '.tmp');
  fs.mkdirSync(local, { recursive: true });
  env.TMPDIR = local;
}
env.PATH = `${path.join(root, 'node_modules', '.bin')}${path.delimiter}${env.PATH ?? ''}`;

const result = spawnSync(bin, args, { stdio: 'inherit', env, cwd: process.cwd() });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
