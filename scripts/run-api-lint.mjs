#!/usr/bin/env node
/**
 * Run ruff (lint + format check) and mypy against the API package.
 *
 * Kept as a script so `npm run lint:api` works from any shell without activating
 * the virtual environment, and so Windows (`.venv/Scripts`) and POSIX
 * (`.venv/bin`) need no duplication in package.json.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const apiDir = join(repoRoot, 'apps', 'api');

const python = [
  join(repoRoot, '.venv', 'Scripts', 'python.exe'),
  join(repoRoot, '.venv', 'bin', 'python'),
  process.env.PYTHON,
]
  .filter(Boolean)
  .find((candidate) => candidate && existsSync(candidate));

if (!python) {
  console.error('No virtual environment found. Run `npm run bootstrap` first.');
  process.exit(1);
}

const steps = [
  { label: 'ruff format --check', args: ['-m', 'ruff', 'format', '--check', '--diff', 'sightrail', 'tests'] },
  { label: 'ruff check', args: ['-m', 'ruff', 'check', 'sightrail', 'tests'] },
  { label: 'mypy', args: ['-m', 'mypy'] },
];

let failed = false;
for (const step of steps) {
  console.log(`\n▸ ${step.label}`);
  const result = spawnSync(python, step.args, { cwd: apiDir, stdio: 'inherit', env: process.env });
  if (result.status !== 0) failed = true;
}

if (failed) {
  console.error('\n✗ API lint/type checks failed.');
  process.exit(1);
}
console.log('\n✓ API lint and type checks passed.');
