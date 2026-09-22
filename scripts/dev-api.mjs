#!/usr/bin/env node
/**
 * Start the FastAPI backend with the repository's virtual environment.
 *
 * Cross-platform replacement for a shell one-liner: it locates the venv Python
 * (`.venv/Scripts/python.exe` on Windows, `.venv/bin/python` elsewhere), fails
 * with an actionable message when the environment is missing, and forwards the
 * exit code.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const apiDir = join(repoRoot, 'apps', 'api');

const candidates = [
  join(repoRoot, '.venv', 'Scripts', 'python.exe'),
  join(repoRoot, '.venv', 'bin', 'python'),
  process.env.PYTHON,
].filter(Boolean);

const python = candidates.find((candidate) => candidate && existsSync(candidate));

if (!python) {
  console.error(
    [
      'No virtual environment found.',
      '',
      'Create one and install the API dependencies first:',
      '  uv venv --python 3.12 .venv',
      '  uv pip install --python .venv/Scripts/python.exe -r apps/api/requirements-dev.txt',
      '',
      'Or run: npm run bootstrap',
    ].join('\n'),
  );
  process.exit(1);
}

const host = process.env.SIGHTRAIL_HOST ?? '127.0.0.1';
const port = process.env.SIGHTRAIL_PORT ?? '8000';
// Reload is on by default in development, because the docs, the UI and every
// contributor expect editing a Python file to take effect immediately. Set
// SIGHTRAIL_RELOAD=0 to disable it (useful when profiling startup).
const reload = process.env.SIGHTRAIL_RELOAD !== '0';

const args = ['-m', 'uvicorn', 'sightrail.main:app', '--host', host, '--port', port, '--log-level', 'info'];
if (reload) args.push('--reload');

console.log(`[api] ${python} -m uvicorn … (${host}:${port}${reload ? ', reload' : ''})`);

const child = spawn(python, args, { cwd: apiDir, stdio: 'inherit', env: process.env });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
