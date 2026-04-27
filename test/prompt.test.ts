import { describe, it, expect } from 'vitest';
import { selectAgents, promptLinkNow, selectSkillsForAgent } from '../src/utils/prompt.js';
import type { AgentConfig } from '../src/core/registry.js';

// Tests run in a non-TTY environment (vitest), so all three functions take the
// non-interactive fallback path — no mocking needed.

function makeAgent(name: string, available: boolean, enabled: boolean): AgentConfig {
  return { name, skillsPath: `/tmp/${name}/skills`, linkType: 'copy', available, enabled };
}

// ── selectAgents ───────────────────────────────────────────────────────────────

describe('selectAgents — non-TTY fallback', () => {
  it('returns only available+enabled agents', async () => {
    const agents = [
      makeAgent('claude', true, true),
      makeAgent('codex', true, false),   // disabled
      makeAgent('gemini', false, true),  // unavailable
    ];
    const result = await selectAgents(agents);
    expect(result.size).toBe(1);
    expect(result.has('claude')).toBe(true);
    expect(result.has('codex')).toBe(false);
    expect(result.has('gemini')).toBe(false);
  });

  it('returns empty set when no agents are available+enabled', async () => {
    const agents = [
      makeAgent('codex', true, false),
      makeAgent('gemini', false, true),
    ];
    const result = await selectAgents(agents);
    expect(result.size).toBe(0);
  });

  it('returns all agents that are both available and enabled', async () => {
    const agents = [
      makeAgent('claude', true, true),
      makeAgent('codex', true, true),
      makeAgent('gemini', true, true),
    ];
    const result = await selectAgents(agents);
    expect(result.size).toBe(3);
    ['claude', 'codex', 'gemini'].forEach(name => expect(result.has(name)).toBe(true));
  });

  it('returns empty set for an empty agent list', async () => {
    const result = await selectAgents([]);
    expect(result.size).toBe(0);
  });

  it('ignores unavailable agents even when enabled flag is true', async () => {
    const agents = [makeAgent('cursor', false, true)];
    const result = await selectAgents(agents);
    expect(result.size).toBe(0);
  });
});

// ── promptLinkNow ──────────────────────────────────────────────────────────────

describe('promptLinkNow — non-TTY fallback', () => {
  it('returns false (skip) in non-TTY environment', async () => {
    const result = await promptLinkNow();
    expect(result).toBe(false);
  });
});

// ── selectSkillsForAgent ───────────────────────────────────────────────────────

describe('selectSkillsForAgent — non-TTY fallback', () => {
  const skills = [
    { name: 'finance-ops', version: '1.0.0' },
    { name: 'anti-distill', version: '2.0.0' },
    { name: 'code-review', version: '1.5.0', description: 'review code' },
  ];

  it('returns currentAssignment when provided', async () => {
    const result = await selectSkillsForAgent('claude', skills, ['finance-ops', 'code-review']);
    expect(result).toEqual(['finance-ops', 'code-review']);
  });

  it('returns all skill names when currentAssignment is undefined (first-time)', async () => {
    const result = await selectSkillsForAgent('claude', skills, undefined);
    expect(result).toEqual(['finance-ops', 'anti-distill', 'code-review']);
  });

  it('returns empty array when currentAssignment is empty array', async () => {
    const result = await selectSkillsForAgent('claude', skills, []);
    expect(result).toEqual([]);
  });

  it('returns empty array when skills list is empty and assignment is undefined', async () => {
    const result = await selectSkillsForAgent('claude', [], undefined);
    expect(result).toEqual([]);
  });

  it('returns the existing assignment unchanged regardless of available skills', async () => {
    const result = await selectSkillsForAgent('claude', skills, ['finance-ops']);
    expect(result).toEqual(['finance-ops']);
  });
});
