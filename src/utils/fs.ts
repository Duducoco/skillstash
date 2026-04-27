import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

/**
 * Recursively copy a directory (like cp -r)
 */
export function copyDirRecursive(src: string, dest: string): void {
  if (!fs.existsSync(src)) {
    throw new Error(`Source directory does not exist: ${src}`);
  }

  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Recursively remove a directory (like rm -rf)
 */
export function removeDir(dir: string): void {
  if (!fs.existsSync(dir)) return;
  const stat = fs.lstatSync(dir);
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(dir);
    return;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const entryStat = fs.lstatSync(fullPath);
    if (entryStat.isSymbolicLink()) {
      fs.unlinkSync(fullPath);
      continue;
    }
    if (entry.isDirectory()) {
      removeDir(fullPath);
      continue;
    }
    fs.unlinkSync(fullPath);
  }
  fs.rmdirSync(dir);
}

/**
 * Compute SHA-256 hash of a directory's contents
 */
export function hashDir(dir: string): string {
  const hash = crypto.createHash('sha256');
  const files = collectFiles(dir);
  files.sort(); // deterministic order

  for (const file of files) {
    // Normalize to forward slashes so the hash is identical on Windows and Unix
    const relativePath = path.relative(dir, file).split(path.sep).join('/');
    hash.update(relativePath + '\0');
    const content = fs.readFileSync(file);
    hash.update(content);
    hash.update('\0');
  }

  return 'sha256:' + hash.digest('hex').slice(0, 16);
}

function collectFiles(dir: string): string[] {
  const result: string[] = [];
  if (!fs.existsSync(dir)) return result;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.name === '.git') continue; // skip .git
    if (entry.isDirectory()) {
      result.push(...collectFiles(fullPath));
    } else {
      result.push(fullPath);
    }
  }
  return result;
}

/**
 * Check if two directories have the same content (by hash)
 */
export function dirsEqual(dirA: string, dirB: string): boolean {
  if (!fs.existsSync(dirA) || !fs.existsSync(dirB)) return false;
  return hashDir(dirA) === hashDir(dirB);
}

/**
 * Ensure directory exists
 */
export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Check if path exists
 */
export function exists(p: string): boolean {
  return fs.existsSync(p);
}

/**
 * Read JSON file
 */
export function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
}

/**
 * Write JSON file
 */
export function writeJson(p: string, data: unknown, indent = 2): void {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(data, null, indent) + '\n', 'utf-8');
}
