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
  const tmpDir = path.join(os.tmpdir(), `skillstash-probe-${Date.now()}`);

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
    execSync('git config user.name "skillstash"', { cwd: hubPath, stdio: 'pipe' });
  }
  try {
    execSync('git config user.email', { cwd: hubPath, stdio: 'pipe' });
  } catch {
    execSync('git config user.email "skillstash@local"', { cwd: hubPath, stdio: 'pipe' });
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
 * Fetch from remote without modifying working tree
 */
export function gitFetch(hubPath: string): boolean {
  if (!gitAvailable()) return false;
  try {
    execSync('git fetch origin', { cwd: hubPath, stdio: 'pipe', timeout: 60_000 });
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
    }).toString().trim() || null;
  } catch {
    return null;
  }
}

/**
 * Return the content of a file at a specific git ref.
 * filePath must use forward slashes (e.g. 'registry.json').
 * Returns null if the file doesn't exist at that ref.
 */
export function gitShowFileContent(hubPath: string, ref: string, filePath: string): string | null {
  if (!gitAvailable()) return null;
  try {
    return execSync(`git show ${ref}:${filePath}`, {
      cwd: hubPath,
      stdio: 'pipe',
    }).toString();
  } catch {
    return null;
  }
}

/**
 * Attempt a merge without committing (--no-commit --no-ff).
 * Returns true if merge completed with no conflicts, false if conflicts exist.
 */
export function gitMergeNoCommit(hubPath: string, ref: string): boolean {
  if (!gitAvailable()) return false;
  try {
    execSync(`git merge --no-commit --no-ff ${ref}`, { cwd: hubPath, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fast-forward merge using FETCH_HEAD.
 */
export function gitMergeFFOnly(hubPath: string): boolean {
  if (!gitAvailable()) return false;
  try {
    execSync('git merge --ff-only FETCH_HEAD', { cwd: hubPath, stdio: 'pipe' });
    return true;
  } catch (e) {
    logger.warn(`Fast-forward merge failed: ${(e as Error).message}`);
    return false;
  }
}

/**
 * Abort an in-progress merge.
 */
export function gitMergeAbort(hubPath: string): void {
  if (!gitAvailable()) return;
  try {
    execSync('git merge --abort', { cwd: hubPath, stdio: 'pipe' });
  } catch { /* best effort */ }
}

/**
 * Check if the repo is currently in MERGING state (.git/MERGE_HEAD exists).
 */
export function gitIsInMergeState(hubPath: string): boolean {
  return fs.existsSync(path.join(hubPath, '.git', 'MERGE_HEAD'));
}

/**
 * List files that have merge conflicts.
 * Uses --diff-filter=UUDA to catch both-modified (UU) and delete/modify (DU, UD, DA) conflicts.
 */
export function gitListConflictedFiles(hubPath: string): string[] {
  if (!gitAvailable()) return [];
  try {
    const out = execSync('git diff --name-only --diff-filter=UUDA', {
      cwd: hubPath,
      stdio: 'pipe',
    }).toString().trim();
    return out ? out.split('\n').filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Checkout the "ours" version of a conflicted file.
 * gitPath must use forward slashes.
 */
export function gitCheckoutOurs(hubPath: string, gitPath: string): void {
  if (!gitAvailable()) return;
  try {
    execSync(`git checkout --ours -- "${gitPath}"`, { cwd: hubPath, stdio: 'pipe' });
  } catch (e) {
    logger.warn(`checkout --ours failed for ${gitPath}: ${(e as Error).message}`);
  }
}

/**
 * Checkout the "theirs" version of a conflicted file.
 * gitPath must use forward slashes.
 */
export function gitCheckoutTheirs(hubPath: string, gitPath: string): void {
  if (!gitAvailable()) return;
  try {
    execSync(`git checkout --theirs -- "${gitPath}"`, { cwd: hubPath, stdio: 'pipe' });
  } catch (e) {
    logger.warn(`checkout --theirs failed for ${gitPath}: ${(e as Error).message}`);
  }
}

/**
 * Stage a specific file path.
 * gitPath must use forward slashes.
 */
export function gitStagePath(hubPath: string, gitPath: string): void {
  if (!gitAvailable()) return;
  try {
    execSync(`git add "${gitPath}"`, { cwd: hubPath, stdio: 'pipe' });
  } catch (e) {
    logger.warn(`git add failed for ${gitPath}: ${(e as Error).message}`);
  }
}

/**
 * Commit the current staged state (does NOT run git add -A).
 * Use this when in MERGING state to avoid staging unresolved conflict markers.
 */
export function gitCommitMerge(hubPath: string, message: string): boolean {
  if (!gitAvailable()) return false;
  try {
    ensureGitUser(hubPath);
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: hubPath,
      stdio: 'pipe',
    });
    return true;
  } catch (e) {
    logger.warn(`Git merge commit failed: ${(e as Error).message}`);
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

  const tmpDir = path.join(os.tmpdir(), `skillstash-gh-${Date.now()}`);
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
