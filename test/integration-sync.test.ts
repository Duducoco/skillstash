/**
 * Integration tests for `sync` command behavior.
 * Tests verify integrity-check and link steps (pull/push skipped as they need git remote).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { initHub, loadRegistry, saveRegistry, getSkillsPath } from '../src/core/hub.js';
import { addSkillToRegistry, addAgentToRegistry, removeSkillFromRegistry, updateSkillInRegistry } from '../src/core/registry.js';
import { copyDirRecursive, removeDir, exists, hashDir } from '../src/utils/fs.js';
import { getSkillVersion, getSkillDescription } from '../src/core/skill.js';

let tmpDir: string;
let hubDir: string;
let agentDir: string;

function makeSkillDir(parentDir: string, name: string, version = '1.0.0') {
  const dir = path.join(parentDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\nversion: ${version}\ndescription: ${name}\n---\nBody`,
    'utf-8'
  );
  return dir;
}

// Simulate the integrity-check + link steps from sync
function doSync(options: { noLink?: boolean; clean?: boolean } = {}) {
  const reg = loadRegistry(hubDir);
  const skillsDir = getSkillsPath(hubDir);
  const skillNames = Object.keys(reg.skills);
  let issues = 0;

  // Integrity check
  for (const name of skillNames) {
    const skillDir = path.join(skillsDir, name);
    if (!exists(skillDir)) {
      removeSkillFromRegistry(reg, name);
      issues++;
      continue;
    }
    const currentHash = hashDir(skillDir);
    if (currentHash !== reg.skills[name].hash) {
      updateSkillInRegistry(reg, name, { hash: currentHash });
      issues++;
    }
  }

  // Skills on disk not in registry
  if (exists(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name)) {
      if (!reg.skills[entry]) {
        const skillDir = path.join(skillsDir, entry);
        reg.skills[entry] = {
          version: getSkillVersion(skillDir),
          source: 'local',
          installedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          hash: hashDir(skillDir),
          agents: [],
          enabled: true,
          description: getSkillDescription(skillDir),
        };
        issues++;
      }
    }
  }

  if (issues > 0) saveRegistry(reg, hubDir);

  // Link step
  if (!options.noLink) {
    const agents = Object.values(reg.agents).filter((a) => a.available);
    const enabledSkills = Object.keys(reg.skills).filter((s) => reg.skills[s].enabled);

    for (const agent of agents) {
      fs.mkdirSync(agent.skillsPath, { recursive: true });

      for (const skillName of enabledSkills) {
        const src = path.join(skillsDir, skillName);
        const dest = path.join(agent.skillsPath, skillName);
        if (!exists(src)) continue;
        if (exists(dest)) removeDir(dest);
        copyDirRecursive(src, dest);
        if (!reg.skills[skillName].agents.includes(agent.name)) {
          reg.skills[skillName].agents.push(agent.name);
        }
      }

      if (options.clean) {
        for (const entry of fs.readdirSync(agent.skillsPath, { withFileTypes: true })
          .filter((d) => d.isDirectory()).map((d) => d.name)) {
          if (!enabledSkills.includes(entry)) removeDir(path.join(agent.skillsPath, entry));
        }
      }
    }

    saveRegistry(reg, hubDir);
  }

  reg.lastSync = new Date().toISOString();
  saveRegistry(reg, hubDir);

  return reg;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillstash-sync-'));
  hubDir = path.join(tmpDir, 'hub');
  agentDir = path.join(tmpDir, 'agent-skills');
  fs.mkdirSync(agentDir, { recursive: true });
  initHub(hubDir);

  const reg = loadRegistry(hubDir);
  reg.agents = {};  // clear real agents detected on this machine
  addAgentToRegistry(reg, 'testagent', {
    name: 'testagent',
    skillsPath: agentDir,
    linkType: 'copy',
    available: true,
  });
  saveRegistry(reg, hubDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('sync: integrity check', () => {
  it('removes from registry a skill whose directory is missing', () => {
    const skillsDir = getSkillsPath(hubDir);
    makeSkillDir(skillsDir, 'ghost-skill');
    const reg = loadRegistry(hubDir);
    addSkillToRegistry(reg, 'ghost-skill', { version: '1.0.0', source: 'local', hash: 'sha256:old' });
    saveRegistry(reg, hubDir);
    // Delete directory but keep in registry
    fs.rmSync(path.join(skillsDir, 'ghost-skill'), { recursive: true, force: true });

    const result = doSync({ noLink: true });
    expect(result.skills['ghost-skill']).toBeUndefined();
  });

  it('updates hash when skill content changes', () => {
    const skillsDir = getSkillsPath(hubDir);
    makeSkillDir(skillsDir, 'my-skill');
    const reg = loadRegistry(hubDir);
    addSkillToRegistry(reg, 'my-skill', { version: '1.0.0', source: 'local', hash: 'sha256:stale' });
    saveRegistry(reg, hubDir);

    const result = doSync({ noLink: true });
    expect(result.skills['my-skill'].hash).not.toBe('sha256:stale');
    expect(result.skills['my-skill'].hash.startsWith('sha256:')).toBe(true);
  });

  it('auto-registers skill found on disk but not in registry', () => {
    const skillsDir = getSkillsPath(hubDir);
    makeSkillDir(skillsDir, 'orphan-skill');
    // Do NOT add to registry

    const result = doSync({ noLink: true });
    expect(result.skills['orphan-skill']).toBeDefined();
    expect(result.skills['orphan-skill'].source).toBe('local');
  });
});

describe('sync: link step', () => {
  it('copies all enabled skills to agent directory', () => {
    const skillsDir = getSkillsPath(hubDir);
    makeSkillDir(skillsDir, 'skill-a');
    const reg = loadRegistry(hubDir);
    addSkillToRegistry(reg, 'skill-a', { version: '1.0.0', source: 'local', hash: hashDir(path.join(skillsDir, 'skill-a')) });
    saveRegistry(reg, hubDir);

    doSync();
    expect(exists(path.join(agentDir, 'skill-a'))).toBe(true);
  });

  it('updates lastSync timestamp', () => {
    const result = doSync();
    expect(result.lastSync).not.toBeNull();
    expect(new Date(result.lastSync!).getTime()).toBeGreaterThan(0);
  });
});

describe('sync --no-link: skips linking step', () => {
  it('does not copy skills to agent when --no-link', () => {
    const skillsDir = getSkillsPath(hubDir);
    makeSkillDir(skillsDir, 'skill-a');
    const reg = loadRegistry(hubDir);
    addSkillToRegistry(reg, 'skill-a', { version: '1.0.0', source: 'local', hash: hashDir(path.join(skillsDir, 'skill-a')) });
    saveRegistry(reg, hubDir);

    doSync({ noLink: true });
    expect(exists(path.join(agentDir, 'skill-a'))).toBe(false);
  });
});

describe('sync --clean: removes unmanaged agent skills', () => {
  it('removes skills in agent not in hub', () => {
    // Plant rogue skill in agent dir
    makeSkillDir(agentDir, 'rogue');
    doSync({ clean: true });
    expect(exists(path.join(agentDir, 'rogue'))).toBe(false);
  });
});
