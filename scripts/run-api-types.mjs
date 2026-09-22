#!/usr/bin/env node
/**
 * Run mypy against the API package using the repository virtual environment.
 *
 * Separate from `run-api-lint.mjs` so CI can run them as distinct steps (a type
 * error and a lint error deserve different failure messages) and so
 * `npm run typecheck:api` mirrors `npm run lint:api`.
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

const result = spawnSync(python, ['-m', 'mypy', ...process.argv.slice(2)], {
  cwd: apiDir,
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
