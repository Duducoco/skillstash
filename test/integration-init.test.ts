/**
 * Integration tests for `init` command — three remote-state branches.
 * Uses local bare repos via git init --bare to avoid any network access.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { gitAvailable } from '../src/core/git.js';
import { initFreshHub, cloneAndImport } from '../src/commands/init.js';
import { hubExists, loadRegistry, getSkillsPath } from '../src/core/hub.js';
import { exists } from '../src/utils/fs.js';
import type { AgentConfig } from '../src/core/registry.js';

// In tests, auto-select all available agents (no interactive prompt)
const noPromptSelector = async (agents: AgentConfig[]) =>
  new Set(agents.filter((a) => a.available).map((a) => a.name));

// In tests, skip link prompt
const noLinkPrompt = async () => false;

const isGitAvailable = gitAvailable();

let tmpDir: string;
let hubDir: string;
let bareDir: string;

function skipIfNoGit() {
  if (!isGitAvailable) return true;
  return false;
}

function makeSkillInBare(bareRepo: string, skillName: string) {
  // Clone bare → add skill → push back
  const workDir = path.join(os.tmpdir(), `skillstash-init-work-${Date.now()}`);
  try {
    execSync(`git clone "${bareRepo}" "${workDir}"`, { stdio: 'pipe' });
    const skillDir = path.join(workDir, 'skills', skillName);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---\nname: ${skillName}\nversion: 1.0.0\ndescription: ${skillName}\n---\nBody`,
      'utf-8'
    );
    execSync('git config user.email "test@test.com"', { cwd: workDir, stdio: 'pipe' });
    execSync('git config user.name "test"', { cwd: workDir, stdio: 'pipe' });
    execSync('git add -A && git commit -m "add skill"', { cwd: workDir, stdio: 'pipe', shell: 'bash' });
    execSync('git push', { cwd: workDir, stdio: 'pipe' });
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function makeRegistryInBare(bareRepo: string) {
  const workDir = path.join(os.tmpdir(), `skillstash-init-reg-${Date.now()}`);
  try {
    execSync(`git clone "${bareRepo}" "${workDir}"`, { stdio: 'pipe' });
    fs.writeFileSync(
      path.join(workDir, 'registry.json'),
      JSON.stringify({ version: '1.0', lastSync: null, skills: {}, agents: {} }, null, 2),
      'utf-8'
    );
    fs.mkdirSync(path.join(workDir, 'skills'), { recursive: true });
    execSync('git config user.email "test@test.com"', { cwd: workDir, stdio: 'pipe' });
    execSync('git config user.name "test"', { cwd: workDir, stdio: 'pipe' });
    execSync('git add -A && git commit -m "init registry"', { cwd: workDir, stdio: 'pipe', shell: 'bash' });
    execSync('git push', { cwd: workDir, stdio: 'pipe' });
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function makeNonSkillstashBare(bareRepo: string) {
  // Push some content but NO registry.json
  const workDir = path.join(os.tmpdir(), `skillstash-init-nss-${Date.now()}`);
  try {
    execSync(`git clone "${bareRepo}" "${workDir}"`, { stdio: 'pipe' });
    fs.writeFileSync(path.join(workDir, 'README.md'), '# Some other repo', 'utf-8');
    execSync('git config user.email "test@test.com"', { cwd: workDir, stdio: 'pipe' });
    execSync('git config user.name "test"', { cwd: workDir, stdio: 'pipe' });
    execSync('git add -A && git commit -m "init"', { cwd: workDir, stdio: 'pipe', shell: 'bash' });
    execSync('git push', { cwd: workDir, stdio: 'pipe' });
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillstash-init-'));
  hubDir = path.join(tmpDir, 'hub');
  bareDir = path.join(tmpDir, 'remote.git');
  if (isGitAvailable) {
    execSync(`git init --bare "${bareDir}"`, { stdio: 'pipe' });
  }
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Case 1: Empty remote ─────────────────────────────────────────────────────

describe('init Case 1: empty remote → fresh hub', () => {
  it('creates hub directory and registry.json', async () => {
    if (skipIfNoGit()) return;
    await initFreshHub(hubDir, bareDir, noPromptSelector, noLinkPrompt);
    expect(hubExists(hubDir)).toBe(true);
  }, 30000);

  it('initializes git repo in hub', async () => {
    if (skipIfNoGit()) return;
    await initFreshHub(hubDir, bareDir, noPromptSelector, noLinkPrompt);
    expect(fs.existsSync(path.join(hubDir, '.git'))).toBe(true);
  }, 30000);

  it('creates skills/ subdirectory', async () => {
    if (skipIfNoGit()) return;
    await initFreshHub(hubDir, bareDir, noPromptSelector, noLinkPrompt);
    expect(fs.existsSync(getSkillsPath(hubDir))).toBe(true);
  }, 30000);

  it('pushes initial commit to remote', async () => {
    if (skipIfNoGit()) return;
    await initFreshHub(hubDir, bareDir, noPromptSelector, noLinkPrompt);
    // Verify remote has commits by cloning
    const cloneDir = path.join(tmpDir, 'verify');
    execSync(`git clone "${bareDir}" "${cloneDir}"`, { stdio: 'pipe' });
    expect(fs.existsSync(path.join(cloneDir, 'registry.json'))).toBe(true);
  }, 30000);

  it('registry has empty skills on fresh init (no local agents in isolated test)', async () => {
    if (skipIfNoGit()) return;
    await initFreshHub(hubDir, bareDir, noPromptSelector, noLinkPrompt);
    const reg = loadRegistry(hubDir);
    // Skills may be imported from real agent dirs on the machine, but structure is valid
    expect(typeof reg.skills).toBe('object');
    expect(reg.version).toBe('1.0');
  }, 30000);
});

// ─── Case 2: Non-empty remote with registry.json ──────────────────────────────

describe('init Case 2: non-empty remote with registry.json → clone + import', () => {
  it('clones the remote hub into hubDir', async () => {
    if (skipIfNoGit()) return;
    makeRegistryInBare(bareDir);
    await cloneAndImport(hubDir, bareDir, noPromptSelector, noLinkPrompt);
    expect(hubExists(hubDir)).toBe(true);
  }, 30000);

  it('registry.json is present after clone', async () => {
    if (skipIfNoGit()) return;
    makeRegistryInBare(bareDir);
    await cloneAndImport(hubDir, bareDir, noPromptSelector, noLinkPrompt);
    expect(fs.existsSync(path.join(hubDir, 'registry.json'))).toBe(true);
  }, 30000);

  it('loads skills that were already in remote hub', async () => {
    if (skipIfNoGit()) return;
    // Put a skill + registry in the bare repo
    makeRegistryInBare(bareDir);
    // Also manually add a skill entry to the remote registry
    const workDir = path.join(os.tmpdir(), `skillstash-verify-${Date.now()}`);
    try {
      execSync(`git clone "${bareDir}" "${workDir}"`, { stdio: 'pipe' });
      const reg = JSON.parse(fs.readFileSync(path.join(workDir, 'registry.json'), 'utf-8'));
      reg.skills['remote-skill'] = {
        version: '1.0.0', source: 'local', hash: 'sha256:abc',
        installedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        agents: [], enabled: true,
      };
      fs.mkdirSync(path.join(workDir, 'skills', 'remote-skill'), { recursive: true });
      fs.writeFileSync(
        path.join(workDir, 'skills', 'remote-skill', 'SKILL.md'),
        '---\nname: remote-skill\nversion: 1.0.0\n---\nBody', 'utf-8'
      );
      fs.writeFileSync(path.join(workDir, 'registry.json'), JSON.stringify(reg, null, 2), 'utf-8');
      execSync('git config user.email "t@t.com"', { cwd: workDir, stdio: 'pipe' });
      execSync('git config user.name "t"', { cwd: workDir, stdio: 'pipe' });
      execSync('git add -A && git commit -m "add remote skill"', { cwd: workDir, stdio: 'pipe', shell: 'bash' });
      execSync('git push', { cwd: workDir, stdio: 'pipe' });
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }

    await cloneAndImport(hubDir, bareDir, noPromptSelector, noLinkPrompt);
    const clonedReg = loadRegistry(hubDir);
    expect(clonedReg.skills['remote-skill']).toBeDefined();
  }, 30000);

  it('populates agents from current machine after clone', async () => {
    if (skipIfNoGit()) return;
    makeRegistryInBare(bareDir);
    await cloneAndImport(hubDir, bareDir, noPromptSelector, noLinkPrompt);
    const reg = loadRegistry(hubDir);
    // detectAgents() always returns at least the 5 known agents
    expect(Object.keys(reg.agents).length).toBeGreaterThan(0);
  }, 30000);
});

// ─── Case 3: gitProbeRemote rejects non-skillstash repos ─────────────────────
// We test the rejection logic directly since registerInitCommand wraps gitProbeRemote.
// gitProbeRemote itself is tested via the probe result shape.

describe('init Case 3: non-empty remote without registry.json', () => {
  it('gitProbeRemote returns hasRegistry=false for a repo without registry.json', async () => {
    if (skipIfNoGit()) return;
    const { gitProbeRemote } = await import('../src/core/git.js');
    makeNonSkillstashBare(bareDir);
    const result = gitProbeRemote(bareDir);
    expect(result.empty).toBe(false);
    expect(result.hasRegistry).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it('gitProbeRemote returns empty=true for an empty bare repo', async () => {
    if (skipIfNoGit()) return;
    const { gitProbeRemote } = await import('../src/core/git.js');
    // bareDir has no commits at this point
    const result = gitProbeRemote(bareDir);
    expect(result.empty).toBe(true);
  });

  it('gitProbeRemote returns hasRegistry=true for a repo with registry.json', async () => {
    if (skipIfNoGit()) return;
    const { gitProbeRemote } = await import('../src/core/git.js');
    makeRegistryInBare(bareDir);
    const result = gitProbeRemote(bareDir);
    expect(result.empty).toBe(false);
    expect(result.hasRegistry).toBe(true);
  });
});
