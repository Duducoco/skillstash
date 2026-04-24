import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  resolveSkillsPath,
  registerAgent,
  unregisterAgent,
  isBuiltinAgent,
  getAgentDefinitions,
  resetCustomAgents,
  type AgentDefinition,
} from '../src/core/agents.js';

const BUILTIN_NAMES = ['workbuddy', 'codebuddy', 'codex', 'claude', 'agents'];

afterEach(() => {
  resetCustomAgents();
});

describe('resolveSkillsPath', () => {
  it('replaces {home} with os.homedir()', () => {
    const result = resolveSkillsPath('{home}/.myagent/skills');
    expect(result).toBe(path.join(os.homedir(), '.myagent', 'skills').replace(/\\/g, '/').replace(os.homedir().replace(/\\/g, '/'), os.homedir()));
    // simpler: just check it no longer contains {home}
    expect(result).not.toContain('{home}');
    expect(result).toContain(os.homedir());
  });

  it('leaves paths without {home} unchanged', () => {
    const p = '/absolute/path/to/skills';
    expect(resolveSkillsPath(p)).toBe(p);
  });
});

describe('isBuiltinAgent', () => {
  it.each(BUILTIN_NAMES)('returns true for builtin agent "%s"', (name) => {
    expect(isBuiltinAgent(name)).toBe(true);
  });

  it('returns false for unknown custom agent', () => {
    expect(isBuiltinAgent('my-custom-agent')).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(isBuiltinAgent('Claude')).toBe(false);
    expect(isBuiltinAgent('CLAUDE')).toBe(false);
  });
});

describe('getAgentDefinitions', () => {
  it('returns all 5 builtin agents by default', () => {
    const defs = getAgentDefinitions();
    expect(defs.length).toBe(5);
    for (const name of BUILTIN_NAMES) {
      expect(defs.some((d) => d.name === name)).toBe(true);
    }
  });

  it('returns builtins + custom agents after registration', () => {
    registerAgent({ name: 'my-agent', skillsPath: '/tmp/my-agent/skills', linkType: 'copy' });
    const defs = getAgentDefinitions();
    expect(defs.length).toBe(6);
    expect(defs.some((d) => d.name === 'my-agent')).toBe(true);
  });
});

describe('registerAgent', () => {
  it('adds a custom agent to definitions', () => {
    const def: AgentDefinition = { name: 'my-agent', skillsPath: '/tmp/my-agent/skills', linkType: 'copy' };
    registerAgent(def);
    expect(getAgentDefinitions().some((d) => d.name === 'my-agent')).toBe(true);
  });

  it('silently ignores registration of builtin agent names', () => {
    const before = getAgentDefinitions().length;
    registerAgent({ name: 'claude', skillsPath: '/other/path', linkType: 'copy' });
    expect(getAgentDefinitions().length).toBe(before);
    // builtin path must not change
    const claude = getAgentDefinitions().find((d) => d.name === 'claude')!;
    expect(claude.skillsPath).toContain('{home}');
  });

  it('updates existing custom agent if registered twice', () => {
    registerAgent({ name: 'my-agent', skillsPath: '/tmp/v1/skills', linkType: 'copy' });
    registerAgent({ name: 'my-agent', skillsPath: '/tmp/v2/skills', linkType: 'symlink' });
    const defs = getAgentDefinitions().filter((d) => d.name === 'my-agent');
    expect(defs.length).toBe(1);
    expect(defs[0].skillsPath).toBe('/tmp/v2/skills');
    expect(defs[0].linkType).toBe('symlink');
  });

  it('preserves all fields on custom agent', () => {
    const def: AgentDefinition = { name: 'test-agent', skillsPath: '{home}/.test/skills', linkType: 'junction' };
    registerAgent(def);
    const found = getAgentDefinitions().find((d) => d.name === 'test-agent')!;
    expect(found.skillsPath).toBe('{home}/.test/skills');
    expect(found.linkType).toBe('junction');
  });
});

describe('unregisterAgent', () => {
  it('returns false and does not remove builtin agents', () => {
    const before = getAgentDefinitions().length;
    const result = unregisterAgent('claude');
    expect(result).toBe(false);
    expect(getAgentDefinitions().length).toBe(before);
  });

  it('returns false for unknown agent name', () => {
    expect(unregisterAgent('nonexistent')).toBe(false);
  });

  it('returns true and removes registered custom agent', () => {
    registerAgent({ name: 'temp-agent', skillsPath: '/tmp/skills', linkType: 'copy' });
    expect(getAgentDefinitions().some((d) => d.name === 'temp-agent')).toBe(true);
    const result = unregisterAgent('temp-agent');
    expect(result).toBe(true);
    expect(getAgentDefinitions().some((d) => d.name === 'temp-agent')).toBe(false);
  });

  it('does not affect builtins or other custom agents', () => {
    registerAgent({ name: 'agent-a', skillsPath: '/tmp/a', linkType: 'copy' });
    registerAgent({ name: 'agent-b', skillsPath: '/tmp/b', linkType: 'copy' });
    unregisterAgent('agent-a');
    expect(getAgentDefinitions().some((d) => d.name === 'agent-b')).toBe(true);
    expect(getAgentDefinitions().filter((d) => d.name === 'claude').length).toBe(1);
  });
});

describe('resetCustomAgents', () => {
  it('clears all custom agents leaving only builtins', () => {
    registerAgent({ name: 'a', skillsPath: '/tmp/a', linkType: 'copy' });
    registerAgent({ name: 'b', skillsPath: '/tmp/b', linkType: 'copy' });
    expect(getAgentDefinitions().length).toBe(7);
    resetCustomAgents();
    expect(getAgentDefinitions().length).toBe(5);
    expect(getAgentDefinitions().every((d) => BUILTIN_NAMES.includes(d.name))).toBe(true);
  });
});
