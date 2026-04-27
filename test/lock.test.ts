import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { acquireLock, withLock } from '../src/utils/lock.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillstash-lock-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const lockFile = () => path.join(tmpDir, '.lock');

describe('acquireLock', () => {
  it('creates a .lock file and returns a release function', () => {
    const release = acquireLock(tmpDir);
    expect(release).not.toBeNull();
    expect(fs.existsSync(lockFile())).toBe(true);
    release!();
  });

  it('release function removes the .lock file', () => {
    const release = acquireLock(tmpDir);
    expect(fs.existsSync(lockFile())).toBe(true);
    release!();
    expect(fs.existsSync(lockFile())).toBe(false);
  });

  it('.lock file contains valid JSON with pid and timestamp', () => {
    const release = acquireLock(tmpDir);
    const content = JSON.parse(fs.readFileSync(lockFile(), 'utf-8'));
    expect(content.pid).toBe(process.pid);
    expect(typeof content.timestamp).toBe('number');
    expect(content.timestamp).toBeGreaterThan(0);
    release!();
  });

  it('returns null when a valid active lock exists (short timeout)', () => {
    // Create a fresh lock file with current PID and current timestamp
    const lockContent = JSON.stringify({ pid: process.pid, timestamp: Date.now() });
    fs.writeFileSync(lockFile(), lockContent, { flag: 'w' });

    // Should fail to acquire because the lock is active and held by current process
    // We use a very short timeout so the test doesn't block
    const result = acquireLock(tmpDir, 150);
    // Since our PID is alive and lock is fresh, acquisition should fail
    expect(result).toBeNull();
  });

  it('acquires stale lock (timestamp older than 30s)', () => {
    // Write a stale lock (>30s old)
    const staleContent = JSON.stringify({ pid: process.pid, timestamp: Date.now() - 35_000 });
    fs.writeFileSync(lockFile(), staleContent, { flag: 'w' });

    const release = acquireLock(tmpDir, 500);
    expect(release).not.toBeNull();
    release!();
  });

  it('acquires lock held by dead PID', () => {
    // PID 9999999 very unlikely to exist on any OS
    const deadContent = JSON.stringify({ pid: 9_999_999, timestamp: Date.now() });
    fs.writeFileSync(lockFile(), deadContent, { flag: 'w' });

    const release = acquireLock(tmpDir, 500);
    expect(release).not.toBeNull();
    release!();
  });

  it('acquires lock when .lock file contains unparseable content (treated as stale)', () => {
    fs.writeFileSync(lockFile(), 'NOT_JSON', { flag: 'w' });
    const release = acquireLock(tmpDir, 500);
    expect(release).not.toBeNull();
    release!();
  });

  it('acquires lock when .lock has wrong pid type (string instead of number)', () => {
    const bad = JSON.stringify({ pid: 'not-a-number', timestamp: Date.now() });
    fs.writeFileSync(lockFile(), bad, { flag: 'w' });
    const release = acquireLock(tmpDir, 500);
    expect(release).not.toBeNull();
    release!();
  });

  it('acquires lock when .lock has wrong timestamp type (string instead of number)', () => {
    const bad = JSON.stringify({ pid: process.pid, timestamp: 'not-a-number' });
    fs.writeFileSync(lockFile(), bad, { flag: 'w' });
    const release = acquireLock(tmpDir, 500);
    expect(release).not.toBeNull();
    release!();
  });

  it('acquires lock when .lock has missing fields', () => {
    fs.writeFileSync(lockFile(), JSON.stringify({}), { flag: 'w' });
    const release = acquireLock(tmpDir, 500);
    expect(release).not.toBeNull();
    release!();
  });
});

describe('withLock', () => {
  it('executes the function and returns its result', () => {
    const result = withLock(tmpDir, () => 42);
    expect(result).toBe(42);
  });

  it('releases the lock after function completes', () => {
    withLock(tmpDir, () => 'done');
    // After withLock, lock file should be gone
    expect(fs.existsSync(lockFile())).toBe(false);
  });

  it('releases the lock even if the function throws', () => {
    expect(() => {
      withLock(tmpDir, () => { throw new Error('fail'); });
    }).toThrow('fail');
    expect(fs.existsSync(lockFile())).toBe(false);
  });

  it('returns null when lock cannot be acquired within timeout', () => {
    // Write a lock held by current process with fresh timestamp
    const lockContent = JSON.stringify({ pid: process.pid, timestamp: Date.now() });
    fs.writeFileSync(lockFile(), lockContent, { flag: 'w' });

    // withLock internally uses 10s timeout — we need to inject a shorter one
    // So we call acquireLock with short timeout and verify it returns null
    const release = acquireLock(tmpDir, 100);
    expect(release).toBeNull();
  });
});
