/**
 * Integration tests for the `link` command behavior.
 *
 * These tests replicate what registerLinkCommand does internally,
 * verifying the expected file-system outcomes without invoking Commander.
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

function makeSkillDir(parentDir: string, name: string, content = 'body') {
  const dir = path.join(parentDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\nversion: 1.0.0\ndescription: test skill\n---\n${content}`,
    'utf-8'
  );
  return dir;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillstash-link-'));
  hubDir = path.join(tmpDir, 'hub');
  agentDir = path.join(tmpDir, 'agent-skills');
  fs.mkdirSync(agentDir, { recursive: true });

  initHub(hubDir);
  const skillsDir = getSkillsPath(hubDir);

  // Pre-populate hub with two skills
  makeSkillDir(skillsDir, 'finance-ops');
  makeSkillDir(skillsDir, 'anti-distill');

  // Replace all detected agents with only our test agent to stay fully isolated
  const reg = loadRegistry(hubDir);
  reg.agents = {};
  addSkillToRegistry(reg, 'finance-ops', { version: '1.0.0', source: 'local', hash: hashDir(path.join(skillsDir, 'finance-ops')) });
  addSkillToRegistry(reg, 'anti-distill', { version: '1.0.0', source: 'local', hash: hashDir(path.join(skillsDir, 'anti-distill')) });
  addAgentToRegistry(reg, 'testagent', { name: 'testagent', skillsPath: agentDir, linkType: 'copy', available: true, enabled: true });
  saveRegistry(reg, hubDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Simulate link logic ──────────────────────────────────────────────────────

function doLink(options: { agent?: string; skill?: string; clean?: boolean } = {}) {
  const reg = loadRegistry(hubDir);
  const skillsDir = getSkillsPath(hubDir);
  const agents = Object.values(reg.agents).filter((a) =>
    options.agent ? a.name === options.agent : a.available
  );

  let skillNames = Object.keys(reg.skills).filter((s) => reg.skills[s].enabled);
  if (options.skill) skillNames = skillNames.filter((s) => s === options.skill);

  for (const agent of agents) {
    fs.mkdirSync(agent.skillsPath, { recursive: true });

    for (const skillName of skillNames) {
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
        if (!skillNames.includes(entry)) removeDir(path.join(agent.skillsPath, entry));
      }
    }
  }

  saveRegistry(reg, hubDir);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('link: copies skills to agent directory', () => {
  it('copies all enabled skills', () => {
    doLink();
    expect(exists(path.join(agentDir, 'finance-ops'))).toBe(true);
    expect(exists(path.join(agentDir, 'anti-distill'))).toBe(true);
  });

  it('content is identical to hub', () => {
    doLink();
    const skillsDir = getSkillsPath(hubDir);
    expect(hashDir(path.join(skillsDir, 'finance-ops')))
      .toBe(hashDir(path.join(agentDir, 'finance-ops')));
  });

  it('updates registry agents list', () => {
    doLink();
    const reg = loadRegistry(hubDir);
    expect(reg.skills['finance-ops'].agents).toContain('testagent');
    expect(reg.skills['anti-distill'].agents).toContain('testagent');
  });

  it('--skill links only the specified skill', () => {
    doLink({ skill: 'finance-ops' });
    expect(exists(path.join(agentDir, 'finance-ops'))).toBe(true);
    expect(exists(path.join(agentDir, 'anti-distill'))).toBe(false);
  });

  it('--agent links only to the specified agent', () => {
    const other = path.join(tmpDir, 'other-agent');
    const reg = loadRegistry(hubDir);
    addAgentToRegistry(reg, 'other', { name: 'other', skillsPath: other, linkType: 'copy', available: true, enabled: true });
    saveRegistry(reg, hubDir);

    doLink({ agent: 'testagent' });
    expect(exists(path.join(agentDir, 'finance-ops'))).toBe(true);
    expect(exists(other)).toBe(false); // other agent not linked
  });

  it('overwrites stale agent copy on re-link', () => {
    doLink();
    // Mutate agent copy
    fs.writeFileSync(path.join(agentDir, 'finance-ops', 'extra.txt'), 'stale');
    doLink();
    // Re-link should restore to hub state
    expect(exists(path.join(agentDir, 'finance-ops', 'extra.txt'))).toBe(false);
  });

  it('disabled skills are not linked', () => {
    const reg = loadRegistry(hubDir);
    reg.skills['finance-ops'].enabled = false;
    saveRegistry(reg, hubDir);

    doLink();
    expect(exists(path.join(agentDir, 'finance-ops'))).toBe(false);
    expect(exists(path.join(agentDir, 'anti-distill'))).toBe(true);
  });
});

describe('link --clean: removes unmanaged skills', () => {
  it('removes skills in agent dir not in hub', () => {
    // Plant an unmanaged skill in agent dir
    makeSkillDir(agentDir, 'rogue-skill');
    doLink({ clean: true });
    expect(exists(path.join(agentDir, 'rogue-skill'))).toBe(false);
  });

  it('keeps managed skills when using --clean', () => {
    doLink({ clean: true });
    expect(exists(path.join(agentDir, 'finance-ops'))).toBe(true);
    expect(exists(path.join(agentDir, 'anti-distill'))).toBe(true);
  });
});
