#!/usr/bin/env node
/**
 * Report the license of every component Sightrail actually depends on, and fail
 * if an AGPL-3.0-incompatible license shows up anywhere in the distribution.
 *
 * `THIRD-PARTY-NOTICES.md` documents the licensing position. Documentation rots,
 * so this script regenerates the numbers behind it:
 *
 *   - the web client's *production* closure, resolved from package-lock.json
 *     (dev dependencies are deliberately excluded — they are not distributed);
 *   - the API's *runtime* closure, resolved from the installed distributions via
 *     importlib.metadata, starting at the dependencies declared in pyproject.toml.
 *
 * The exit code is the point: CI runs this so that a dependency bump cannot
 * quietly introduce a GPL/SSPL/BUSL component. Three outcomes are distinguished:
 *
 *   ✗ fails the run — GPL without the Affero clause, SSPL, BUSL, Elastic License.
 *   ⚠ noted only    — LGPL/MPL/EPL/CDDL, which are file-level copyleft and
 *                     compatible with AGPL-3.0, but should be recorded by hand.
 *   • expected      — the Ultralytics packages, which are AGPL-3.0 and are
 *                     precisely why this project is AGPL-3.0.
 *
 * Usage:
 *   node scripts/license-report.mjs            # report + check
 *   node scripts/license-report.mjs --json     # machine-readable
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

// ---------------------------------------------------------------------------
// Web client: production closure from the lockfile
// ---------------------------------------------------------------------------

function webProductionClosure() {
  const lockPath = join(repoRoot, 'package-lock.json');
  if (!existsSync(lockPath)) {
    throw new Error('package-lock.json not found — run `npm install` first.');
  }
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const packages = lock.packages;

  const workspaceRoots = Object.keys(packages).filter((key) => /apps[\\/]web$/.test(key));
  if (workspaceRoots.length === 0) {
    throw new Error('no apps/web workspace entry in package-lock.json');
  }

  // Lockfile keys are nesting-aware (`node_modules/a/node_modules/b`), so a bare
  // name can map to several keys; resolve like Node does, by walking up.
  const resolveKey = (name, fromKey) => {
    const parts = fromKey.split('/');
    while (parts.length > 0) {
      const candidate = [...parts, 'node_modules', name].join('/');
      if (packages[candidate]) return candidate;
      parts.pop();
    }
    const top = `node_modules/${name}`;
    return packages[top] ? top : null;
  };

  const seen = new Set();
  const queue = [];
  for (const root of workspaceRoots) {
    for (const dep of Object.keys(packages[root].dependencies ?? {})) queue.push([dep, root]);
  }
  while (queue.length > 0) {
    const [name, fromKey] = queue.shift();
    const key = resolveKey(name, fromKey);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const meta = packages[key];
    for (const dep of Object.keys(meta.dependencies ?? {})) queue.push([dep, key]);
    for (const dep of Object.keys(meta.optionalDependencies ?? {})) queue.push([dep, key]);
  }

  return [...seen]
    .map((key) => ({
      name: key.replace(/^.*node_modules\//, ''),
      version: packages[key].version ?? '?',
      license: packages[key].license ?? '(none)',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// API: runtime closure from the installed distributions
// ---------------------------------------------------------------------------

const PYTHON_PROGRAM = String.raw`
import json, re, sys, tomllib
from importlib.metadata import distributions

try:
    from packaging.requirements import Requirement
except ImportError:  # pragma: no cover - packaging ships with pip/uv, but do not hard-fail
    Requirement = None


def norm(name):
    return re.sub(r"[-_.]+", "-", name).lower()


by_name = {}
for dist in distributions():
    raw = dist.metadata["Name"]
    if raw:
        by_name[norm(raw)] = dist

with open(sys.argv[1], "rb") as handle:
    pyproject = tomllib.load(handle)

roots = [norm(re.split(r"[<>=!\[; ]", req.strip())[0]) for req in pyproject["project"]["dependencies"]]


def installed_requirements(name):
    """Requirements of an installed distribution that apply to *this* platform.

    Environment markers are evaluated rather than ignored, so a Linux-only or
    python_version-gated dependency is not reported as missing on Windows.
    """
    dist = by_name.get(name)
    if dist is None:
        return []
    out = []
    for raw in dist.requires or []:
        if Requirement is not None:
            try:
                requirement = Requirement(raw)
                # An 'extra == "..."' marker evaluates to False here, which is
                # what we want for a plain install.
                if requirement.marker is not None and not requirement.marker.evaluate():
                    continue
                out.append(norm(requirement.name))
                continue
            except Exception:
                pass
        base = raw.split(";")[0].strip()
        match = re.match(r"([A-Za-z0-9._-]+)", base)
        if match:
            out.append(norm(match.group(1)))
    return out


seen, queue = set(), list(roots)
missing = []
while queue:
    name = queue.pop()
    if name in seen:
        continue
    seen.add(name)
    if name not in by_name:
        missing.append(name)
        continue
    queue.extend(installed_requirements(name))


# Distribution metadata is inconsistent; collapse the common spellings so the
# summary table is readable instead of listing five flavours of "BSD License".
CANONICAL = {
    "mit license": "MIT",
    "mit": "MIT",
    "bsd license": "BSD-3-Clause",
    "bsd": "BSD-3-Clause",
    "apache software license": "Apache-2.0",
    "apache-2.0": "Apache-2.0",
    "python software foundation license": "PSF-2.0",
    "psf-2.0": "PSF-2.0",
    "gnu affero general public license v3 or later (agplv3+)": "AGPL-3.0-or-later",
    "agpl-3.0-only": "AGPL-3.0-only",
    "mozilla public license 2.0 (mpl 2.0)": "MPL-2.0",
}


def license_of(dist):
    meta = dist.metadata
    expression = (meta.get("License-Expression") or "").strip()
    if expression:
        return CANONICAL.get(expression.lower(), expression)
    classifiers = [
        value for key, value in meta.items() if key == "Classifier" and value.startswith("License ::")
    ]
    if classifiers:
        labels = [value.split("::")[-1].strip() for value in classifiers]
        return " / ".join(CANONICAL.get(label.lower(), label) for label in labels)
    declared = (meta.get("License") or "").strip()
    if not declared:
        return "(declared in package files)"
    if "\n" in declared or len(declared) > 60:
        # Most projects dump the whole license text into this field.
        return "(full text in metadata)"
    return CANONICAL.get(declared.lower(), declared)


report = [
    {"name": name, "version": by_name[name].version, "license": license_of(by_name[name])}
    for name in sorted(seen)
    if name in by_name
]

print(json.dumps({"packages": report, "missing": sorted(missing)}))
`;

function apiRuntimeClosure() {
  const python = [
    join(repoRoot, '.venv', 'Scripts', 'python.exe'),
    join(repoRoot, '.venv', 'bin', 'python'),
    process.env.PYTHON,
  ].find((candidate) => candidate && existsSync(candidate));

  if (!python) {
    return { skipped: 'no virtual environment found — run `npm run bootstrap`' };
  }

  const pyprojectPath = join(repoRoot, 'apps', 'api', 'pyproject.toml');
  const result = spawnSync(python, ['-c', PYTHON_PROGRAM, pyprojectPath], {
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) {
    return { skipped: `python probe failed: ${(result.stderr || '').trim().split('\n').pop()}` };
  }
  const parsed = JSON.parse(result.stdout);
  return { packages: parsed.packages, missing: parsed.missing };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * Copyleft is not one thing. AGPL is this project's own license; a *different*
 * AGPL component is fine (it is satisfied by the same source offer), and the
 * Ultralytics packages are the reason the project is AGPL at all.
 */
