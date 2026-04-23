import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { logger } from '../utils/logger.js';

/**
 * Check if git is available
 */
export function gitAvailable(): boolean {
  try {
    execSync('git --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Initialize a git repo in the hub directory
 */
export function gitInit(hubPath: string): boolean {
  if (!gitAvailable()) {
    logger.warn('Git not found, skipping repo initialization');
    return false;
  }

  try {
    if (!fs.existsSync(path.join(hubPath, '.git'))) {
      execSync('git init', { cwd: hubPath, stdio: 'pipe' });
      logger.success('Initialized git repository in hub');
    }
    return true;
  } catch (e) {
    logger.warn(`Git init failed: ${(e as Error).message}`);
    return false;
  }
}

/**
 * Check if a remote repository is empty (has no commits).
 * Uses `git ls-remote` to detect — an empty repo returns nothing on stdout.
 * Returns: { empty: boolean, hasRegistry: boolean, error?: string }
 */
export function gitProbeRemote(remoteUrl: string): { empty: boolean; hasRegistry: boolean; error?: string } {
  if (!gitAvailable()) {
    return { empty: false, hasRegistry: false, error: 'Git not available' };
  }

  try {
    // ls-remote exits with code 0 even on empty repos, but stdout is empty
    const output = execSync(`git ls-remote "${remoteUrl}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
      timeout: 30_000,
    }).trim();

    // Empty repo: no refs at all
    if (!output) {
      return { empty: true, hasRegistry: false };
    }

    // Non-empty repo: check if registry.json exists via shallow clone probe
    const hasRegistry = gitRemoteHasFile(remoteUrl, 'registry.json');
    return { empty: false, hasRegistry };
  } catch (e) {
    const msg = (e as Error).message;
    return { empty: false, hasRegistry: false, error: msg };
  }
}

/**
 * Check if a specific file exists in the remote repo by doing a shallow clone to temp dir.
 * Used to verify registry.json presence before full clone.
 */
function gitRemoteHasFile(remoteUrl: string, filePath: string): boolean {
  const tmpDir = path.join(os.tmpdir(), `skill-sync-probe-${Date.now()}`);

  try {
    // Shallow clone with depth 1
    execSync(`git clone --depth 1 "${remoteUrl}" "${tmpDir}"`, {
      stdio: 'pipe',
      timeout: 60_000,
    });

    const exists = fs.existsSync(path.join(tmpDir, filePath));

    // Cleanup
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* best effort */ }

    return exists;
  } catch {
    // Cleanup on failure
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* best effort */ }
    return false;
  }
}

/**
 * Clone a remote repo to the hub path.
 * If the target directory exists and is non-empty, this will fail.
 */
export function gitClone(remoteUrl: string, hubPath: string): boolean {
  if (!gitAvailable()) return false;

  try {
    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(hubPath), { recursive: true });

    execSync(`git clone "${remoteUrl}" "${hubPath}"`, {
      stdio: 'pipe',
      timeout: 120_000,
    });
    return true;
  } catch (e) {
    logger.warn(`Git clone failed: ${(e as Error).message}`);
    return false;
  }
}

/**
 * Add a remote named 'origin' to the local repo.
 */
export function gitAddRemote(hubPath: string, remoteUrl: string): boolean {
  if (!gitAvailable()) return false;

  try {
    execSync(`git remote add origin "${remoteUrl}"`, { cwd: hubPath, stdio: 'pipe' });
    return true;
  } catch (e) {
    // Remote might already exist — try set-url instead
    try {
      execSync(`git remote set-url origin "${remoteUrl}"`, { cwd: hubPath, stdio: 'pipe' });
      return true;
    } catch (e2) {
      logger.warn(`Failed to add/set remote: ${(e2 as Error).message}`);
      return false;
    }
  }
}

/**
 * Initial push: set upstream and push.
 */
export function gitPushSetUpstream(hubPath: string, branch: string = 'main'): boolean {
  if (!gitAvailable()) return false;

  try {
    // Ensure we're on the right branch
    const current = currentBranch(hubPath) || 'master';
    const pushBranch = current;
    execSync(`git push -u origin ${pushBranch}`, { cwd: hubPath, stdio: 'pipe', timeout: 60_000 });
    return true;
  } catch (e) {
    logger.warn(`Git push -u origin failed: ${(e as Error).message}`);
    return false;
  }
}

/**
 * Ensure git user.name and user.email are set (local to this repo only)
 */
function ensureGitUser(hubPath: string): void {
  try {
    execSync('git config user.name', { cwd: hubPath, stdio: 'pipe' });
  } catch {
    execSync('git config user.name "skill-sync"', { cwd: hubPath, stdio: 'pipe' });
  }
  try {
    execSync('git config user.email', { cwd: hubPath, stdio: 'pipe' });
  } catch {
    execSync('git config user.email "skill-sync@local"', { cwd: hubPath, stdio: 'pipe' });
  }
}

/**
 * Stage and commit all changes
 */
export function gitCommit(hubPath: string, message: string): boolean {
  if (!gitAvailable()) return false;

  try {
    ensureGitUser(hubPath);
    execSync('git add -A', { cwd: hubPath, stdio: 'pipe' });
    // Check if there's anything to commit
    try {
      execSync('git diff --cached --quiet', { cwd: hubPath, stdio: 'pipe' });
      return true; // nothing to commit
    } catch {
      // there are changes
    }
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: hubPath,
      stdio: 'pipe',
    });
    return true;
  } catch (e) {
    logger.warn(`Git commit failed: ${(e as Error).message}`);
    return false;
  }
}

/**
 * Pull from remote
 */
export function gitPull(hubPath: string): boolean {
  if (!gitAvailable()) return false;

  try {
    execSync('git pull', { cwd: hubPath, stdio: 'pipe' });
    return true;
  } catch (e) {
    logger.warn(`Git pull failed: ${(e as Error).message}`);
    return false;
  }
}

/**
 * Push to remote
 */
export function gitPush(hubPath: string): boolean {
  if (!gitAvailable()) return false;

  try {
    execSync('git push', { cwd: hubPath, stdio: 'pipe' });
    return true;
  } catch (e) {
    logger.warn(`Git push failed: ${(e as Error).message}`);
    return false;
  }
}

/**
 * Check if remote is configured
 */
export function hasRemote(hubPath: string): boolean {
  if (!gitAvailable()) return false;

  try {
    execSync('git remote', { cwd: hubPath, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get current branch name
 */
export function currentBranch(hubPath: string): string | null {
  if (!gitAvailable()) return null;

  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: hubPath,
      stdio: 'pipe',
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

/**
 * Shallow clone a remote repo to a temp directory and return the temp path.
 * Returns null on failure. Caller is responsible for cleanup.
 */
export function gitShallowClone(remoteUrl: string): string | null {
  if (!gitAvailable()) return null;

  const tmpDir = path.join(os.tmpdir(), `skill-sync-gh-${Date.now()}`);
  try {
    execSync(`git clone --depth 1 "${remoteUrl}" "${tmpDir}"`, {
      stdio: 'pipe',
      timeout: 120_000,
    });
    return tmpDir;
  } catch (e) {
    logger.warn(`Git shallow clone failed: ${(e as Error).message}`);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* best effort */ }
    return null;
  }
}

/**
 * Get short status
 */
export function gitStatus(hubPath: string): string {
  if (!gitAvailable()) return 'git not available';

  try {
    return execSync('git status --short', { cwd: hubPath, stdio: 'pipe' })
      .toString()
      .trim();
  } catch {
    return 'unable to get status';
  }
}
