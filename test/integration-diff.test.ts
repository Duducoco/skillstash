/**
 * Integration tests for `diff` command behavior.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { initHub, loadRegistry, saveRegistry, getSkillsPath } from '../src/core/hub.js';
import { addSkillToRegistry, addAgentToRegistry } from '../src/core/registry.js';
import { copyDirRecursive, exists, hashDir } from '../src/utils/fs.js';

let tmpDir: string;
let hubDir: string;
let agentDir: string;

type DiffResult = {
  inSync: string[];
  notLinked: string[];
  outOfSync: string[];
  missingInHub: string[];
  unmanaged: string[];
};

function makeSkillDir(parentDir: string, name: string, content = 'body') {
  const dir = path.join(parentDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\nversion: 1.0.0\n---\n${content}`,
    'utf-8'
  );
  return dir;
}

function setupHub(skills: string[]) {
  const skillsDir = getSkillsPath(hubDir);
  const reg = loadRegistry(hubDir);
  reg.agents = {};  // clear real agents detected on this machine
  for (const name of skills) {
    makeSkillDir(skillsDir, name);
    addSkillToRegistry(reg, name, {
      version: '1.0.0',
      source: 'local',
      hash: hashDir(path.join(skillsDir, name)),
    });
  }
  addAgentToRegistry(reg, 'testagent', {
    name: 'testagent',
    skillsPath: agentDir,
    linkType: 'copy',
    available: true,
    enabled: true,
  });
  saveRegistry(reg, hubDir);
}

// Simulate diff logic — returns categorised results per agent
function doDiff(agentName?: string): DiffResult {
  const reg = loadRegistry(hubDir);
  const skillsDir = getSkillsPath(hubDir);
  const agents = Object.values(reg.agents).filter((a) =>
    agentName ? a.name === agentName : a.available
  );
  const skillNames = Object.keys(reg.skills);

  const result: DiffResult = { inSync: [], notLinked: [], outOfSync: [], missingInHub: [], unmanaged: [] };

  for (const agent of agents) {
    for (const skillName of skillNames) {
      const hubSkillDir = path.join(skillsDir, skillName);
      const agentSkillDir = path.join(agent.skillsPath, skillName);

      if (!exists(hubSkillDir)) {
        result.missingInHub.push(skillName);
        continue;
      }
      if (!exists(agentSkillDir)) {
        result.notLinked.push(skillName);
        continue;
      }
      if (hashDir(hubSkillDir) !== hashDir(agentSkillDir)) {
        result.outOfSync.push(skillName);
      } else {
        result.inSync.push(skillName);
      }
    }

    // Unmanaged: in agent dir but not in registry
    if (exists(agent.skillsPath)) {
      for (const entry of fs.readdirSync(agent.skillsPath, { withFileTypes: true })
        .filter((d) => d.isDirectory()).map((d) => d.name)) {
        if (!skillNames.includes(entry)) result.unmanaged.push(entry);
      }
    }
  }

  return result;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillstash-diff-'));
  hubDir = path.join(tmpDir, 'hub');
  agentDir = path.join(tmpDir, 'agent-skills');
  fs.mkdirSync(agentDir, { recursive: true });
  initHub(hubDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('diff: skill in sync', () => {
  it('detects in-sync skill (hub == agent)', () => {
    setupHub(['finance-ops']);
    copyDirRecursive(path.join(getSkillsPath(hubDir), 'finance-ops'), path.join(agentDir, 'finance-ops'));
    const result = doDiff();
    expect(result.inSync).toContain('finance-ops');
    expect(result.outOfSync).toHaveLength(0);
  });
});

describe('diff: skill not linked', () => {
  it('detects skill in hub but absent in agent dir', () => {
    setupHub(['finance-ops']);
    const result = doDiff();
    expect(result.notLinked).toContain('finance-ops');
  });
});

describe('diff: skill out of sync', () => {
  it('detects content mismatch between hub and agent', () => {
    setupHub(['finance-ops']);
    // Copy to agent then modify agent copy
    copyDirRecursive(path.join(getSkillsPath(hubDir), 'finance-ops'), path.join(agentDir, 'finance-ops'));
    fs.writeFileSync(path.join(agentDir, 'finance-ops', 'extra.txt'), 'stale data', 'utf-8');
    const result = doDiff();
    expect(result.outOfSync).toContain('finance-ops');
  });
});

describe('diff: skill missing in hub', () => {
  it('detects skill registered but directory deleted from hub', () => {
    setupHub(['finance-ops']);
    // Delete hub directory manually
    const hubSkillDir = path.join(getSkillsPath(hubDir), 'finance-ops');
    fs.rmSync(hubSkillDir, { recursive: true, force: true });
    const result = doDiff();
    expect(result.missingInHub).toContain('finance-ops');
  });
});

describe('diff: unmanaged skills', () => {
  it('detects skill in agent dir not tracked by hub', () => {
    setupHub([]);
    makeSkillDir(agentDir, 'rogue-skill');
    const result = doDiff();
    expect(result.unmanaged).toContain('rogue-skill');
  });
});

describe('diff --agent: filter by agent', () => {
  it('only diffs the specified agent', () => {
    setupHub(['finance-ops']);
    const result = doDiff('testagent');
    expect(result.notLinked).toContain('finance-ops');
  });
});
