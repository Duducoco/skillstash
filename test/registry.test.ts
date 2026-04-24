import { describe, it, expect } from 'vitest';
import {
  createEmptyRegistry,
  addSkillToRegistry,
  removeSkillFromRegistry,
  addAgentToRegistry,
  updateSkillInRegistry,
  setAgentEnabled,
  SkillMeta,
  AgentConfig,
  Registry,
} from '../src/core/registry.js';

describe('createEmptyRegistry', () => {
  it('returns a registry with default values', () => {
    const reg = createEmptyRegistry();
    expect(reg.version).toBe('1.0');
    expect(reg.lastSync).toBeNull();
    expect(reg.skills).toEqual({});
    expect(reg.agents).toEqual({});
  });

  it('returns independent objects each call', () => {
    const reg1 = createEmptyRegistry();
    const reg2 = createEmptyRegistry();
    reg1.skills['test'] = {} as SkillMeta;
    expect(reg2.skills).toEqual({});
  });
});

describe('addSkillToRegistry', () => {
  it('adds a skill with required fields', () => {
    const reg = createEmptyRegistry();
    addSkillToRegistry(reg, 'my-skill', {
      version: '1.0.0',
      source: 'local',
      hash: 'sha256:abc123',
    });

    expect(reg.skills['my-skill']).toBeDefined();
    expect(reg.skills['my-skill'].version).toBe('1.0.0');
    expect(reg.skills['my-skill'].source).toBe('local');
    expect(reg.skills['my-skill'].hash).toBe('sha256:abc123');
    expect(reg.skills['my-skill'].enabled).toBe(true);
    expect(reg.skills['my-skill'].agents).toEqual([]);
    expect(reg.skills['my-skill'].installedAt).toBeTruthy();
    expect(reg.skills['my-skill'].updatedAt).toBeTruthy();
  });

  it('adds a skill with all optional fields', () => {
    const reg = createEmptyRegistry();
    addSkillToRegistry(reg, 'finance-ops', {
      version: '2.1.0',
      source: 'github',
      sourceUrl: 'https://github.com/owner/repo',
      hash: 'sha256:deadbeef',
      description: 'AI CFO assistant',
      agents: ['workbuddy', 'codex'],
      enabled: false,
      installedAt: '2026-01-01T00:00:00Z',
    });

    const skill = reg.skills['finance-ops'];
    expect(skill.sourceUrl).toBe('https://github.com/owner/repo');
    expect(skill.description).toBe('AI CFO assistant');
    expect(skill.agents).toEqual(['workbuddy', 'codex']);
    expect(skill.enabled).toBe(false);
    expect(skill.installedAt).toBe('2026-01-01T00:00:00Z');
  });

  it('defaults enabled to true', () => {
    const reg = createEmptyRegistry();
    addSkillToRegistry(reg, 's1', { version: '1.0.0', source: 'local', hash: 'sha256:a' });
    addSkillToRegistry(reg, 's2', { version: '1.0.0', source: 'local', hash: 'sha256:b', enabled: true });
    expect(reg.skills['s1'].enabled).toBe(true);
    expect(reg.skills['s2'].enabled).toBe(true);
  });

  it('returns the same registry object (mutates in place)', () => {
    const reg = createEmptyRegistry();
    const result = addSkillToRegistry(reg, 'x', { version: '1.0.0', source: 'clawhub', hash: 'sha256:x' });
    expect(result).toBe(reg);
  });
});

describe('removeSkillFromRegistry', () => {
  it('removes an existing skill', () => {
    const reg = createEmptyRegistry();
    addSkillToRegistry(reg, 'a', { version: '1.0.0', source: 'local', hash: 'sha256:a' });
    addSkillToRegistry(reg, 'b', { version: '2.0.0', source: 'github', hash: 'sha256:b' });
    removeSkillFromRegistry(reg, 'a');
    expect(reg.skills['a']).toBeUndefined();
    expect(reg.skills['b']).toBeDefined();
  });

  it('does nothing for a non-existent skill', () => {
    const reg = createEmptyRegistry();
    removeSkillFromRegistry(reg, 'ghost');
    expect(Object.keys(reg.skills)).toHaveLength(0);
  });
});

