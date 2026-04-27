import * as path from 'node:path';
import * as fs from 'node:fs';
import { logger } from './logger.js';
import { t } from '../i18n/index.js';

const LOCK_FILE = '.lock';
const STALE_LOCK_MS = 30_000;

interface LockContent {
  pid: number;
  timestamp: number;
}

function lockPath(hubPath: string): string {
  return path.join(hubPath, LOCK_FILE);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tryAcquire(lp: string): boolean {
  try {
    const content: LockContent = { pid: process.pid, timestamp: Date.now() };
    // wx flag: exclusive create — fails if file already exists
    fs.writeFileSync(lp, JSON.stringify(content), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

function isLockStale(lp: string): boolean {
  try {
    const raw = fs.readFileSync(lp, 'utf-8');
    const data = JSON.parse(raw);
    if (typeof data.pid !== 'number' || typeof data.timestamp !== 'number') return true;
    if (Date.now() - data.timestamp > STALE_LOCK_MS) return true;
    if (!isProcessAlive(data.pid)) return true;
    return false;
  } catch {
    return true;
  }
}

function removeLock(lp: string): void {
  try {
    fs.unlinkSync(lp);
  } catch { /* best effort */ }
}

function syncSleep(ms: number): void {
  // Atomics.wait blocks the thread without burning CPU (unlike a busy-wait loop)
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function acquireLock(hubPath: string, timeoutMs = 10_000): (() => void) | null {
  const lp = lockPath(hubPath);
  const deadline = Date.now() + timeoutMs;
  let delay = 50;

  while (Date.now() < deadline) {
    if (tryAcquire(lp)) {
      return () => removeLock(lp);
    }
    // Check for stale lock and remove it
    if (isLockStale(lp)) {
      removeLock(lp);
      if (tryAcquire(lp)) {
        return () => removeLock(lp);
      }
    }
    syncSleep(Math.min(delay, 500));
    delay = Math.min(delay * 2, 500);
  }

  return null;
}

export function withLock<T>(hubPath: string, fn: () => T): T | null {
  const release = acquireLock(hubPath);
  if (!release) {
    logger.error(t('common.lockFailed'));
    logger.warn(t('common.lockTimeout', { ms: 10_000, path: hubPath }));
    return null;
  }
  try {
    return fn();
  } finally {
    release();
  }
}
