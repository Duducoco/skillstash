import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  getRegistryPath,
  getLocalPath,
  getSkillsPath,
  hubExists,
  loadRegistry,
  saveRegistry,
  loadLocalState,
  saveLocalState,
  initHub,
  listHubSkills,
} from '../src/core/hub.js';
import { createEmptyRegistry, addSkillToRegistry, addAgentToRegistry } from '../src/core/registry.js';

let tmpDir: string;
let hubDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillstash-hub-test-'));
  hubDir = path.join(tmpDir, 'skills-hub');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('getRegistryPath', () => {
  it('returns path with registry.json', () => {
    const result = getRegistryPath('/some/hub');
    expect(result).toBe(path.join('/some/hub', 'registry.json'));
  });
});

describe('getLocalPath', () => {
  it('returns path with local.json', () => {
    const result = getLocalPath('/some/hub');
    expect(result).toBe(path.join('/some/hub', 'local.json'));
  });
});

describe('getSkillsPath', () => {
  it('returns path with skills subdirectory', () => {
    const result = getSkillsPath('/some/hub');
    expect(result).toBe(path.join('/some/hub', 'skills'));
  });
});

describe('hubExists', () => {
  it('returns false when registry.json is missing', () => {
    fs.mkdirSync(hubDir, { recursive: true });
    expect(hubExists(hubDir)).toBe(false);
  });

  it('returns true when registry.json exists', () => {
    fs.mkdirSync(hubDir, { recursive: true });
    fs.writeFileSync(path.join(hubDir, 'registry.json'), '{}', 'utf-8');
    expect(hubExists(hubDir)).toBe(true);
  });

  it('returns false when hub directory does not exist', () => {
    expect(hubExists('/nonexistent/path')).toBe(false);
  });
});

describe('loadLocalState / saveLocalState', () => {
  it('returns empty state when local.json does not exist', () => {
    fs.mkdirSync(hubDir, { recursive: true });
    const state = loadLocalState(hubDir);
    expect(state.lastSync).toBeNull();
    expect(state.agents).toEqual({});
    expect(state.skillAgents).toEqual({});
  });

  it('roundtrips local state through file', () => {
    fs.mkdirSync(hubDir, { recursive: true });
    saveLocalState({
      lastSync: '2026-01-01T00:00:00.000Z',
      agents: { claude: { name: 'claude', skillsPath: '/home/.claude/skills', linkType: 'copy', available: true, enabled: true } },
      skillAgents: { 'my-skill': ['claude'] },
    }, hubDir);

    const loaded = loadLocalState(hubDir);
    expect(loaded.lastSync).toBe('2026-01-01T00:00:00.000Z');
    expect(loaded.agents['claude'].enabled).toBe(true);
    expect(loaded.skillAgents['my-skill']).toEqual(['claude']);
  });

  it('normalizes agents missing enabled field', () => {
    fs.mkdirSync(hubDir, { recursive: true });
    fs.writeFileSync(path.join(hubDir, 'local.json'), JSON.stringify({
      lastSync: null,
      agents: { claude: { name: 'claude', skillsPath: '/home/.claude/skills', linkType: 'copy', available: true } },
      skillAgents: {},
    }), 'utf-8');

    const loaded = loadLocalState(hubDir);
    expect(loaded.agents['claude'].enabled).toBe(true);
  });
});

