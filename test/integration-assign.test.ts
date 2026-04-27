/**
 * Integration tests for assign command behavior.
 *
 * The assign command is interactive (per-agent skill selection) and not exported.
 * These tests replicate its core logic — recording agentSkills in the registry
 * and copying skills to agent directories — without invoking Commander.
 * In non-TTY (CI) mode selectSkillsForAgent returns currentAssignment or all skills.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { initHub, loadRegistry, saveRegistry, getSkillsPath } from '../src/core/hub.js';
import { addSkillToRegistry, addAgentToRegistry } from '../src/core/registry.js';
import { copyDirRecursive, removeDir, exists, hashDir } from '../src/utils/fs.js';

let tmpDir: string;
let hubDir: string;
let agentDir: string;
let agent2Dir: string;

function makeSkillDir(parentDir: string, name: string, content = 'body') {
  const dir = path.join(parentDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\nversion: 1.0.0\ndescription: test skill\n---\n${content}`,
    'utf-8',
  );
  return dir;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillstash-assign-'));
  hubDir = path.join(tmpDir, 'hub');
  agentDir = path.join(tmpDir, 'agent1-skills');
  agent2Dir = path.join(tmpDir, 'agent2-skills');

  initHub(hubDir);
  const skillsDir = getSkillsPath(hubDir);
  makeSkillDir(skillsDir, 'finance-ops');
  makeSkillDir(skillsDir, 'anti-distill');
  makeSkillDir(skillsDir, 'code-review');

  const reg = loadRegistry(hubDir);
  reg.agents = {};
  addSkillToRegistry(reg, 'finance-ops', {
    version: '1.0.0', source: 'local',
    hash: hashDir(path.join(skillsDir, 'finance-ops')),
  });
  addSkillToRegistry(reg, 'anti-distill', {
    version: '1.0.0', source: 'local',
    hash: hashDir(path.join(skillsDir, 'anti-distill')),
  });
  addSkillToRegistry(reg, 'code-review', {
    version: '1.0.0', source: 'local',
    hash: hashDir(path.join(skillsDir, 'code-review')),
  });
  addAgentToRegistry(reg, 'agent1', {
    name: 'agent1', skillsPath: agentDir, linkType: 'copy', available: true, enabled: true,
  });
  addAgentToRegistry(reg, 'agent2', {
    name: 'agent2', skillsPath: agent2Dir, linkType: 'copy', available: true, enabled: true,
  });
  saveRegistry(reg, hubDir);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(agent2Dir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Replicate assign logic ─────────────────────────────────────────────────────

function doAssign(options: {
  agent?: string;
  skillsForAgent?: Record<string, string[]>;
} = {}): number {
  const reg = loadRegistry(hubDir);
  const skillsDir = getSkillsPath(hubDir);
  const enabledSkillNames = Object.entries(reg.skills)
    .filter(([, meta]) => meta.enabled)
    .map(([name]) => name);

  const targetAgents = Object.values(reg.agents).filter(
    (a) => a.available && a.enabled && (!options.agent || a.name === options.agent),
  );

  for (const agent of targetAgents) {
    const assignment = options.skillsForAgent?.[agent.name] ?? enabledSkillNames;
    reg.agentSkills[agent.name] = assignment;
  }
  saveRegistry(reg, hubDir);

  // Link assigned skills to agent directories
  let totalLinked = 0;
  const reg2 = loadRegistry(hubDir);

  for (const agent of targetAgents) {
    fs.mkdirSync(agent.skillsPath, { recursive: true });
    const agentSkillList = reg2.agentSkills[agent.name] ?? enabledSkillNames;

    for (const skillName of agentSkillList) {
      const src = path.join(skillsDir, skillName);
      const dest = path.join(agent.skillsPath, skillName);
      if (!exists(src)) continue;
      if (exists(dest)) removeDir(dest);
      copyDirRecursive(src, dest);
      if (!reg2.skills[skillName].agents.includes(agent.name)) {
        reg2.skills[skillName].agents.push(agent.name);
      }
      totalLinked++;
    }
  }

  saveRegistry(reg2, hubDir);
  return totalLinked;
}

// ── Assignment persistence ─────────────────────────────────────────────────────

describe('assign: skill assignment persisted to registry', () => {
  it('records all enabled skills for every agent by default', () => {
    doAssign();
    const reg = loadRegistry(hubDir);
    expect(reg.agentSkills['agent1']).toContain('finance-ops');
    expect(reg.agentSkills['agent1']).toContain('anti-distill');
    expect(reg.agentSkills['agent1']).toContain('code-review');
    expect(reg.agentSkills['agent2']).toContain('finance-ops');
  });

  it('records partial assignment when a subset is provided per agent', () => {
    doAssign({
      skillsForAgent: { agent1: ['finance-ops'], agent2: ['anti-distill'] },
    });
    const reg = loadRegistry(hubDir);
    expect(reg.agentSkills['agent1']).toEqual(['finance-ops']);
    expect(reg.agentSkills['agent2']).toEqual(['anti-distill']);
  });

  it('assigns both agents when no --agent filter', () => {
    doAssign();
    const reg = loadRegistry(hubDir);
    expect(reg.agentSkills['agent1']).toBeDefined();
    expect(reg.agentSkills['agent2']).toBeDefined();
  });

  it('--agent filter only records assignment for the named agent', () => {
    doAssign({ agent: 'agent1' });
    const reg = loadRegistry(hubDir);
    expect(reg.agentSkills['agent1']).toBeDefined();
    expect(reg.agentSkills['agent2']).toBeUndefined();
  });

  it('overwrites previous assignment on re-assign', () => {
    doAssign({ skillsForAgent: { agent1: ['finance-ops', 'anti-distill'] } });
    doAssign({ skillsForAgent: { agent1: ['code-review'] } });
    const reg = loadRegistry(hubDir);
    expect(reg.agentSkills['agent1']).toEqual(['code-review']);
  });

  it('records empty assignment when empty list provided', () => {
    doAssign({ skillsForAgent: { agent1: [] } });
    const reg = loadRegistry(hubDir);
    expect(reg.agentSkills['agent1']).toEqual([]);
  });
});

// ── Link step ─────────────────────────────────────────────────────────────────

describe('assign: link step copies skills to agent directories', () => {
  it('copies all assigned skills to the correct agent dir', () => {
    doAssign({
      skillsForAgent: {
        agent1: ['finance-ops', 'code-review'],
        agent2: ['anti-distill'],
      },
    });
    expect(exists(path.join(agentDir, 'finance-ops'))).toBe(true);
    expect(exists(path.join(agentDir, 'code-review'))).toBe(true);
    expect(exists(path.join(agentDir, 'anti-distill'))).toBe(false);
    expect(exists(path.join(agent2Dir, 'anti-distill'))).toBe(true);
  });

  it('does not copy unassigned skills', () => {
    doAssign({ skillsForAgent: { agent1: ['finance-ops'], agent2: ['finance-ops'] } });
    expect(exists(path.join(agentDir, 'anti-distill'))).toBe(false);
    expect(exists(path.join(agentDir, 'code-review'))).toBe(false);
  });

  it('copied skill content matches hub source', () => {
    doAssign({ skillsForAgent: { agent1: ['finance-ops'] } });
    const skillsDir = getSkillsPath(hubDir);
    expect(hashDir(path.join(skillsDir, 'finance-ops')))
      .toBe(hashDir(path.join(agentDir, 'finance-ops')));
  });

  it('updates registry agents list after linking', () => {
    doAssign({ skillsForAgent: { agent1: ['finance-ops'] } });
    const reg = loadRegistry(hubDir);
    expect(reg.skills['finance-ops'].agents).toContain('agent1');
  });

  it('does not record agent for skills that were not linked to it', () => {
    doAssign({ skillsForAgent: { agent1: ['finance-ops'], agent2: ['anti-distill'] } });
    const reg = loadRegistry(hubDir);
    expect(reg.skills['anti-distill'].agents).not.toContain('agent1');
    expect(reg.skills['finance-ops'].agents).not.toContain('agent2');
  });

  it('returns correct total linked count', () => {
    const count = doAssign({
      skillsForAgent: { agent1: ['finance-ops', 'anti-distill'], agent2: ['code-review'] },
    });
    expect(count).toBe(3);
  });

  it('re-assign overwrites stale agent copy', () => {
    doAssign({ skillsForAgent: { agent1: ['finance-ops'] } });
    fs.writeFileSync(path.join(agentDir, 'finance-ops', 'stale.txt'), 'stale', 'utf-8');

    doAssign({ skillsForAgent: { agent1: ['finance-ops'] } });
    expect(exists(path.join(agentDir, 'finance-ops', 'stale.txt'))).toBe(false);
  });
});