const isAgpl = (license) => /AGPL|Affero/i.test(license);
const isGplButNotAgplOrLgpl = (license) =>
  /GPL/i.test(license) && !isAgpl(license) && !/LGPL/i.test(license);
const isWeakCopyleft = (license) => /LGPL|MPL|Mozilla Public|EPL|Eclipse Public|CDDL/i.test(license);
const isNonGplRestricted = (license) =>
  /SSPL|Commons Clause|BUSL|Business Source|Elastic License/i.test(license);

/** A hard failure: incompatible with an AGPL-3.0-or-later distribution. */
const isIncompatible = (license) =>
  isGplButNotAgplOrLgpl(license) || isNonGplRestricted(license);

/** Ultralytics ships its engine as several packages, all AGPL-3.0. */
const isUltralytics = (name) => name === 'ultralytics' || name.startsWith('ultralytics-');

function distribution(packages) {
  const counts = new Map();
  for (const pkg of packages) counts.set(pkg.license, (counts.get(pkg.license) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const web = webProductionClosure();
const api = apiRuntimeClosure();

const problems = [];

console.log('\nSightrail license report');
console.log('========================\n');

console.log(`Web client production closure — ${web.length} packages`);
for (const [license, count] of distribution(web)) {
  console.log(`  ${String(count).padStart(4)}  ${license}`);
}
const webIncompatible = web.filter((pkg) => isIncompatible(pkg.license));
const webWeak = web.filter((pkg) => isWeakCopyleft(pkg.license));
for (const pkg of [...webIncompatible, ...webWeak]) {
  const line = `${pkg.name}@${pkg.version} is ${pkg.license}`;
  const fatal = isIncompatible(pkg.license);
  console.log(`  ${fatal ? '✗' : '⚠'} ${line}`);
  if (fatal) problems.push({ area: 'web', line });
  else console.log(`      file-level copyleft; compatible with AGPL-3.0 — record it in THIRD-PARTY-NOTICES.md`);
}
if (webIncompatible.length === 0 && webWeak.length === 0) {
  console.log('  ✓ no copyleft licenses at all');
}

if (api.skipped) {
  console.log(`\nAPI runtime closure — skipped (${api.skipped})`);
} else {
  console.log(`\nAPI runtime closure — ${api.packages.length} distributions`);
  for (const [license, count] of distribution(api.packages)) {
    console.log(`  ${String(count).padStart(4)}  ${license}`);
  }
  for (const pkg of api.packages.filter((item) => isIncompatible(item.license))) {
    const line = `${pkg.name}@${pkg.version} is ${pkg.license}`;
    console.log(`  ✗ ${line}`);
    problems.push({ area: 'api', line });
  }
  const apiAgpl = api.packages.filter((pkg) => isAgpl(pkg.license));
  for (const pkg of apiAgpl) {
    const line = `${pkg.name}@${pkg.version} is ${pkg.license}`;
    if (isUltralytics(pkg.name)) {
      console.log(`  • ${line}  (expected — this is why Sightrail is AGPL-3.0)`);
    } else {
      console.log(`  ⚠ ${line}`);
      console.log('      AGPL too, so the combined work stays AGPL-3.0 — record it in the notices');
    }
  }
  const apiWeak = api.packages.filter((pkg) => isWeakCopyleft(pkg.license));
  for (const pkg of apiWeak) {
    console.log(`  ⚠ ${pkg.name}@${pkg.version} is ${pkg.license}`);
    console.log('      file-level copyleft; compatible with AGPL-3.0 — record it in THIRD-PARTY-NOTICES.md');
  }
  if (api.missing && api.missing.length > 0) {
    // Requirements whose markers evaluated true but which are absent here.
    console.log(`  • not installed in this environment: ${api.missing.join(', ')}`);
  }
  if (apiAgpl.length === 0) {
    console.log('  ✗ no AGPL distribution in the closure');
    problems.push({ area: 'api', line: 'the Ultralytics engine is missing from this environment' });
  }
}

if (process.argv.includes('--json')) {
  console.log(
    `\n${JSON.stringify({ web, api: api.packages ?? null, missing: api.missing ?? null, problems }, null, 2)}`,
  );
}

if (problems.length > 0) {
  console.error('\n✗ Licensing problem:\n');
  for (const problem of problems) console.error(`  - [${problem.area}] ${problem.line}`);
  console.error('\n  An AGPL-3.0-or-later distribution cannot include these. Replace the');
  console.error('  component, or record the reasoning in THIRD-PARTY-NOTICES.md.\n');
  process.exit(1);
}

console.log('\n✓ no AGPL-3.0-incompatible components\n');
