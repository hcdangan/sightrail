/**
 * Licensing tests.
 *
 * The project's license is not a matter of taste: `ultralytics` is AGPL-3.0 and
 * is imported in-process, so the combined work must be AGPL-3.0. These tests pin
 * two things a well-meaning edit could break:
 *
 * 1. Every manifest declares the same license the UI displays.
 * 2. The UI actually offers the Corresponding Source, which is what AGPL §13
 *    obliges a network deployment to do.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { REFERENCE_LINKS } from './help-content';
import { LICENSE_ID, LICENSE_NAME, LICENSE_URL, SOURCE_URL, THIRD_PARTY_NOTICES_PATH } from './licensing';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (path: string) => readFileSync(resolve(repoRoot, path), 'utf8');

describe('license identifiers agree across the repository', () => {
  it('matches the npm manifests', () => {
    expect(JSON.parse(read('package.json')).license).toBe(LICENSE_ID);
    expect(JSON.parse(read('apps/web/package.json')).license).toBe(LICENSE_ID);
  });

  it('matches the Python manifest', () => {
    expect(read('apps/api/pyproject.toml')).toContain(`license = { text = "${LICENSE_ID}" }`);
  });

  it('ships the full license text under the expected name', () => {
    const license = read('LICENSE');
    // The AGPL is long; a truncated or placeholder file is the failure mode.
    expect(license.length).toBeGreaterThan(30_000);
    expect(license).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
    expect(license).toContain('Version 3, 19 November 2007');
  });

  it('points at the canonical license text and the project source', () => {
    expect(LICENSE_URL).toBe('https://www.gnu.org/licenses/agpl-3.0.html');
    expect(SOURCE_URL).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+$/);
    expect(LICENSE_NAME.toLowerCase()).toContain('affero');
  });
});

describe('the UI offers the Corresponding Source (AGPL §13)', () => {
  it('links the source from the reference list', () => {
    const link = REFERENCE_LINKS.find((entry) => entry.href === SOURCE_URL);
    expect(link, 'Help must offer the source, not just name the license').toBeDefined();
    expect(link?.note.toLowerCase()).toContain('source');
  });

  it('links the license text from the reference list', () => {
    expect(REFERENCE_LINKS.some((entry) => entry.href === LICENSE_URL)).toBe(true);
  });

  it('lists the third-party notices as a repository document', () => {
    // The Help page asserts every REPO_DOCS entry exists; keep the path honest.
    expect(THIRD_PARTY_NOTICES_PATH).toBe('THIRD-PARTY-NOTICES.md');
    expect(read(THIRD_PARTY_NOTICES_PATH)).toContain('AGPL');
  });

  it('renders the source link in the sidebar', () => {
    const sidebar = read('apps/web/src/components/layout/Sidebar.tsx');
    expect(sidebar).toContain('SOURCE_URL');
    expect(sidebar).toContain('AGPL §13');
  });
});
