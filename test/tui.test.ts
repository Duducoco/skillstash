/**
 * Tests for the TUI default-launch behavior.
 *
 * We cannot exercise real @inquirer/prompts interactivity in a non-TTY CI
 * environment, so we mock the module and verify that launchTUI() builds the
 * correct argument arrays for each menu selection.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// ── Mock @inquirer/prompts ────────────────────────────────────────────────────
const mockSelect = vi.fn();
const mockInput  = vi.fn();

vi.mock('@inquirer/prompts', () => ({
  select:    (...args: unknown[]) => mockSelect(...args),
  input:     (...args: unknown[]) => mockInput(...args),
  Separator: class Separator { separator = true; },
}));

// ── Import AFTER mocking ──────────────────────────────────────────────────────
// Simulate a TTY environment so launchTUI() does not return null early.
const originalStdin  = Object.getOwnPropertyDescriptor(process.stdin,  'isTTY');
const originalStdout = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

beforeEach(() => {
  Object.defineProperty(process.stdin,  'isTTY', { value: true, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  mockSelect.mockReset();
  mockInput.mockReset();
});

// ── Load i18n so t() returns real strings, not keys ───────────────────────────
await import('../src/i18n/en.js');

import { launchTUI } from '../src/commands/tui.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

describe('launchTUI — exit choice', () => {
  it('returns null when the user selects Exit', async () => {
    mockSelect.mockResolvedValueOnce('exit');
    const result = await launchTUI();
    expect(result).toBeNull();
  });
});

describe('launchTUI — simple commands (no extra prompts)', () => {
  for (const cmd of ['sync', 'link', 'diff', 'import', 'assign', 'language'] as const) {
    it(`returns ["${cmd}"] for ${cmd} selection`, async () => {
      mockSelect.mockResolvedValueOnce(cmd);
      const result = await launchTUI();
      expect(result).toEqual([cmd]);
    });
  }
});

describe('launchTUI — init', () => {
  it('returns ["init"] when no URL is entered', async () => {
    mockSelect.mockResolvedValueOnce('init');
    mockInput.mockResolvedValueOnce('');
    const result = await launchTUI();
    expect(result).toEqual(['init']);
  });

  it('returns ["init", url] when a URL is entered', async () => {
    mockSelect.mockResolvedValueOnce('init');
    mockInput.mockResolvedValueOnce('git@github.com:user/skills.git');
    const result = await launchTUI();
    expect(result).toEqual(['init', 'git@github.com:user/skills.git']);
  });
});

describe('launchTUI — install', () => {
  it('returns ["install", skillName]', async () => {
    mockSelect.mockResolvedValueOnce('install');
    mockInput.mockResolvedValueOnce('clawhub:finance-ops');
    const result = await launchTUI();
    expect(result).toEqual(['install', 'clawhub:finance-ops']);
  });
});

describe('launchTUI — list', () => {
  it('returns ["list"] in normal mode', async () => {
    mockSelect.mockResolvedValueOnce('list');
    mockSelect.mockResolvedValueOnce(false);
    const result = await launchTUI();
    expect(result).toEqual(['list']);
  });

  it('returns ["list", "--verbose"] in verbose mode', async () => {
    mockSelect.mockResolvedValueOnce('list');
    mockSelect.mockResolvedValueOnce(true);
    const result = await launchTUI();
    expect(result).toEqual(['list', '--verbose']);
  });
});

describe('launchTUI — remove', () => {
  it('returns ["remove", skillName]', async () => {
    mockSelect.mockResolvedValueOnce('remove');
    mockInput.mockResolvedValueOnce('old-skill');
    const result = await launchTUI();
    expect(result).toEqual(['remove', 'old-skill']);
  });
});

describe('launchTUI — agents', () => {
  it('returns ["agents", "list"] for agents list', async () => {
    mockSelect.mockResolvedValueOnce('agents');
    mockSelect.mockResolvedValueOnce('list');
    const result = await launchTUI();
    expect(result).toEqual(['agents', 'list']);
  });

  it('returns ["agents", "select"] for agents select', async () => {
    mockSelect.mockResolvedValueOnce('agents');
    mockSelect.mockResolvedValueOnce('select');
    const result = await launchTUI();
    expect(result).toEqual(['agents', 'select']);
  });

  it('returns ["agents", "enable", agentName] for agents enable', async () => {
    mockSelect.mockResolvedValueOnce('agents');
    mockSelect.mockResolvedValueOnce('enable');
    mockInput.mockResolvedValueOnce('claude');
    const result = await launchTUI();
    expect(result).toEqual(['agents', 'enable', 'claude']);
  });

  it('returns ["agents", "disable", agentName] for agents disable', async () => {
    mockSelect.mockResolvedValueOnce('agents');
    mockSelect.mockResolvedValueOnce('disable');
    mockInput.mockResolvedValueOnce('cursor');
    const result = await launchTUI();
    expect(result).toEqual(['agents', 'disable', 'cursor']);
  });
});

describe('launchTUI — add-remote', () => {
  it('returns ["add-remote", url]', async () => {
    mockSelect.mockResolvedValueOnce('add-remote');
    mockInput.mockResolvedValueOnce('git@github.com:user/skills.git');
    const result = await launchTUI();
    expect(result).toEqual(['add-remote', 'git@github.com:user/skills.git']);
  });
});

// Restore original TTY descriptors after all tests
afterAll(() => {
  if (originalStdin)  Object.defineProperty(process.stdin,  'isTTY', originalStdin);
  if (originalStdout) Object.defineProperty(process.stdout, 'isTTY', originalStdout);
});
