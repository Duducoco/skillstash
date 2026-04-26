/**
 * Tests for the TUI logic.
 *
 * The Ink-based TUI renders a full-screen React component and cannot be
 * exercised directly in a non-TTY CI environment.  Instead we test the
 * exported pure `buildArgs` function (which maps a menu choice + collected
 * inputs to a Commander args array) and the non-TTY guard in `launchTUI`.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';

// ── Simulate a TTY environment ─────────────────────────────────────────────────
const originalStdin  = Object.getOwnPropertyDescriptor(process.stdin,  'isTTY');
const originalStdout = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

beforeEach(() => {
  Object.defineProperty(process.stdin,  'isTTY', { value: true, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
});

// ── Load i18n so t() returns real strings, not keys ───────────────────────────
await import('../src/i18n/en.js');

import { launchTUI, buildArgs } from '../src/commands/tui.js';

// ── launchTUI: non-TTY guard ───────────────────────────────────────────────────

describe('launchTUI — non-TTY', () => {
  it('returns null when stdin is not a TTY', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    const result = await launchTUI();
    expect(result).toBeNull();
  });

  it('returns null when stdout is not a TTY', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    const result = await launchTUI();
    expect(result).toBeNull();
  });
});

// ── buildArgs: exit ───────────────────────────────────────────────────────────

describe('buildArgs — exit choice', () => {
  it('returns null for exit', () => {
    expect(buildArgs('exit', {})).toBeNull();
  });
});

// ── buildArgs: simple commands (no extra inputs needed) ───────────────────────

describe('buildArgs — simple commands', () => {
  for (const cmd of ['sync', 'link', 'diff', 'import', 'assign', 'language'] as const) {
    it(`returns ["${cmd}"] for ${cmd}`, () => {
      expect(buildArgs(cmd, {})).toEqual([cmd]);
    });
  }
});

// ── buildArgs: init ───────────────────────────────────────────────────────────

describe('buildArgs — init', () => {
  it('returns ["init"] when no URL is provided', () => {
    expect(buildArgs('init', { initUrl: '' })).toEqual(['init']);
  });

  it('returns ["init"] when initUrl is absent', () => {
    expect(buildArgs('init', {})).toEqual(['init']);
  });

  it('returns ["init", url] when a URL is provided', () => {
    expect(buildArgs('init', { initUrl: 'git@github.com:user/skills.git' }))
      .toEqual(['init', 'git@github.com:user/skills.git']);
  });

  it('trims whitespace from the URL', () => {
    expect(buildArgs('init', { initUrl: '  git@github.com:user/skills.git  ' }))
      .toEqual(['init', 'git@github.com:user/skills.git']);
  });
});

// ── buildArgs: install ────────────────────────────────────────────────────────

describe('buildArgs — install', () => {
  it('returns ["install", skillName]', () => {
    expect(buildArgs('install', { installName: 'clawhub:finance-ops' }))
      .toEqual(['install', 'clawhub:finance-ops']);
  });

  it('returns null when skillName is empty', () => {
    expect(buildArgs('install', { installName: '' })).toBeNull();
  });

  it('returns null when skillName is absent', () => {
    expect(buildArgs('install', {})).toBeNull();
  });
});

// ── buildArgs: list ───────────────────────────────────────────────────────────

describe('buildArgs — list', () => {
  it('returns ["list"] in normal mode', () => {
    expect(buildArgs('list', { listVerbose: false })).toEqual(['list']);
  });

  it('returns ["list"] when listVerbose is absent', () => {
    expect(buildArgs('list', {})).toEqual(['list']);
  });

  it('returns ["list", "--verbose"] in verbose mode', () => {
    expect(buildArgs('list', { listVerbose: true })).toEqual(['list', '--verbose']);
  });
});

// ── buildArgs: remove ─────────────────────────────────────────────────────────

describe('buildArgs — remove', () => {
  it('returns ["remove", skillName]', () => {
    expect(buildArgs('remove', { removeName: 'old-skill' }))
      .toEqual(['remove', 'old-skill']);
  });

  it('returns null when removeName is empty', () => {
    expect(buildArgs('remove', { removeName: '' })).toBeNull();
  });
});

// ── buildArgs: agents ─────────────────────────────────────────────────────────

describe('buildArgs — agents', () => {
  it('returns ["agents", "list"]', () => {
    expect(buildArgs('agents', { agentsSub: 'list' })).toEqual(['agents', 'list']);
  });

  it('returns ["agents", "select"]', () => {
    expect(buildArgs('agents', { agentsSub: 'select' })).toEqual(['agents', 'select']);
  });

  it('returns ["agents", "enable", agentName]', () => {
    expect(buildArgs('agents', { agentsSub: 'enable', agentName: 'claude' }))
      .toEqual(['agents', 'enable', 'claude']);
  });

  it('returns ["agents", "disable", agentName]', () => {
    expect(buildArgs('agents', { agentsSub: 'disable', agentName: 'cursor' }))
      .toEqual(['agents', 'disable', 'cursor']);
  });

  it('returns null when agentsSub is absent', () => {
    expect(buildArgs('agents', {})).toBeNull();
  });

  it('returns null when enable/disable agentName is empty', () => {
    expect(buildArgs('agents', { agentsSub: 'enable', agentName: '' })).toBeNull();
  });
});

// ── buildArgs: add-remote ─────────────────────────────────────────────────────

describe('buildArgs — add-remote', () => {
  it('returns ["add-remote", url]', () => {
    expect(buildArgs('add-remote', { addRemoteUrl: 'git@github.com:user/skills.git' }))
      .toEqual(['add-remote', 'git@github.com:user/skills.git']);
  });

  it('returns null when url is empty', () => {
    expect(buildArgs('add-remote', { addRemoteUrl: '' })).toBeNull();
  });

  it('trims whitespace from the URL', () => {
    expect(buildArgs('add-remote', { addRemoteUrl: '  git@github.com:user/skills.git  ' }))
      .toEqual(['add-remote', 'git@github.com:user/skills.git']);
  });
});

// Restore original TTY descriptors after all tests
afterAll(() => {
  if (originalStdin)  Object.defineProperty(process.stdin,  'isTTY', originalStdin);
  if (originalStdout) Object.defineProperty(process.stdout, 'isTTY', originalStdout);
});

