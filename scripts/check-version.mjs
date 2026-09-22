#!/usr/bin/env node
/**
 * Assert that the version declared in every manifest agrees, and that the API
 * reports the same value.
 *
 * The version lived in four places (root package.json, the web workspace
 * manifest, the Python package and pyproject.toml) plus the CHANGELOG heading,
 * and they drifted. This script is the single source of truth check: CI runs it,
 * and `npm run version:check` runs it locally.
 *
 * Usage:
 *   node scripts/check-version.mjs            # compare manifests only
 *   node scripts/check-version.mjs --api URL  # also compare /api/health
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const readJson = (path) => JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8'));
const readText = (path) => readFileSync(resolve(repoRoot, path), 'utf8');

const rootPackage = readJson('package.json');
const webPackage = readJson('apps/web/package.json');

/** The version the project claims, taken from the root manifest. */
const expected = rootPackage.version;

const pythonInit = readText('apps/api/sightrail/__init__.py');
const pythonVersion = /__version__\s*=\s*"([^"]+)"/.exec(pythonInit)?.[1];
const pyproject = readText('apps/api/pyproject.toml');
const pyprojectVersion = /^version\s*=\s*"([^"]+)"/m.exec(pyproject)?.[1];
const changelog = readText('CHANGELOG.md');

const checks = [
  { name: 'package.json (root)', actual: expected },
  { name: 'apps/web/package.json', actual: webPackage.version },
  { name: 'sightrail/__init__.py', actual: pythonVersion },
  { name: 'apps/api/pyproject.toml', actual: pyprojectVersion },
];

const failures = [];

for (const check of checks) {
  if (check.actual !== expected) {
    failures.push(`${check.name} says "${check.actual}", expected "${expected}"`);
  }
}

// The API version is the one users see in /api/health and in the UI footer, so it
// must be a *released* version rather than an "Unreleased" placeholder.
const released = new RegExp(`^## \\[${expected.replace(/\./g, '\\.')}\\]`, 'm').test(changelog);
if (!released) {
  failures.push(`CHANGELOG.md has no "## [${expected}]" section for the declared version`);
}

const apiUrl = process.argv.includes('--api')
  ? process.argv[process.argv.indexOf('--api') + 1]
  : process.env.VERSION_CHECK_API_URL;

if (apiUrl) {
  try {
    const response = await fetch(new URL('/api/health', apiUrl));
    const body = await response.json();
    checks.push({ name: `${apiUrl}/api/health`, actual: body.version });
    if (body.version !== expected) {
      failures.push(`the running API reports "${body.version}", expected "${expected}"`);
    }
  } catch (error) {
    failures.push(`could not reach ${apiUrl}/api/health: ${error.message}`);
  }
}

if (failures.length > 0) {
  console.error(`\n✗ Version mismatch (expected ${expected} everywhere)\n`);
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error('\n  Update every manifest, and add a CHANGELOG section for the new version.');
  process.exit(1);
}

console.log(`✓ version ${expected} agrees across ${checks.length} source(s)`);
for (const check of checks) console.log(`    ${check.name}`);
