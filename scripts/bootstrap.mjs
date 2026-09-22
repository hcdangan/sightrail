#!/usr/bin/env node
/**
 * One-shot developer bootstrap.
 *
 * Creates the Python virtual environment (via `uv` when available), installs the
 * API requirements, and installs the frontend workspace dependencies. Safe to
 * re-run: every step is idempotent.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const venvDir = join(repoRoot, '.venv');
const isWindows = process.platform === 'win32';
const venvPython = isWindows ? join(venvDir, 'Scripts', 'python.exe') : join(venvDir, 'bin', 'python');

const log = (message) => console.log(`\n\u001b[36m▸ ${message}\u001b[0m`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: repoRoot, shell: isWindows, ...options });
  if (result.status !== 0) {
    console.error(`\n\u001b[31m✗ ${command} ${args.join(' ')} failed with exit code ${result.status}\u001b[0m`);
    process.exit(result.status ?? 1);
  }
}

const hasUv = spawnSync('uv', ['--version'], { stdio: 'ignore', shell: isWindows }).status === 0;

log('Checking for the Python virtual environment');
if (!existsSync(venvPython)) {
  if (hasUv) {
    log('Creating .venv with uv (Python 3.12)');
    run('uv', ['python', 'install', '3.12']);
    run('uv', ['venv', '--python', '3.12', '.venv']);
  } else {
    log('Creating .venv with the system Python');
    run(isWindows ? 'python' : 'python3', ['-m', 'venv', '.venv']);
  }
} else {
  console.log('  .venv already present');
}

log('Installing API dependencies');
if (hasUv) {
  run('uv', ['pip', 'install', '--python', venvPython, '-r', 'apps/api/requirements-dev.txt']);
} else {
  run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);
  run(venvPython, ['-m', 'pip', 'install', '-r', 'apps/api/requirements-dev.txt']);
}

log('Installing frontend dependencies');
run(isWindows ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund']);

log('Warming the default checkpoint (optional, skipped on failure)');
spawnSync(venvPython, ['-c', 'from ultralytics import YOLO; YOLO("yolo11n.pt")'], {
  stdio: 'inherit',
  cwd: join(repoRoot, 'apps', 'api'),
});

console.log(
  [
    '',
    '\u001b[32m✓ Bootstrap complete\u001b[0m',
    '',
    'Start the stack:',
    '  npm run dev          # API on :8000 + Vite on :5173',
    '',
    'Or run them separately:',
    '  npm run dev:api',
    '  npm run dev:web',
    '',
  ].join('\n'),
);
