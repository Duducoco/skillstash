/**
 * Integration tests for `remove` command behavior.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { initHub, loadRegistry, saveRegistry, getSkillsPath } from '../src/core/hub.js';
import { addSkillToRegistry, addAgentToRegistry } from '../src/core/registry.js';
import { removeSkillFromRegistry } from '../src/core/registry.js';
import { copyDirRecursive, removeDir, exists, hashDir } from '../src/utils/fs.js';

let tmpDir: string;
let hubDir: string;
let agentDir: string;

function makeSkillDir(parentDir: string, name: string) {
  const dir = path.join(parentDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\nversion: 1.0.0\n---\nBody`,
    'utf-8'
  );
  return dir;
}

function setupSkillInHub(name: string) {
  const skillsDir = getSkillsPath(hubDir);
  makeSkillDir(skillsDir, name);
  const reg = loadRegistry(hubDir);
  addSkillToRegistry(reg, name, {
    version: '1.0.0',
    source: 'local',
    hash: hashDir(path.join(skillsDir, name)),
    agents: ['testagent'],
  });
  saveRegistry(reg, hubDir);
  // Also copy to agent dir (simulate previous link)
  copyDirRecursive(path.join(skillsDir, name), path.join(agentDir, name));
}

function doRemove(skillName: string, options: { keepAgents?: boolean } = {}) {
  const reg = loadRegistry(hubDir);
  const skillMeta = reg.skills[skillName];
  if (!skillMeta) return false;

  const hubSkillDir = path.join(getSkillsPath(hubDir), skillName);
  if (exists(hubSkillDir)) removeDir(hubSkillDir);

  if (!options.keepAgents) {
    for (const agentName of skillMeta.agents) {
      const agent = reg.agents[agentName];
      if (!agent) continue;
      const agentSkillDir = path.join(agent.skillsPath, skillName);
      if (exists(agentSkillDir)) removeDir(agentSkillDir);
    }
  }

  removeSkillFromRegistry(reg, skillName);
  saveRegistry(reg, hubDir);
  return true;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillstash-remove-'));
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
    enabled: true,
  });
  saveRegistry(reg, hubDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('remove: deletes skill from hub and agents', () => {
  it('removes skill from hub directory', () => {
    setupSkillInHub('finance-ops');
    doRemove('finance-ops');
    expect(exists(path.join(getSkillsPath(hubDir), 'finance-ops'))).toBe(false);
  });

  it('removes skill from agent directory', () => {
    setupSkillInHub('finance-ops');
    doRemove('finance-ops');
    expect(exists(path.join(agentDir, 'finance-ops'))).toBe(false);
  });

  it('removes skill from registry', () => {
    setupSkillInHub('finance-ops');
    doRemove('finance-ops');
    const reg = loadRegistry(hubDir);
    expect(reg.skills['finance-ops']).toBeUndefined();
  });

  it('returns false for non-existent skill', () => {
    const result = doRemove('ghost-skill');
    expect(result).toBe(false);
  });

  it('does not affect other skills', () => {
    setupSkillInHub('skill-a');
    setupSkillInHub('skill-b');
    doRemove('skill-a');
    const reg = loadRegistry(hubDir);
    expect(reg.skills['skill-b']).toBeDefined();
    expect(exists(path.join(agentDir, 'skill-b'))).toBe(true);
  });
});

describe('remove --keep-agents: only removes from hub', () => {
  it('removes from hub but keeps agent copy', () => {
    setupSkillInHub('finance-ops');
    doRemove('finance-ops', { keepAgents: true });
    expect(exists(path.join(getSkillsPath(hubDir), 'finance-ops'))).toBe(false);
    expect(exists(path.join(agentDir, 'finance-ops'))).toBe(true);
  });

  it('still removes from registry', () => {
    setupSkillInHub('finance-ops');
    doRemove('finance-ops', { keepAgents: true });
    const reg = loadRegistry(hubDir);
    expect(reg.skills['finance-ops']).toBeUndefined();
  });
});
