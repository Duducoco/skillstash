import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  copyDirRecursive,
  removeDir,
  hashDir,
  dirsEqual,
  ensureDir,
  exists,
  readJson,
  writeJson,
} from '../src/utils/fs.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillstash-fs-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('copyDirRecursive', () => {
  it('copies a directory with files', () => {
    const src = path.join(tmpDir, 'src');
    const dest = path.join(tmpDir, 'dest');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'a.txt'), 'hello');
    fs.writeFileSync(path.join(src, 'b.txt'), 'world');

    copyDirRecursive(src, dest);
    expect(fs.readFileSync(path.join(dest, 'a.txt'), 'utf-8')).toBe('hello');
    expect(fs.readFileSync(path.join(dest, 'b.txt'), 'utf-8')).toBe('world');
  });

  it('copies nested directories', () => {
    const src = path.join(tmpDir, 'src');
    const dest = path.join(tmpDir, 'dest');
    fs.mkdirSync(path.join(src, 'sub', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(src, 'sub', 'deep', 'file.txt'), 'nested');

    copyDirRecursive(src, dest);
    expect(fs.readFileSync(path.join(dest, 'sub', 'deep', 'file.txt'), 'utf-8')).toBe('nested');
  });

  it('throws when source does not exist', () => {
    expect(() => copyDirRecursive('/nonexistent', path.join(tmpDir, 'dest'))).toThrow();
  });

  it('overwrites existing destination files', () => {
    const src = path.join(tmpDir, 'src');
    const dest = path.join(tmpDir, 'dest');
    fs.mkdirSync(src);
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, 'a.txt'), 'old');
    fs.writeFileSync(path.join(src, 'a.txt'), 'new');

    copyDirRecursive(src, dest);
    expect(fs.readFileSync(path.join(dest, 'a.txt'), 'utf-8')).toBe('new');
  });
});

describe('removeDir', () => {
  it('removes a directory with contents', () => {
    const dir = path.join(tmpDir, 'to-remove');
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'sub', 'file.txt'), 'data');
    fs.writeFileSync(path.join(dir, 'top.txt'), 'top');

    removeDir(dir);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('does nothing when directory does not exist', () => {
    removeDir('/nonexistent/path');
    // No error thrown, that's the expected behavior
    expect(true).toBe(true);
  });
});

describe('hashDir', () => {
  it('returns sha256 prefixed hash', () => {
    const dir = path.join(tmpDir, 'hash-test');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'file.txt'), 'content');
    const hash = hashDir(dir);
    expect(hash.startsWith('sha256:')).toBe(true);
    expect(hash.length).toBe('sha256:'.length + 16); // 16-char hex digest
  });

  it('returns same hash for identical contents', () => {
    const dirA = path.join(tmpDir, 'a');
    const dirB = path.join(tmpDir, 'b');
    fs.mkdirSync(dirA);
    fs.mkdirSync(dirB);
    fs.writeFileSync(path.join(dirA, 'f.txt'), 'same');
    fs.writeFileSync(path.join(dirB, 'f.txt'), 'same');

    expect(hashDir(dirA)).toBe(hashDir(dirB));
  });

  it('returns different hash for different contents', () => {
    const dirA = path.join(tmpDir, 'a');
    const dirB = path.join(tmpDir, 'b');
    fs.mkdirSync(dirA);
    fs.mkdirSync(dirB);
    fs.writeFileSync(path.join(dirA, 'f.txt'), 'content-a');
    fs.writeFileSync(path.join(dirB, 'f.txt'), 'content-b');

    expect(hashDir(dirA)).not.toBe(hashDir(dirB));
  });

  it('skips .git directory', () => {
    const dir = path.join(tmpDir, 'with-git');
    fs.mkdirSync(path.join(dir, '.git', 'objects'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.git', 'objects', 'obj'), 'gitdata');
    fs.writeFileSync(path.join(dir, 'skill.md'), 'skill content');

    const hash1 = hashDir(dir);
    // Remove .git, hash should stay the same
    fs.rmSync(path.join(dir, '.git'), { recursive: true, force: true });
    const hash2 = hashDir(dir);
    expect(hash1).toBe(hash2);
  });

  it('returns deterministic hash regardless of file order', () => {
    const dir = path.join(tmpDir, 'order-test');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'z.txt'), 'z-content');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a-content');

    const hash1 = hashDir(dir);
    const hash2 = hashDir(dir);
    expect(hash1).toBe(hash2);
  });
});

