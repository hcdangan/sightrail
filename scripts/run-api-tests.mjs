#!/usr/bin/env node
/**
 * Run the API test suite with the repository virtual environment.
 *
 * Mirrors `scripts/dev-api.mjs`: finds the venv interpreter, runs pytest from
 * `apps/api`, and forwards the exit code so CI and `npm test` behave correctly.
 */
import { spawn } from 'node:child_process';
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

const args = ['-m', 'pytest', ...process.argv.slice(2)];
const child = spawn(python, args, { cwd: apiDir, stdio: 'inherit', env: process.env });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
