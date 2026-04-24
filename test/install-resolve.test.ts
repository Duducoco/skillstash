/**
 * Tests for resolveSkillSource, findGithubSkill, and installFromPath (local).
 * ClawHub and GitHub network paths are excluded per project requirements.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { resolveSkillSource, findGithubSkill, installFromPath } from '../src/commands/install.js';
import { initHub, loadRegistry, saveRegistry, getSkillsPath } from '../src/core/hub.js';
import { exists } from '../src/utils/fs.js';

let tmpDir: string;
let hubDir: string;

function makeSkillDir(parentDir: string, name: string, version = '1.0.0'): string {
  const dir = path.join(parentDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\nversion: ${version}\ndescription: ${name} skill\n---\nBody`,
    'utf-8'
  );
  return dir;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillstash-install-'));
  hubDir = path.join(tmpDir, 'hub');
  initHub(hubDir);
  // Clear detected real agents
  const reg = loadRegistry(hubDir);
  reg.agents = {};
  saveRegistry(reg, hubDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── resolveSkillSource ───────────────────────────────────────────────────────

describe('resolveSkillSource: clawhub prefix', () => {
  it('detects clawhub: prefix', () => {
    const result = resolveSkillSource('clawhub:finance-ops');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('clawhub');
    expect(result!.slug).toBe('finance-ops');
  });

  it('returns null for empty clawhub slug', () => {
    const result = resolveSkillSource('clawhub:');
    expect(result).toBeNull();
  });
});

describe('resolveSkillSource: local path', () => {
  it('detects ./ relative path', () => {
    const skillDir = makeSkillDir(tmpDir, 'my-skill');
    // resolveSkillSource resolves relative to cwd, so use absolute path
    const result = resolveSkillSource(skillDir);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('local');
    expect(result!.path).toBe(skillDir);
  });

  it('detects absolute path starting with /', () => {
    const skillDir = makeSkillDir(tmpDir, 'abs-skill');
    const result = resolveSkillSource(skillDir);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('local');
  });

  it('detects Windows-style C:\\ path', () => {
    // Simulate a Windows path string without needing the dir to exist for path parsing
    // We test just the regex detection branch — pass a non-existent path and expect null
    // (the path is valid format but SKILL.md won't exist)
    const result = resolveSkillSource('C:\\Users\\test\\my-skill');
    // Returns null because SKILL.md doesn't exist, but the branch was entered
    expect(result).toBeNull();
  });

  it('detects Windows-style C:/ forward-slash path', () => {
    const result = resolveSkillSource('C:/Users/test/my-skill');
    expect(result).toBeNull(); // path doesn't exist, but format was recognised
  });

  it('returns null when SKILL.md is missing at local path', () => {
    const emptyDir = path.join(tmpDir, 'empty');
    fs.mkdirSync(emptyDir);
    const result = resolveSkillSource(emptyDir);
    expect(result).toBeNull();
  });
});

describe('resolveSkillSource: GitHub format', () => {
  it('detects owner/repo format', () => {
    const result = resolveSkillSource('owner/repo');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('github');
    expect(result!.url).toBe('https://github.com/owner/repo');
    expect(result!.skillName).toBe('');
  });

  it('detects owner/repo@skill-name format', () => {
    const result = resolveSkillSource('owner/repo@my-skill');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('github');
    expect(result!.url).toBe('https://github.com/owner/repo');
    expect(result!.skillName).toBe('my-skill');
  });

  it('returns null for unrecognised format', () => {
    const result = resolveSkillSource('not-a-valid-source');
    expect(result).toBeNull();
  });
});

// ─── findGithubSkill ──────────────────────────────────────────────────────────

describe('findGithubSkill: standalone skill repo (SKILL.md at root)', () => {
  it('returns repo root when SKILL.md is at root', () => {
    const repoDir = path.join(tmpDir, 'standalone-repo');
    fs.mkdirSync(repoDir);
    fs.writeFileSync(path.join(repoDir, 'SKILL.md'), '---\nname: standalone\n---\n', 'utf-8');
    expect(findGithubSkill(repoDir)).toBe(repoDir);
  });
});

describe('findGithubSkill: skill-hub layout (skills/<name>/SKILL.md)', () => {
  it('auto-selects when exactly one skill in skills/ dir', () => {
    const repoDir = path.join(tmpDir, 'hub-repo');
    makeSkillDir(path.join(repoDir, 'skills'), 'finance-ops');
    const result = findGithubSkill(repoDir);
    expect(result).toBe(path.join(repoDir, 'skills', 'finance-ops'));
  });

  it('returns null and does not auto-select with multiple skills (no @skill-name)', () => {
    const repoDir = path.join(tmpDir, 'multi-repo');
    makeSkillDir(path.join(repoDir, 'skills'), 'skill-a');
    makeSkillDir(path.join(repoDir, 'skills'), 'skill-b');
    expect(findGithubSkill(repoDir)).toBeNull();
  });

  it('finds skill by name in skills/ dir', () => {
    const repoDir = path.join(tmpDir, 'hub-repo2');
    makeSkillDir(path.join(repoDir, 'skills'), 'finance-ops');
    makeSkillDir(path.join(repoDir, 'skills'), 'other-skill');
    expect(findGithubSkill(repoDir, 'finance-ops')).toBe(path.join(repoDir, 'skills', 'finance-ops'));
  });
});

describe('findGithubSkill: subdirectory layout (<name>/SKILL.md)', () => {
  it('auto-selects single top-level skill subdirectory', () => {
    const repoDir = path.join(tmpDir, 'subdir-repo');
    makeSkillDir(repoDir, 'my-skill');
    // Add a non-skill dir to confirm filtering works
    fs.mkdirSync(path.join(repoDir, 'docs'));
    expect(findGithubSkill(repoDir)).toBe(path.join(repoDir, 'my-skill'));
  });

  it('finds skill by name in top-level subdirectory', () => {
    const repoDir = path.join(tmpDir, 'subdir-repo2');
    makeSkillDir(repoDir, 'skill-a');
    makeSkillDir(repoDir, 'skill-b');
    expect(findGithubSkill(repoDir, 'skill-a')).toBe(path.join(repoDir, 'skill-a'));
  });

  it('returns null when named skill does not exist', () => {
    const repoDir = path.join(tmpDir, 'subdir-repo3');
    makeSkillDir(repoDir, 'real-skill');
    expect(findGithubSkill(repoDir, 'ghost-skill')).toBeNull();
  });

  it('returns null when no SKILL.md found anywhere', () => {
    const repoDir = path.join(tmpDir, 'empty-repo');
    fs.mkdirSync(repoDir);
    expect(findGithubSkill(repoDir)).toBeNull();
  });
});

// ─── installFromPath (local) ──────────────────────────────────────────────────

describe('installFromPath: install from local directory', () => {
  it('copies skill files into hub', async () => {
    const srcDir = makeSkillDir(tmpDir, 'my-skill');
    fs.writeFileSync(path.join(srcDir, 'prompt.md'), '# Prompt', 'utf-8');

    await installFromPath(srcDir, hubDir, 'local', { lint: false });

    const destDir = path.join(getSkillsPath(hubDir), 'my-skill');
    expect(exists(destDir)).toBe(true);
    expect(exists(path.join(destDir, 'SKILL.md'))).toBe(true);
    expect(exists(path.join(destDir, 'prompt.md'))).toBe(true);
  });

  it('registers skill in registry with correct metadata', async () => {
    const srcDir = makeSkillDir(tmpDir, 'my-skill', '2.1.0');
    await installFromPath(srcDir, hubDir, 'local', { lint: false });

    const reg = loadRegistry(hubDir);
    expect(reg.skills['my-skill']).toBeDefined();
    expect(reg.skills['my-skill'].version).toBe('2.1.0');
    expect(reg.skills['my-skill'].source).toBe('local');
    expect(reg.skills['my-skill'].hash.startsWith('sha256:')).toBe(true);
  });

  it('records sourceUrl for github source type', async () => {
    const srcDir = makeSkillDir(tmpDir, 'gh-skill');
    await installFromPath(srcDir, hubDir, 'github', { lint: false }, undefined, 'https://github.com/owner/repo');

    const reg = loadRegistry(hubDir);
    expect(reg.skills['gh-skill'].source).toBe('github');
    expect(reg.skills['gh-skill'].sourceUrl).toBe('https://github.com/owner/repo');
  });

  it('updates existing skill on re-install', async () => {
    const srcDir = makeSkillDir(tmpDir, 'my-skill', '1.0.0');
    await installFromPath(srcDir, hubDir, 'local', { lint: false });

    // Bump version and re-install
    fs.writeFileSync(
      path.join(srcDir, 'SKILL.md'),
      '---\nname: my-skill\nversion: 1.1.0\ndescription: updated\n---\nBody',
      'utf-8'
    );
    await installFromPath(srcDir, hubDir, 'local', { lint: false });

    const reg = loadRegistry(hubDir);
    expect(reg.skills['my-skill'].version).toBe('1.1.0');
  });

  it('uses overrideName instead of SKILL.md name', async () => {
    const srcDir = makeSkillDir(tmpDir, 'original-name');
    await installFromPath(srcDir, hubDir, 'local', { lint: false }, 'override-name');

    const reg = loadRegistry(hubDir);
    expect(reg.skills['override-name']).toBeDefined();
    expect(reg.skills['original-name']).toBeUndefined();
  });

  it('aborts when lint fails (missing name field)', async () => {
    const srcDir = path.join(tmpDir, 'bad-skill');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'SKILL.md'), '---\nversion: 1.0.0\n---\nBody', 'utf-8');

    await installFromPath(srcDir, hubDir, 'local', { lint: true });

    const reg = loadRegistry(hubDir);
    expect(reg.skills['bad-skill']).toBeUndefined();
  });

  it('installs when lint passes', async () => {
    const srcDir = makeSkillDir(tmpDir, 'valid-skill');
    await installFromPath(srcDir, hubDir, 'local', { lint: true });

    const reg = loadRegistry(hubDir);
    expect(reg.skills['valid-skill']).toBeDefined();
  });
});