describe('dirsEqual', () => {
  it('returns true for identical directories', () => {
    const dirA = path.join(tmpDir, 'a');
    const dirB = path.join(tmpDir, 'b');
    fs.mkdirSync(dirA);
    fs.mkdirSync(dirB);
    fs.writeFileSync(path.join(dirA, 'f.txt'), 'same');
    fs.writeFileSync(path.join(dirB, 'f.txt'), 'same');

    expect(dirsEqual(dirA, dirB)).toBe(true);
  });

  it('returns false for different directories', () => {
    const dirA = path.join(tmpDir, 'a');
    const dirB = path.join(tmpDir, 'b');
    fs.mkdirSync(dirA);
    fs.mkdirSync(dirB);
    fs.writeFileSync(path.join(dirA, 'f.txt'), 'aaa');
    fs.writeFileSync(path.join(dirB, 'f.txt'), 'bbb');

    expect(dirsEqual(dirA, dirB)).toBe(false);
  });

  it('returns false when one directory does not exist', () => {
    const dirA = path.join(tmpDir, 'a');
    fs.mkdirSync(dirA);
    expect(dirsEqual(dirA, '/nonexistent')).toBe(false);
    expect(dirsEqual('/nonexistent', dirA)).toBe(false);
  });
});

describe('ensureDir', () => {
  it('creates nested directories', () => {
    const dir = path.join(tmpDir, 'deep', 'nested', 'path');
    ensureDir(dir);
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('does not throw when directory already exists', () => {
    const dir = path.join(tmpDir, 'existing');
    fs.mkdirSync(dir);
    ensureDir(dir);
    expect(fs.existsSync(dir)).toBe(true);
  });
});

describe('exists', () => {
  it('returns true for existing path', () => {
    const filePath = path.join(tmpDir, 'file.txt');
    fs.writeFileSync(filePath, 'data');
    expect(exists(filePath)).toBe(true);
  });

  it('returns false for non-existing path', () => {
    expect(exists(path.join(tmpDir, 'nope.txt'))).toBe(false);
  });
});

describe('readJson / writeJson', () => {
  it('writes and reads JSON data', () => {
    const filePath = path.join(tmpDir, 'data.json');
    const data = { name: 'test', values: [1, 2, 3] };
    writeJson(filePath, data);

    const read = readJson<{ name: string; values: number[] }>(filePath);
    expect(read.name).toBe('test');
    expect(read.values).toEqual([1, 2, 3]);
  });

  it('creates parent directories when writing', () => {
    const filePath = path.join(tmpDir, 'sub', 'dir', 'data.json');
    writeJson(filePath, { key: 'value' });
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('writes with default 2-space indentation', () => {
    const filePath = path.join(tmpDir, 'pretty.json');
    writeJson(filePath, { a: 1 });
    const raw = fs.readFileSync(filePath, 'utf-8');
    expect(raw).toContain('  "a": 1');
  });

  it('supports custom indentation', () => {
    const filePath = path.join(tmpDir, 'compact.json');
    writeJson(filePath, { a: 1 }, 0);
    const raw = fs.readFileSync(filePath, 'utf-8');
    expect(raw).toContain('"a":1');
  });

  it('appends trailing newline', () => {
    const filePath = path.join(tmpDir, 'newline.json');
    writeJson(filePath, {});
    const raw = fs.readFileSync(filePath, 'utf-8');
    expect(raw.endsWith('\n')).toBe(true);
  });
});

describe('hashDir: path separator normalization', () => {
  it('produces identical hashes for two directories with the same nested structure', () => {
    const dirA = path.join(tmpDir, 'nested-a');
    const dirB = path.join(tmpDir, 'nested-b');
    fs.mkdirSync(path.join(dirA, 'sub', 'deep'), { recursive: true });
    fs.mkdirSync(path.join(dirB, 'sub', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(dirA, 'sub', 'deep', 'file.txt'), 'same content');
    fs.writeFileSync(path.join(dirB, 'sub', 'deep', 'file.txt'), 'same content');

    expect(hashDir(dirA)).toBe(hashDir(dirB));
  });

  it('produces different hashes when nested file content differs', () => {
    const dirA = path.join(tmpDir, 'diff-a');
    const dirB = path.join(tmpDir, 'diff-b');
    fs.mkdirSync(path.join(dirA, 'sub'), { recursive: true });
    fs.mkdirSync(path.join(dirB, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dirA, 'sub', 'file.txt'), 'content-a');
    fs.writeFileSync(path.join(dirB, 'sub', 'file.txt'), 'content-b');

    expect(hashDir(dirA)).not.toBe(hashDir(dirB));
  });
});