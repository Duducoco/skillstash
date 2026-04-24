/**
 * Tests for `import --agent` filter: only scans the specified agent directory.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { initHub, loadRegistry, saveRegistry, getSkillsPath } from '../src/core/hub.js';
import { addAgentToRegistry, addSkillToRegistry } from '../src/core/registry.js';
import { copyDirRecursive, removeDir, exists, hashDir } from '../src/utils/fs.js';
import { getSkillVersion, getSkillDescription, lintSkill } from '../src/core/skill.js';
import { updateSkillInRegistry } from '../src/core/registry.js';

let tmpDir: string;
let hubDir: string;
let agentADir: string;
let agentBDir: string;

function makeSkillDir(parentDir: string, name: string): string {
  const dir = path.join(parentDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\nversion: 1.0.0\ndescription: ${name}\n---\nBody`,
    'utf-8'
  );
  return dir;
}

// Full import logic mirroring integration-import.test.ts, with --agent support
function doImport(options: { agent?: string; force?: boolean; dryRun?: boolean; lint?: boolean } = {}) {
  const reg = loadRegistry(hubDir);
  const skillsDir = getSkillsPath(hubDir);
  const agents = Object.values(reg.agents).filter((a) =>
    options.agent ? a.name === options.agent : a.available
  );
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

      if (alreadyExists && !options.force) { skipped.push(name); continue; }
      if (options.lint) {
        const result = lintSkill(srcDir);
        if (!result.valid) { skipped.push(name); continue; }
      }
      if (options.dryRun) { imported.push(name); continue; }

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

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillstash-agent-filter-'));
  hubDir = path.join(tmpDir, 'hub');
  agentADir = path.join(tmpDir, 'agent-a', 'skills');
  agentBDir = path.join(tmpDir, 'agent-b', 'skills');
  fs.mkdirSync(agentADir, { recursive: true });
  fs.mkdirSync(agentBDir, { recursive: true });

  initHub(hubDir);
  const reg = loadRegistry(hubDir);
  reg.agents = {};
  addAgentToRegistry(reg, 'agent-a', { name: 'agent-a', skillsPath: agentADir, linkType: 'copy', available: true });
  addAgentToRegistry(reg, 'agent-b', { name: 'agent-b', skillsPath: agentBDir, linkType: 'copy', available: true });
  saveRegistry(reg, hubDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('import --agent: scans only the specified agent', () => {
  it('imports only from the target agent, ignores other agents', () => {
    makeSkillDir(agentADir, 'skill-from-a');
    makeSkillDir(agentBDir, 'skill-from-b');

    const { imported } = doImport({ agent: 'agent-a' });

    expect(imported).toContain('skill-from-a');
    expect(imported).not.toContain('skill-from-b');
  });

  it('does not touch registry entries from the ignored agent', () => {
    makeSkillDir(agentADir, 'skill-from-a');
    makeSkillDir(agentBDir, 'skill-from-b');

    doImport({ agent: 'agent-a' });

    const reg = loadRegistry(hubDir);
    expect(reg.skills['skill-from-a']).toBeDefined();
    expect(reg.skills['skill-from-b']).toBeUndefined();
  });

  it('imports all agents when --agent is not specified', () => {
    makeSkillDir(agentADir, 'skill-from-a');
    makeSkillDir(agentBDir, 'skill-from-b');

    const { imported } = doImport();

    expect(imported).toContain('skill-from-a');
    expect(imported).toContain('skill-from-b');
  });

  it('returns empty imported list when target agent has no skills', () => {
    // agent-a has no skills
    makeSkillDir(agentBDir, 'skill-from-b');

    const { imported } = doImport({ agent: 'agent-a' });
    expect(imported).toHaveLength(0);
  });

  it('returns empty imported list when target agent name does not match', () => {
    makeSkillDir(agentADir, 'skill-from-a');

    const { imported } = doImport({ agent: 'nonexistent-agent' });
    expect(imported).toHaveLength(0);
  });
});
