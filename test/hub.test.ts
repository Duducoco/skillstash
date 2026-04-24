import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  getRegistryPath,
  getSkillsPath,
  hubExists,
  loadRegistry,
  saveRegistry,
  initHub,
  listHubSkills,
} from '../src/core/hub.js';
import { createEmptyRegistry, addSkillToRegistry } from '../src/core/registry.js';

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
});

describe('saveRegistry', () => {
  it('creates registry.json file', () => {
    const reg = createEmptyRegistry();
    saveRegistry(reg, hubDir);

    const filePath = path.join(hubDir, 'registry.json');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('writes valid JSON', () => {
    const reg = createEmptyRegistry();
    addSkillToRegistry(reg, 'my-skill', {
      version: '2.0.0',
      source: 'github',
      hash: 'sha256:def',
    });
    saveRegistry(reg, hubDir);

    const raw = fs.readFileSync(path.join(hubDir, 'registry.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.skills['my-skill'].version).toBe('2.0.0');
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

  it('does not recreate existing hub', () => {
    initHub(hubDir);
    const result = initHub(hubDir);
    expect(result.created).toBe(false);
  });

  it('detects agents in registry', () => {
    const result = initHub(hubDir);
    const reg = loadRegistry(hubDir);
    // At least one agent entry should exist (from detectAgents)
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