/**
 * Integration tests for `skillstash add-remote` command.
 * Uses local bare repos to avoid network access.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { gitAvailable, gitInit, gitCommit } from '../src/core/git.js';
import { initHub, loadLocalState } from '../src/core/hub.js';
import { hasRemote } from '../src/core/git.js';

const isGitAvailable = gitAvailable();

let tmpDir: string;
let hubDir: string;
let bareDir: string;

function skipIfNoGit() { return !isGitAvailable; }

function rmWithRetry(target: string) {
  for (let i = 0; i < 5; i++) {
    try { fs.rmSync(target, { recursive: true, force: true }); return; } catch { /* retry */ }
  }
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillstash-addremote-'));
  hubDir = path.join(tmpDir, 'skills-hub');
  bareDir = path.join(tmpDir, 'remote.git');
  if (isGitAvailable) {
    execSync(`git init --bare "${bareDir}"`, { stdio: 'pipe' });
  }
});

afterEach(() => {
  rmWithRetry(tmpDir);
});

describe('add-remote: core git operations', () => {
  it('hasRemote returns false on fresh local hub (no remote configured)', () => {
    if (skipIfNoGit()) return;
    initHub(hubDir);
    gitInit(hubDir);
    gitCommit(hubDir, 'init: initial commit');
    expect(hasRemote(hubDir)).toBe(false);
  }, 15000);

  it('hasRemote returns true after gitAddRemote', async () => {
    if (skipIfNoGit()) return;
    const { gitAddRemote } = await import('../src/core/git.js');
    initHub(hubDir);
    gitInit(hubDir);
    gitCommit(hubDir, 'init: initial commit');
    gitAddRemote(hubDir, bareDir);
    expect(hasRemote(hubDir)).toBe(true);
  }, 15000);

  it('gitPushSetUpstream pushes to bare remote and remote has commits', async () => {
    if (skipIfNoGit()) return;
    const { gitAddRemote, gitPushSetUpstream } = await import('../src/core/git.js');
    initHub(hubDir);
    gitInit(hubDir);
    gitCommit(hubDir, 'init: initial commit');
    gitAddRemote(hubDir, bareDir);
    const pushed = gitPushSetUpstream(hubDir);
    expect(pushed).toBe(true);

    // Verify bare repo has the commit
    const cloneDir = path.join(tmpDir, 'verify');
    execSync(`git clone "${bareDir}" "${cloneDir}"`, { stdio: 'pipe' });
    expect(fs.existsSync(path.join(cloneDir, 'registry.json'))).toBe(true);
  }, 15000);
});

describe('add-remote: guard conditions', () => {
  it('hasRemote returns false before remote is added', () => {
    if (skipIfNoGit()) return;
    initHub(hubDir);
    gitInit(hubDir);
    expect(hasRemote(hubDir)).toBe(false);
  });

  it('hasRemote returns true when remote already exists — prevents duplicate add', async () => {
    if (skipIfNoGit()) return;
    const { gitAddRemote } = await import('../src/core/git.js');
    initHub(hubDir);
    gitInit(hubDir);
    gitCommit(hubDir, 'init');
    gitAddRemote(hubDir, bareDir);
    // Simulate what add-remote command checks: if hasRemote → reject
    expect(hasRemote(hubDir)).toBe(true);
  });
});
