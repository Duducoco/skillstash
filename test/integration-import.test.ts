/**
 * Integration tests for `import` command behavior.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { initHub, loadRegistry, saveRegistry, getSkillsPath } from '../src/core/hub.js';
import { addSkillToRegistry, addAgentToRegistry, updateSkillInRegistry } from '../src/core/registry.js';
import { copyDirRecursive, removeDir, exists, hashDir } from '../src/utils/fs.js';
import { getSkillVersion, getSkillDescription, lintSkill } from '../src/core/skill.js';

let tmpDir: string;
let hubDir: string;
let agentSkillsDir: string;

function makeSkillDir(parentDir: string, name: string, version = '1.0.0', extra?: Record<string, string>) {
  const dir = path.join(parentDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\nversion: ${version}\ndescription: ${name} skill\n---\nBody`,
    'utf-8'
  );
  if (extra) {
    for (const [file, content] of Object.entries(extra)) {
      fs.writeFileSync(path.join(dir, file), content, 'utf-8');
    }
  }
  return dir;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillstash-import-'));
  hubDir = path.join(tmpDir, 'hub');
  agentSkillsDir = path.join(tmpDir, 'agent', 'skills');
  fs.mkdirSync(agentSkillsDir, { recursive: true });
  initHub(hubDir);

  const reg = loadRegistry(hubDir);
  reg.agents = {};  // clear real agents detected on this machine
  addAgentToRegistry(reg, 'testagent', {
    name: 'testagent',
    skillsPath: agentSkillsDir,
    linkType: 'copy',
    available: true,
  });
  saveRegistry(reg, hubDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Simulate core import logic ───────────────────────────────────────────────

function doImport(options: { force?: boolean; dryRun?: boolean; lint?: boolean } = {}) {
  const reg = loadRegistry(hubDir);
  const skillsDir = getSkillsPath(hubDir);
  const agents = Object.values(reg.agents).filter((a) => a.available);
  const imported: string[] = [];
  const skipped: string[] = [];

  for (const agent of agents) {
    if (!exists(agent.skillsPath)) continue;

    for (const entry of fs.readdirSync(agent.skillsPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;

      const srcDir = path.join(agent.skillsPath, entry.name);
      if (!exists(path.join(srcDir, 'SKILL.md'))) continue;

      const name = entry.name;
      const alreadyExists = !!reg.skills[name];

      if (alreadyExists && !options.force) {
        skipped.push(name);
        continue;
      }

      if (options.lint) {
        const result = lintSkill(srcDir);
        if (!result.valid) {
          skipped.push(name);
          continue;
        }
      }

      if (options.dryRun) {
        imported.push(name);
        continue;
      }

      const destDir = path.join(skillsDir, name);
      if (exists(destDir)) removeDir(destDir);
      copyDirRecursive(srcDir, destDir);

      const version = getSkillVersion(destDir);
      const hash = hashDir(destDir);
      const description = getSkillDescription(destDir);

      if (alreadyExists) {
        updateSkillInRegistry(reg, name, { version, hash, description: description || undefined });
      } else {
        addSkillToRegistry(reg, name, { version, source: 'local', hash, description: description || undefined, agents: [] });
      }
      imported.push(name);
    }
  }

  if (!options.dryRun && imported.length > 0) saveRegistry(reg, hubDir);
  return { imported, skipped };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('import: basic import from agent directory', () => {
  it('imports a new skill into hub', () => {
    makeSkillDir(agentSkillsDir, 'my-skill');
    const { imported } = doImport();
    expect(imported).toContain('my-skill');
    expect(exists(path.join(getSkillsPath(hubDir), 'my-skill'))).toBe(true);
  });

  it('registers the skill in registry', () => {
    makeSkillDir(agentSkillsDir, 'my-skill');
    doImport();
    const reg = loadRegistry(hubDir);
    expect(reg.skills['my-skill']).toBeDefined();
    expect(reg.skills['my-skill'].source).toBe('local');
    expect(reg.skills['my-skill'].version).toBe('1.0.0');
  });

  it('imports multiple skills', () => {
    makeSkillDir(agentSkillsDir, 'skill-a');
    makeSkillDir(agentSkillsDir, 'skill-b');
    const { imported } = doImport();
    expect(imported).toContain('skill-a');
    expect(imported).toContain('skill-b');
  });

  it('skips entries without SKILL.md', () => {
    fs.mkdirSync(path.join(agentSkillsDir, 'not-a-skill'), { recursive: true });
    const { imported } = doImport();
    expect(imported).not.toContain('not-a-skill');
  });

  it('skips hidden directories (starting with .)', () => {
    makeSkillDir(agentSkillsDir, '.hidden-skill');
    const { imported } = doImport();
    expect(imported).not.toContain('.hidden-skill');
  });
});

describe('import --force: re-imports existing skills', () => {
  it('skips already-imported skill without --force', () => {
    makeSkillDir(agentSkillsDir, 'existing');
    doImport();
    const { imported, skipped } = doImport();
    expect(skipped).toContain('existing');
    expect(imported).not.toContain('existing');
  });

  it('re-imports with --force and updates registry', () => {
    makeSkillDir(agentSkillsDir, 'existing', '1.0.0');
    doImport();
    // Update agent version
    fs.writeFileSync(
      path.join(agentSkillsDir, 'existing', 'SKILL.md'),
      `---\nname: existing\nversion: 2.0.0\ndescription: updated\n---\nBody`,
      'utf-8'
    );
    const { imported } = doImport({ force: true });
    expect(imported).toContain('existing');
    const reg = loadRegistry(hubDir);
    expect(reg.skills['existing'].version).toBe('2.0.0');
  });
});

describe('import --dry-run: shows changes without applying', () => {
  it('returns what would be imported', () => {
    makeSkillDir(agentSkillsDir, 'dry-skill');
    const { imported } = doImport({ dryRun: true });
    expect(imported).toContain('dry-skill');
  });

  it('does not write files to hub', () => {
    makeSkillDir(agentSkillsDir, 'dry-skill');
    doImport({ dryRun: true });
    expect(exists(path.join(getSkillsPath(hubDir), 'dry-skill'))).toBe(false);
  });

  it('does not update registry', () => {
    makeSkillDir(agentSkillsDir, 'dry-skill');
    doImport({ dryRun: true });
    const reg = loadRegistry(hubDir);
    expect(reg.skills['dry-skill']).toBeUndefined();
  });
});

describe('import --lint: validates SKILL.md before importing', () => {
  it('skips invalid skills (missing name field)', () => {
    const dir = path.join(agentSkillsDir, 'bad-skill');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nversion: 1.0.0\n---\nBody', 'utf-8');
    const { skipped } = doImport({ lint: true });
    expect(skipped).toContain('bad-skill');
  });

  it('imports valid skills when lint is on', () => {
    makeSkillDir(agentSkillsDir, 'valid-skill');
    const { imported } = doImport({ lint: true });
    expect(imported).toContain('valid-skill');
  });
});
