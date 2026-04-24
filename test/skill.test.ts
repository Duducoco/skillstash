import { describe, it, expect } from 'vitest';
import { parseFrontmatter, lintSkill, getSkillName, getSkillVersion, getSkillDescription } from '../src/core/skill.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

function createTempSkillDir(frontmatter: string | null, body: string = 'Skill content here'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillstash-test-'));
  if (frontmatter !== null) {
    const content = frontmatter ? `---\n${frontmatter}\n---\n\n${body}` : body;
    fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf-8');
  }
  return dir;
}

function cleanupDir(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('parseFrontmatter', () => {
  it('parses valid frontmatter', () => {
    const content = `---
name: my-skill
version: 1.0.0
description: A test skill
---
Body content`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('my-skill');
    expect(result!.version).toBe('1.0.0');
    expect(result!.description).toBe('A test skill');
  });

  it('parses frontmatter with quoted values', () => {
    const content = `---
name: "quoted name"
description: 'single quoted'
---`;
    const result = parseFrontmatter(content);
    expect(result!.name).toBe('quoted name');
    expect(result!.description).toBe('single quoted');
  });

  it('parses frontmatter with underscores and dashes in keys', () => {
    const content = `---
name: skill
description_zh: 中文描述
description_en: English desc
custom_field: value
---`;
    const result = parseFrontmatter(content);
    expect(result!.description_zh).toBe('中文描述');
    expect(result!.description_en).toBe('English desc');
    expect(result!.custom_field).toBe('value');
  });

  it('returns null for content without frontmatter', () => {
    const content = 'Just some plain text\nNo frontmatter here';
    expect(parseFrontmatter(content)).toBeNull();
  });

  it('returns null for empty content', () => {
    expect(parseFrontmatter('')).toBeNull();
  });

  it('handles frontmatter with empty values', () => {
    const content = `---
name:
version: 1.0.0
---`;
    const result = parseFrontmatter(content);
    expect(result!.version).toBe('1.0.0');
    // name: with empty value after trim becomes ''
    expect(result!.name).toBe('');
  });

  it('ignores non-key-value lines in frontmatter', () => {
    const content = `---
  just a line
name: skill
---`;
    const result = parseFrontmatter(content);
    expect(result!.name).toBe('skill');
    expect(Object.keys(result!)).toHaveLength(1);
  });
});

describe('lintSkill', () => {
  it('passes for valid SKILL.md', () => {
    const dir = createTempSkillDir('name: valid-skill\nversion: 1.0.0\ndescription: A good skill');
    const result = lintSkill(dir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter!.name).toBe('valid-skill');
    cleanupDir(dir);
  });

  it('fails when SKILL.md is missing', () => {
    const dir = createTempSkillDir(null);
    const result = lintSkill(dir);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('SKILL.md not found');
    cleanupDir(dir);
  });

  it('fails when frontmatter is missing', () => {
    const dir = createTempSkillDir(null, 'No frontmatter, just plain text');
    // Write SKILL.md without frontmatter
    fs.writeFileSync(path.join(dir, 'SKILL.md'), 'No frontmatter, just plain text', 'utf-8');
    const result = lintSkill(dir);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('No YAML frontmatter found');
    cleanupDir(dir);
  });

  it('errors when name is missing', () => {
    const dir = createTempSkillDir('version: 1.0.0\ndescription: desc');
    const result = lintSkill(dir);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required field: name');
    cleanupDir(dir);
  });

  it('warns when version is missing', () => {
    const dir = createTempSkillDir('name: skill\ndescription: desc');
    const result = lintSkill(dir);
    expect(result.valid).toBe(true);
    expect(result.warnings).toContain('Missing recommended field: version');
    cleanupDir(dir);
  });

  it('warns when description fields are all missing', () => {
    const dir = createTempSkillDir('name: skill\nversion: 1.0.0');
    const result = lintSkill(dir);
    expect(result.valid).toBe(true);
    expect(result.warnings).toContain('Missing recommended field: description');
    cleanupDir(dir);
  });

  it('does not warn about description when description_zh is present', () => {
    const dir = createTempSkillDir('name: skill\nversion: 1.0.0\ndescription_zh: 描述');
    const result = lintSkill(dir);
    expect(result.valid).toBe(true);
    expect(result.warnings).not.toContain('Missing recommended field: description');
    cleanupDir(dir);
  });

  it('warns on non-semver version', () => {
    const dir = createTempSkillDir('name: skill\nversion: v1.0\ndescription: desc');
    const result = lintSkill(dir);
    expect(result.warnings.some(w => w.includes('semver'))).toBe(true);
    cleanupDir(dir);
  });
});

describe('getSkillName', () => {
  it('returns name from SKILL.md frontmatter', () => {
    const dir = createTempSkillDir('name: custom-name\nversion: 1.0.0');
    expect(getSkillName(dir)).toBe('custom-name');
    cleanupDir(dir);
  });

  it('falls back to directory name when no SKILL.md', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'my-dir-name-'));
    expect(getSkillName(dir)).toBe(path.basename(dir));
    cleanupDir(dir);
  });

  it('falls back to directory name when frontmatter has no name', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fallback-dir-'));
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nversion: 1.0.0\n---\n', 'utf-8');
    expect(getSkillName(dir)).toBe(path.basename(dir));
    cleanupDir(dir);
  });
});

describe('getSkillVersion', () => {
  it('returns version from SKILL.md', () => {
    const dir = createTempSkillDir('name: skill\nversion: 2.3.1');
    expect(getSkillVersion(dir)).toBe('2.3.1');
    cleanupDir(dir);
  });

  it('defaults to 0.0.0 when no version', () => {
    const dir = createTempSkillDir('name: skill');
    expect(getSkillVersion(dir)).toBe('0.0.0');
    cleanupDir(dir);
  });

  it('defaults to 0.0.0 when no SKILL.md', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillstash-test-'));
    expect(getSkillVersion(dir)).toBe('0.0.0');
    cleanupDir(dir);
  });
});

describe('getSkillDescription', () => {
  it('prefers description_zh', () => {
    const dir = createTempSkillDir('name: skill\nversion: 1.0.0\ndescription_zh: 中文\ndescription_en: English\ndescription: generic');
    expect(getSkillDescription(dir)).toBe('中文');
    cleanupDir(dir);
  });

  it('falls back to description_en when no description_zh', () => {
    const dir = createTempSkillDir('name: skill\nversion: 1.0.0\ndescription_en: English\ndescription: generic');
    expect(getSkillDescription(dir)).toBe('English');
    cleanupDir(dir);
  });

  it('falls back to description when no zh/en', () => {
    const dir = createTempSkillDir('name: skill\nversion: 1.0.0\ndescription: generic');
    expect(getSkillDescription(dir)).toBe('generic');
    cleanupDir(dir);
  });

  it('returns empty string when no description fields', () => {
    const dir = createTempSkillDir('name: skill\nversion: 1.0.0');
    expect(getSkillDescription(dir)).toBe('');
    cleanupDir(dir);
  });
});