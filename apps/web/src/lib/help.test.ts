/**
 * Help content tests.
 *
 * Two jobs:
 *
 * 1. Assert the in-app help is internally consistent (every route it links to
 *    exists in the navigation tree, every section is reachable, no empty copy).
 * 2. Assert the start-up commands are identical in the UI and in `README.md`,
 *    so the in-app guide cannot drift from the repository docs.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  GETTING_STARTED,
  HELP_INTRO,
  HELP_SECTIONS,
  IMPORTANT_NOTES,
  PROCESSES,
  REFERENCE_LINKS,
  REPO_DOCS,
  REQUIRED_QUICKSTART_COMMANDS,
  SHORTCUTS,
  TOUR,
  TROUBLESHOOTING,
  WORKFLOW,
} from './help-content';
import { NAV_ITEMS } from './navigation';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const readme = readFileSync(resolve(repoRoot, 'README.md'), 'utf8');
const development = readFileSync(resolve(repoRoot, 'docs/DEVELOPMENT.md'), 'utf8');

describe('help content structure', () => {
  it('has non-empty intro copy', () => {
    expect(HELP_INTRO.title.length).toBeGreaterThan(0);
    expect(HELP_INTRO.lead.length).toBeGreaterThan(40);
  });

  it('documents every required quickstart command', () => {
    const commands = GETTING_STARTED.flatMap((block) => block.lines.map((line) => line.command));
    for (const required of REQUIRED_QUICKSTART_COMMANDS) {
      expect(commands).toContain(required);
    }
  });

  it('gives every command block a title, lines and a detail string', () => {
    expect(GETTING_STARTED.length).toBeGreaterThanOrEqual(3);
    for (const block of GETTING_STARTED) {
      expect(block.title.length).toBeGreaterThan(0);
      expect(block.lines.length).toBeGreaterThan(0);
      for (const line of block.lines) {
        expect(line.command.trim().length).toBeGreaterThan(0);
        expect(typeof line.detail).toBe('string');
      }
    }
  });

  it('lists the three real processes with http URLs', () => {
    expect(PROCESSES).toHaveLength(3);
    for (const process of PROCESSES) {
      expect(process.url).toMatch(/^https?:\/\//);
      expect(process.note.length).toBeGreaterThan(0);
    }
  });

  it('marks the UI process as the page you are reading', () => {
    expect(PROCESSES.some((process) => process.url.includes('5173'))).toBe(true);
    expect(PROCESSES.some((process) => process.url.endsWith('/api/docs'))).toBe(true);
  });

  it('has notes and a workflow', () => {
    expect(IMPORTANT_NOTES.length).toBeGreaterThanOrEqual(3);
    expect(WORKFLOW.length).toBeGreaterThanOrEqual(4);
    for (const step of WORKFLOW) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.detail.length).toBeGreaterThan(10);
    }
  });
});

describe('help content links resolve', () => {
  it('only links to pages that exist in the navigation tree', () => {
    const known = new Set(NAV_ITEMS.map((item) => item.path));
    const linked = [...TOUR.map((stop) => stop.path), ...WORKFLOW.map((step) => step.to)];

    expect(linked.length).toBeGreaterThan(0);
    for (const path of linked) {
      expect(known.has(path), `${path} is linked from Help but missing from NAV_ITEMS`).toBe(true);
    }
  });

  it('covers every navigable page in the tour', () => {
    const toured = new Set(TOUR.map((stop) => stop.path));
    const missing = NAV_ITEMS.map((item) => item.path).filter(
      (path) => path !== '/' && path !== '/help' && !toured.has(path),
    );
    expect(missing, `pages with no Help entry: ${missing.join(', ')}`).toEqual([]);
  });

  it('gives every tour stop a description', () => {
    expect(TOUR.length).toBeGreaterThanOrEqual(10);
    for (const stop of TOUR) {
      expect(stop.label.length).toBeGreaterThan(0);
      expect(stop.what.length).toBeGreaterThan(20);
    }
  });

  it('points troubleshooting links at real pages', () => {
    const known = new Set(NAV_ITEMS.map((item) => item.path));
    for (const entry of TROUBLESHOOTING) {
      if (entry.to) {
        expect(known.has(entry.to), `${entry.to} is linked from Troubleshooting but not in NAV_ITEMS`).toBe(true);
        expect(entry.toLabel?.length ?? 0).toBeGreaterThan(0);
      }
      expect(entry.symptom.length).toBeGreaterThan(0);
      expect(entry.fix.length).toBeGreaterThan(20);
    }
  });

  it('declares section anchors that the page can actually render', () => {
    const ids = HELP_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size, 'duplicate section ids would break the mini nav').toBe(ids.length);
    // The page renders a section per id, and the palette deep-links two of them.
    expect(ids).toContain('start');
    expect(ids).toContain('troubleshooting');
    expect(ids).toContain('device');
  });

  it('lists reference links with absolute URLs or API paths', () => {
    expect(REFERENCE_LINKS.length).toBeGreaterThanOrEqual(3);
    for (const link of REFERENCE_LINKS) {
      expect(link.href).toMatch(/^(https?:\/\/|\/)/);
      expect(link.note.length).toBeGreaterThan(0);
    }
    expect(REFERENCE_LINKS.some((link) => link.href === '/api/docs')).toBe(true);
  });

  it('only references documentation files that exist', () => {
    expect(REPO_DOCS.length).toBeGreaterThanOrEqual(5);
    for (const doc of REPO_DOCS) {
      const path = resolve(repoRoot, doc.path);
      expect(existsSync(path), `${doc.path} is listed in Help but does not exist`).toBe(true);
    }
  });
});

describe('documented shortcuts match the implementation', () => {
  it('documents the command palette binding', () => {
    const combos = SHORTCUTS.flatMap((shortcut) => shortcut.keys.join('+'));
    expect(combos).toContain('Ctrl+K');
    expect(combos).toContain('Cmd+K');
  });

  it('documents Escape, which the palette and dialogs listen for', () => {
    expect(SHORTCUTS.some((shortcut) => shortcut.keys.includes('Esc'))).toBe(true);
  });

  it('the palette shortcut is implemented as documented', () => {
    const hook = readFileSync(resolve(repoRoot, 'apps/web/src/lib/hooks/useCommandPalette.ts'), 'utf8');
    expect(hook).toContain("event.key.toLowerCase() === 'k'");
    expect(hook).toContain('event.metaKey || event.ctrlKey');
  });
});

describe('in-app help and repository docs agree', () => {
  it('the README documents every required quickstart command', () => {
    for (const command of REQUIRED_QUICKSTART_COMMANDS) {
      expect(readme, `README.md does not mention "${command}"`).toContain(command);
    }
  });

  it('the development guide documents the run loop', () => {
    expect(development).toContain('npm run dev');
    expect(development).toContain('npm run bootstrap');
  });

  it('the README documents both service ports', () => {
    expect(readme).toContain('5173');
    expect(readme).toContain('8000');
  });

  it('the README documents the device variable used by the help page', () => {
    // The Help page renders the live .env snippet, whose key must be the one the
    // backend actually reads.
    expect(readme).toContain('SIGHTRAIL_DEVICE');
    const config = readFileSync(resolve(repoRoot, 'apps/api/sightrail/config.py'), 'utf8');
    expect(config).toContain('SIGHTRAIL_DEVICE');
  });
});