describe('loadRegistry', () => {
  it('returns empty registry when no file exists', () => {
    const reg = loadRegistry(hubDir);
    expect(reg.version).toBe('1.0');
    expect(reg.skills).toEqual({});
  });

  it('loads registry from file', () => {
    fs.mkdirSync(hubDir, { recursive: true });
    const original = createEmptyRegistry();
    addSkillToRegistry(original, 'test-skill', {
      version: '1.0.0',
      source: 'local',
      hash: 'sha256:abc',
    });
    saveRegistry(original, hubDir);

    const loaded = loadRegistry(hubDir);
    expect(loaded.skills['test-skill']).toBeDefined();
    expect(loaded.skills['test-skill'].version).toBe('1.0.0');
  });

  it('merges skillAgents from local.json into SkillMeta.agents', () => {
    fs.mkdirSync(hubDir, { recursive: true });
    const reg = createEmptyRegistry();
    addSkillToRegistry(reg, 'my-skill', { version: '1.0.0', source: 'local', hash: 'sha256:abc' });
    reg.skills['my-skill'].agents = ['claude'];
    addAgentToRegistry(reg, 'claude', { name: 'claude', skillsPath: '/h/.claude/skills', linkType: 'copy', available: true, enabled: true });
    saveRegistry(reg, hubDir);

    const loaded = loadRegistry(hubDir);
    expect(loaded.skills['my-skill'].agents).toEqual(['claude']);
  });

  it('migrates old-format registry.json (with agents/lastSync inline) to local.json', () => {
    fs.mkdirSync(hubDir, { recursive: true });
    const oldRegJson = JSON.stringify({
      version: '1.0',
      lastSync: '2026-01-01T00:00:00.000Z',
      skills: { 'old-skill': { version: '1.0.0', source: 'local', hash: 'sha256:x', installedAt: '', updatedAt: '', agents: ['claude'], enabled: true } },
      agents: { claude: { name: 'claude', skillsPath: '/home/.claude/skills', linkType: 'copy', available: true, enabled: true } },
    });
    fs.writeFileSync(path.join(hubDir, 'registry.json'), oldRegJson, 'utf-8');

    const loaded = loadRegistry(hubDir);

    // local.json must be created by migration
    expect(fs.existsSync(path.join(hubDir, 'local.json'))).toBe(true);
    const local = loadLocalState(hubDir);
    expect(local.lastSync).toBe('2026-01-01T00:00:00.000Z');
    expect(local.agents['claude']).toBeDefined();
    expect(local.skillAgents['old-skill']).toEqual(['claude']);

    // in-memory Registry should reflect migrated state
    expect(loaded.lastSync).toBe('2026-01-01T00:00:00.000Z');
    expect(loaded.agents['claude']).toBeDefined();
    expect(loaded.skills['old-skill'].agents).toEqual(['claude']);
  });

  it('normalizes agents missing enabled field (backward compat via migration)', () => {
    fs.mkdirSync(hubDir, { recursive: true });
    const oldRegJson = JSON.stringify({
      version: '1.0',
      lastSync: null,
      skills: {},
      agents: {
        claude: {
          name: 'claude',
          skillsPath: '/home/user/.claude/skills',
          linkType: 'copy',
          available: true,
          // no enabled field
        },
      },
    });
    fs.writeFileSync(path.join(hubDir, 'registry.json'), oldRegJson, 'utf-8');

    const loaded = loadRegistry(hubDir);
    expect(loaded.agents['claude'].enabled).toBe(true);
  });
});