describe('addAgentToRegistry', () => {
  it('adds an agent config', () => {
    const reg = createEmptyRegistry();
    const config: AgentConfig = {
      name: 'claude',
      skillsPath: '/home/user/.claude/skills',
      linkType: 'copy',
      available: true,
      enabled: true,
    };
    addAgentToRegistry(reg, 'claude', config);
    expect(reg.agents['claude']).toEqual(config);
  });

  it('overwrites an existing agent', () => {
    const reg = createEmptyRegistry();
    addAgentToRegistry(reg, 'wb', {
      name: 'workbuddy',
      skillsPath: '/old/path',
      linkType: 'symlink',
      available: true,
      enabled: true,
    });
    addAgentToRegistry(reg, 'wb', {
      name: 'workbuddy',
      skillsPath: '/new/path',
      linkType: 'copy',
      available: false,
      enabled: false,
    });
    expect(reg.agents['wb'].skillsPath).toBe('/new/path');
    expect(reg.agents['wb'].linkType).toBe('copy');
    expect(reg.agents['wb'].enabled).toBe(false);
  });
});

describe('updateSkillInRegistry', () => {
  it('updates fields on an existing skill', () => {
    const reg = createEmptyRegistry();
    addSkillToRegistry(reg, 'my-skill', {
      version: '1.0.0',
      source: 'local',
      hash: 'sha256:abc',
      description: 'old desc',
    });
    updateSkillInRegistry(reg, 'my-skill', {
      version: '2.0.0',
      description: 'new desc',
      enabled: false,
    });
    expect(reg.skills['my-skill'].version).toBe('2.0.0');
    expect(reg.skills['my-skill'].description).toBe('new desc');
    expect(reg.skills['my-skill'].enabled).toBe(false);
  });

  it('always updates updatedAt timestamp', async () => {
    const reg = createEmptyRegistry();
    addSkillToRegistry(reg, 's', { version: '1.0.0', source: 'local', hash: 'sha256:x' });
    const oldUpdatedAt = reg.skills['s'].updatedAt;
    await new Promise(resolve => setTimeout(resolve, 5));
    updateSkillInRegistry(reg, 's', { version: '1.1.0' });
    expect(reg.skills['s'].updatedAt).not.toBe(oldUpdatedAt);
  });

  it('returns registry unchanged if skill does not exist', () => {
    const reg = createEmptyRegistry();
    const result = updateSkillInRegistry(reg, 'ghost', { version: '9.0.0' });
    expect(result).toBe(reg);
    expect(Object.keys(reg.skills)).toHaveLength(0);
  });
});

describe('setAgentEnabled', () => {
  it('enables an existing agent', () => {
    const reg = createEmptyRegistry();
    addAgentToRegistry(reg, 'claude', {
      name: 'claude',
      skillsPath: '/home/user/.claude/skills',
      linkType: 'copy',
      available: true,
      enabled: false,
    });
    setAgentEnabled(reg, 'claude', true);
    expect(reg.agents['claude'].enabled).toBe(true);
  });

  it('disables an existing agent', () => {
    const reg = createEmptyRegistry();
    addAgentToRegistry(reg, 'codex', {
      name: 'codex',
      skillsPath: '/home/user/.codex/skills',
      linkType: 'copy',
      available: true,
      enabled: true,
    });
    setAgentEnabled(reg, 'codex', false);
    expect(reg.agents['codex'].enabled).toBe(false);
  });

  it('returns registry unchanged if agent does not exist', () => {
    const reg = createEmptyRegistry();
    const result = setAgentEnabled(reg, 'ghost', true);
    expect(result).toBe(reg);
    expect(Object.keys(reg.agents)).toHaveLength(0);
  });
});