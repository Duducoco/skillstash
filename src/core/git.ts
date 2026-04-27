import { execSync, execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { logger } from '../utils/logger.js';

/**
 * Check if git is available
 */
export function gitAvailable(): boolean {
  try {
    execSync('git --version', { stdio: 'pipe', timeout: 10_000 });
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
      execSync('git init', { cwd: hubPath, stdio: 'pipe', timeout: 10_000 });
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
    const output = execFileSync('git', ['ls-remote', remoteUrl], {
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
  const tmpDir = path.join(os.tmpdir(), `skillstash-probe-${Date.now()}`);

  try {
    // Shallow clone with depth 1
    execFileSync('git', ['clone', '--depth', '1', remoteUrl, tmpDir], {
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

    execFileSync('git', ['clone', remoteUrl, hubPath], {
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
    execFileSync('git', ['remote', 'add', 'origin', remoteUrl], { cwd: hubPath, stdio: 'pipe', timeout: 15_000 });
    return true;
  } catch (e) {
    // Remote might already exist — try set-url instead
    try {
      execFileSync('git', ['remote', 'set-url', 'origin', remoteUrl], { cwd: hubPath, stdio: 'pipe', timeout: 15_000 });
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
    execSync('git config user.name', { cwd: hubPath, stdio: 'pipe', timeout: 10_000 });
  } catch {
    execSync('git config user.name "skillstash"', { cwd: hubPath, stdio: 'pipe', timeout: 10_000 });
  }
  try {
    execSync('git config user.email', { cwd: hubPath, stdio: 'pipe', timeout: 10_000 });
  } catch {
    execSync('git config user.email "skillstash@local"', { cwd: hubPath, stdio: 'pipe', timeout: 10_000 });
  }
}

/**
 * Stage and commit all changes
 */
export function gitCommit(hubPath: string, message: string): boolean {
  if (!gitAvailable()) return false;

  try {
    ensureGitUser(hubPath);
    execSync('git add -A', { cwd: hubPath, stdio: 'pipe', timeout: 30_000 });
    // Check if there's anything to commit
    try {
      execSync('git diff --cached --quiet', { cwd: hubPath, stdio: 'pipe', timeout: 10_000 });
      return true; // nothing to commit
    } catch {
      // there are changes
    }
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: hubPath,
      stdio: 'pipe',
      timeout: 30_000,
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
export function gitPull(hubPath: string, onProgress?: (msg: string) => void): boolean {
  if (!gitAvailable()) return false;

  try {
    onProgress?.('git pull: starting...');
    execSync('git pull', { cwd: hubPath, stdio: 'pipe', timeout: 60_000 });
    onProgress?.('git pull: complete');
    return true;
  } catch (e) {
    logger.warn(`Git pull failed: ${(e as Error).message}`);
    return false;
  }
}

/**
 * Fetch from remote without modifying working tree
 */
export function gitFetch(hubPath: string, onProgress?: (msg: string) => void): boolean {
  if (!gitAvailable()) return false;
  try {
    onProgress?.('git fetch: starting...');
    execSync('git fetch origin', { cwd: hubPath, stdio: 'pipe', timeout: 60_000 });
    onProgress?.('git fetch: complete');
    return true;
  } catch (e) {
    logger.warn(`Git fetch failed: ${(e as Error).message}`);
    return false;
  }
}

/**
 * Count commits reachable from toRef but not from fromRef.
 * Returns 0 on any error (e.g. FETCH_HEAD doesn't exist yet).
 */
export function gitRevCount(hubPath: string, fromRef: string, toRef: string): number {
  if (!gitAvailable()) return 0;
  try {
    const out = execSync(`git rev-list ${fromRef}..${toRef} --count`, {
      cwd: hubPath,
      stdio: 'pipe',
      timeout: 10_000,
    }).toString().trim();
    return parseInt(out, 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * Get the merge-base commit hash between HEAD and FETCH_HEAD.
 */
export function gitMergeBase(hubPath: string): string | null {
  if (!gitAvailable()) return null;
  try {
    return execSync('git merge-base HEAD FETCH_HEAD', {
      cwd: hubPath,
      stdio: 'pipe',
      timeout: 10_000,
    }).toString().trim() || null;
  } catch {
    return null;
  }
}

export function gitShowFileContent(hubPath: string, ref: string, filePath: string): string | null {
  if (!gitAvailable()) return null;
  try {
    return execSync(`git show ${ref}:${filePath}`, {
      cwd: hubPath,
      stdio: 'pipe',
      timeout: 10_000,
    }).toString();
  } catch {
    return null;
  }
}

export function gitMergeNoCommit(hubPath: string, ref: string): boolean {
  if (!gitAvailable()) return false;
  try {
    execSync(`git merge --no-commit --no-ff ${ref}`, { cwd: hubPath, stdio: 'pipe', timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

export function gitMergeFFOnly(hubPath: string): boolean {
  if (!gitAvailable()) return false;
  try {
    execSync('git merge --ff-only FETCH_HEAD', { cwd: hubPath, stdio: 'pipe', timeout: 30_000 });
    return true;
  } catch (e) {
    logger.warn(`Fast-forward merge failed: ${(e as Error).message}`);
    return false;
  }
}

export function gitMergeAbort(hubPath: string): void {
  if (!gitAvailable()) return;
  try {
    execSync('git merge --abort', { cwd: hubPath, stdio: 'pipe', timeout: 10_000 });
  } catch { /* best effort */ }
}

/**
 * Check if the repo is currently in MERGING state (.git/MERGE_HEAD exists).
 */
export function gitIsInMergeState(hubPath: string): boolean {
  return fs.existsSync(path.join(hubPath, '.git', 'MERGE_HEAD'));
}

export function gitListConflictedFiles(hubPath: string): string[] {
  if (!gitAvailable()) return [];
  try {
    const out = execSync('git diff --name-only --diff-filter=UUDA', {
      cwd: hubPath,
      stdio: 'pipe',
      timeout: 10_000,
    }).toString().trim();
    return out ? out.split('\n').filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function gitCheckoutOurs(hubPath: string, gitPath: string): void {
  if (!gitAvailable()) return;
  try {
    execSync(`git checkout --ours -- "${gitPath}"`, { cwd: hubPath, stdio: 'pipe', timeout: 10_000 });
  } catch (e) {
    logger.warn(`checkout --ours failed for ${gitPath}: ${(e as Error).message}`);
  }
}

export function gitCheckoutTheirs(hubPath: string, gitPath: string): void {
  if (!gitAvailable()) return;
  try {
    execSync(`git checkout --theirs -- "${gitPath}"`, { cwd: hubPath, stdio: 'pipe', timeout: 10_000 });
  } catch (e) {
    logger.warn(`checkout --theirs failed for ${gitPath}: ${(e as Error).message}`);
  }
}

export function gitStagePath(hubPath: string, gitPath: string): void {
  if (!gitAvailable()) return;
  try {
    execSync(`git add "${gitPath}"`, { cwd: hubPath, stdio: 'pipe', timeout: 10_000 });
  } catch (e) {
    logger.warn(`git add failed for ${gitPath}: ${(e as Error).message}`);
  }
}

export function gitCommitMerge(hubPath: string, message: string): boolean {
  if (!gitAvailable()) return false;
  try {
    ensureGitUser(hubPath);
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: hubPath,
      stdio: 'pipe',
      timeout: 30_000,
    });
    return true;
  } catch (e) {
    logger.warn(`Git merge commit failed: ${(e as Error).message}`);
    return false;
  }
}

export function gitPush(hubPath: string, onProgress?: (msg: string) => void): boolean {
  if (!gitAvailable()) return false;

  try {
    onProgress?.('git push: starting...');
    execSync('git push', { cwd: hubPath, stdio: 'pipe', timeout: 120_000 });
    onProgress?.('git push: complete');
    return true;
  } catch (e) {
    logger.warn(`Git push failed: ${(e as Error).message}`);
    return false;
  }
}

export function hasRemote(hubPath: string): boolean {
  if (!gitAvailable()) return false;

  try {
    const output = execSync('git remote', { cwd: hubPath, stdio: 'pipe', timeout: 10_000 })
      .toString()
      .trim();
    return output.length > 0;
  } catch {
    return false;
  }
}

export function currentBranch(hubPath: string): string | null {
  if (!gitAvailable()) return null;

  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: hubPath,
      stdio: 'pipe',
      timeout: 10_000,
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

export interface GitCloneResult {
  path: string | null;
  errorType?: 'not-found' | 'auth-failed' | 'timeout' | 'unknown';
  errorMessage?: string;
}

export function gitShallowClone(remoteUrl: string): GitCloneResult {
  if (!gitAvailable()) return { path: null, errorType: 'unknown', errorMessage: 'git not available' };

  const tmpDir = path.join(os.tmpdir(), `skillstash-gh-${Date.now()}`);
  try {
    execFileSync('git', ['clone', '--depth', '1', remoteUrl, tmpDir], {
      stdio: 'pipe',
      timeout: 120_000,
    });
    return { path: tmpDir };
  } catch (e) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* best effort */ }

    const stderr = (e as any).stderr?.toString() || '';
    const msg = stderr || (e as Error).message;

    let errorType: GitCloneResult['errorType'] = 'unknown';
    if (/not found|404|does not exist|repository not found/i.test(msg)) {
      errorType = 'not-found';
    } else if (/authentication failed|permission denied|could not read username/i.test(msg)) {
      errorType = 'auth-failed';
    } else if (/timed? ?out|timeout/i.test(msg)) {
      errorType = 'timeout';
    }

    return { path: null, errorType, errorMessage: msg };
  }
}

export function gitStatus(hubPath: string): string {
  if (!gitAvailable()) return 'git not available';

  try {
    return execSync('git status --short', { cwd: hubPath, stdio: 'pipe', timeout: 10_000 })
      .toString()
      .trim();
  } catch {
    return 'unable to get status';
  }
}