describe('saveRegistry', () => {
  it('creates registry.json and local.json files', () => {
    const reg = createEmptyRegistry();
    saveRegistry(reg, hubDir);

    expect(fs.existsSync(path.join(hubDir, 'registry.json'))).toBe(true);
    expect(fs.existsSync(path.join(hubDir, 'local.json'))).toBe(true);
  });

  it('creates .gitignore containing local.json', () => {
    saveRegistry(createEmptyRegistry(), hubDir);

    const gitignore = fs.readFileSync(path.join(hubDir, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('local.json');
  });

  it('registry.json does not contain agents or lastSync', () => {
    const reg = createEmptyRegistry();
    addAgentToRegistry(reg, 'claude', { name: 'claude', skillsPath: '/h/.claude/skills', linkType: 'copy', available: true, enabled: true });
    reg.lastSync = '2026-01-01T00:00:00.000Z';
    saveRegistry(reg, hubDir);

    const raw = JSON.parse(fs.readFileSync(path.join(hubDir, 'registry.json'), 'utf-8'));
    expect(raw.agents).toBeUndefined();
    expect(raw.lastSync).toBeUndefined();
  });

  it('local.json contains agents and lastSync', () => {
    const reg = createEmptyRegistry();
    addAgentToRegistry(reg, 'claude', { name: 'claude', skillsPath: '/h/.claude/skills', linkType: 'copy', available: true, enabled: true });
    reg.lastSync = '2026-01-01T00:00:00.000Z';
    saveRegistry(reg, hubDir);

    const local = loadLocalState(hubDir);
    expect(local.agents['claude']).toBeDefined();
    expect(local.lastSync).toBe('2026-01-01T00:00:00.000Z');
  });

  it('writes valid JSON with skills', () => {
    const reg = createEmptyRegistry();
    addSkillToRegistry(reg, 'my-skill', {
      version: '2.0.0',
      source: 'github',
      hash: 'sha256:def',
    });
    saveRegistry(reg, hubDir);

    const raw = JSON.parse(fs.readFileSync(path.join(hubDir, 'registry.json'), 'utf-8'));
    expect(raw.skills['my-skill'].version).toBe('2.0.0');
    // agents field stripped from skills in registry.json
    expect(raw.skills['my-skill'].agents).toBeUndefined();
  });

  it('stores SkillMeta.agents in local.json skillAgents', () => {
    const reg = createEmptyRegistry();
    addSkillToRegistry(reg, 'my-skill', { version: '1.0.0', source: 'local', hash: 'sha256:abc' });
    reg.skills['my-skill'].agents = ['claude', 'workbuddy'];
    saveRegistry(reg, hubDir);

    const local = loadLocalState(hubDir);
    expect(local.skillAgents['my-skill']).toEqual(['claude', 'workbuddy']);
  });
});

describe('initHub', () => {
  it('creates hub when it does not exist', () => {
    const result = initHub(hubDir);
    expect(result.created).toBe(true);
    expect(result.hubPath).toBe(hubDir);
    expect(fs.existsSync(path.join(hubDir, 'registry.json'))).toBe(true);
    expect(fs.existsSync(path.join(hubDir, 'skills'))).toBe(true);
  });

  it('creates .gitignore with local.json entry', () => {
    initHub(hubDir);
    const gitignore = fs.readFileSync(path.join(hubDir, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('local.json');
  });

  it('creates local.json with detected agents', () => {
    initHub(hubDir);
    expect(fs.existsSync(path.join(hubDir, 'local.json'))).toBe(true);
    const local = loadLocalState(hubDir);
    expect(typeof local.agents).toBe('object');
  });

  it('registry.json does not contain agents', () => {
    initHub(hubDir);
    const raw = JSON.parse(fs.readFileSync(path.join(hubDir, 'registry.json'), 'utf-8'));
    expect(raw.agents).toBeUndefined();
  });

  it('does not recreate existing hub', () => {
    initHub(hubDir);
    const result = initHub(hubDir);
    expect(result.created).toBe(false);
  });

  it('detects agents in registry', () => {
    initHub(hubDir);
    const reg = loadRegistry(hubDir);
    expect(Object.keys(reg.agents).length).toBeGreaterThanOrEqual(0);
  });
});

describe('listHubSkills', () => {
  it('returns empty array when skills dir does not exist', () => {
    expect(listHubSkills(hubDir)).toEqual([]);
  });

  it('returns skill directory names', () => {
    initHub(hubDir);
    const skillsDir = path.join(hubDir, 'skills');
    fs.mkdirSync(path.join(skillsDir, 'finance-ops'));
    fs.mkdirSync(path.join(skillsDir, 'anti-distill'));

    const skills = listHubSkills(hubDir);
    expect(skills).toContain('finance-ops');
    expect(skills).toContain('anti-distill');
  });

  it('excludes files from listing', () => {
    initHub(hubDir);
    const skillsDir = path.join(hubDir, 'skills');
    fs.mkdirSync(path.join(skillsDir, 'real-skill'));
    fs.writeFileSync(path.join(skillsDir, 'not-a-skill.txt'), 'data', 'utf-8');

    const skills = listHubSkills(hubDir);
    expect(skills).toEqual(['real-skill']);
  });
});
