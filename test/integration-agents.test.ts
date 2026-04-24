/**
 * Integration tests for `agents add` and `agents remove` subcommands.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { initHub, loadRegistry, loadLocalState, saveLocalState } from '../src/core/hub.js';
import { isBuiltinAgent, resetCustomAgents } from '../src/core/agents.js';

let tmpDir: string;
let hubDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillstash-agents-test-'));
  hubDir = path.join(tmpDir, 'skills-hub');
  initHub(hubDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  resetCustomAgents();
});

// ─── agents add ──────────────────────────────────────────────────────────────

describe('agents add: persist custom agent to local.json', () => {
  it('adds new custom agent definition to local.json customAgents', () => {
    const localState = loadLocalState(hubDir);
    localState.customAgents = [
      ...(localState.customAgents ?? []),
      { name: 'my-agent', skillsPath: path.join(tmpDir, 'my-agent', 'skills'), linkType: 'copy' },
    ];
    saveLocalState(localState, hubDir);

    const reloaded = loadLocalState(hubDir);
    expect(reloaded.customAgents?.some((a) => a.name === 'my-agent')).toBe(true);
    expect(reloaded.customAgents?.find((a) => a.name === 'my-agent')?.skillsPath).toBe(
      path.join(tmpDir, 'my-agent', 'skills')
    );
  });

  it('custom agent appears in registry.agents after being added', async () => {
    const { addAgentToRegistry } = await import('../src/core/registry.js');
    const { saveRegistry } = await import('../src/core/hub.js');

    const registry = loadRegistry(hubDir);
    addAgentToRegistry(registry, 'my-agent', {
      name: 'my-agent',
      skillsPath: path.join(tmpDir, 'my-agent', 'skills'),
      linkType: 'copy',
      available: false,
      enabled: true,
    });
    saveRegistry(registry, hubDir);

    const reloaded = loadRegistry(hubDir);
    expect(reloaded.agents['my-agent']).toBeDefined();
    expect(reloaded.agents['my-agent'].enabled).toBe(true);
  });

  it('isBuiltinAgent returns false for newly added custom agent name', () => {
    expect(isBuiltinAgent('my-agent')).toBe(false);
  });

  it('isBuiltinAgent returns true for all built-in names', () => {
    const builtins = ['claude', 'codex', 'codebuddy', 'agents', 'gemini'];
    for (const name of builtins) {
      expect(isBuiltinAgent(name)).toBe(true);
    }
  });
});

// ─── agents remove ───────────────────────────────────────────────────────────

describe('agents remove: unregister custom agent', () => {
  beforeEach(() => {
    // Add a custom agent to local.json + registry so we can remove it
    const localState = loadLocalState(hubDir);
    localState.customAgents = [
      { name: 'temp-agent', skillsPath: '/tmp/temp/skills', linkType: 'copy' },
    ];
    saveLocalState(localState, hubDir);
  });

  it('removes custom agent from local.json customAgents', () => {
    const localState = loadLocalState(hubDir);
    const filtered = (localState.customAgents ?? []).filter((a) => a.name !== 'temp-agent');
    localState.customAgents = filtered;
    saveLocalState(localState, hubDir);

    const reloaded = loadLocalState(hubDir);
    expect(reloaded.customAgents?.some((a) => a.name === 'temp-agent')).toBe(false);
  });

  it('does not affect builtin agents in local.json when removing custom agent', async () => {
    const localState = loadLocalState(hubDir);
    localState.customAgents = (localState.customAgents ?? []).filter((a) => a.name !== 'temp-agent');
    saveLocalState(localState, hubDir);

    const registry = loadRegistry(hubDir);
    // Builtin agents should still be present
    const builtins = ['claude', 'codex', 'codebuddy', 'agents', 'gemini'];
    for (const name of builtins) {
      expect(registry.agents[name]).toBeDefined();
    }
  });

  it('cannot unregister builtin agent via unregisterAgent', async () => {
    const { unregisterAgent } = await import('../src/core/agents.js');
    const result = unregisterAgent('claude');
    expect(result).toBe(false);
  });

  it('can unregister a registered custom agent via unregisterAgent', async () => {
    const { registerAgent, unregisterAgent } = await import('../src/core/agents.js');
    registerAgent({ name: 'temp-agent', skillsPath: '/tmp/temp/skills', linkType: 'copy' });
    const result = unregisterAgent('temp-agent');
    expect(result).toBe(true);
  });
});

// ─── customAgents persistence round-trip ─────────────────────────────────────

describe('customAgents persistence', () => {
  it('custom agents survive save → load round-trip', () => {
    const customDefs = [
      { name: 'agent-a', skillsPath: '/tmp/a/skills', linkType: 'copy' as const },
      { name: 'agent-b', skillsPath: '/tmp/b/skills', linkType: 'symlink' as const },
    ];
    const localState = loadLocalState(hubDir);
    localState.customAgents = customDefs;
    saveLocalState(localState, hubDir);

    const reloaded = loadLocalState(hubDir);
    expect(reloaded.customAgents?.length).toBe(2);
    expect(reloaded.customAgents?.find((a) => a.name === 'agent-a')?.skillsPath).toBe('/tmp/a/skills');
    expect(reloaded.customAgents?.find((a) => a.name === 'agent-b')?.linkType).toBe('symlink');
  });

  it('saveRegistry preserves customAgents across registry saves', async () => {
    const { saveRegistry } = await import('../src/core/hub.js');
    const { createEmptyRegistry } = await import('../src/core/registry.js');

    // Set custom agents in local state
    const localState = loadLocalState(hubDir);
    localState.customAgents = [{ name: 'preserve-me', skillsPath: '/tmp/pm', linkType: 'copy' }];
    saveLocalState(localState, hubDir);

    // Save registry (should not wipe customAgents)
    const reg = createEmptyRegistry();
    saveRegistry(reg, hubDir);

    const reloaded = loadLocalState(hubDir);
    expect(reloaded.customAgents?.some((a) => a.name === 'preserve-me')).toBe(true);
  });
});
