import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../utils/logger.js';

export interface SkillFrontmatter {
  name?: string;
  version?: string;
  description?: string;
  description_zh?: string;
  description_en?: string;
  [key: string]: unknown;
}

export interface LintResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  frontmatter: SkillFrontmatter | null;
}

/**
 * Parse YAML frontmatter from SKILL.md (simple parser, no dependency)
 */
export function parseFrontmatter(content: string): SkillFrontmatter | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;

  const yaml = match[1];
  const result: SkillFrontmatter = {};

  for (const line of yaml.split('\n')) {
    const kvMatch = line.match(/^(\w[\w_-]*):\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      let value: string = kvMatch[2].trim();
      // Remove surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result[key] = value;
    }
  }

  return result;
}

/**
 * Read and parse SKILL.md
 */
export function readSkillMeta(skillDir: string): { frontmatter: SkillFrontmatter | null; content: string } | null {
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) return null;

  const content = fs.readFileSync(skillMdPath, 'utf-8');
  const frontmatter = parseFrontmatter(content);
  return { frontmatter, content };
}

/**
 * Lint a SKILL.md file
 */
export function lintSkill(skillDir: string): LintResult {
  const result: LintResult = {
    valid: true,
    errors: [],
    warnings: [],
    frontmatter: null,
  };

  const parsed = readSkillMeta(skillDir);
  if (!parsed) {
    result.valid = false;
    result.errors.push('SKILL.md not found');
    return result;
  }

  const { frontmatter } = parsed;
  result.frontmatter = frontmatter;

  if (!frontmatter) {
    result.valid = false;
    result.errors.push('No YAML frontmatter found');
    return result;
  }

  // Required fields
  if (!frontmatter.name) {
    result.errors.push('Missing required field: name');
    result.valid = false;
  }

  if (!frontmatter.version) {
    result.warnings.push('Missing recommended field: version');
  }

  if (!frontmatter.description && !frontmatter.description_zh && !frontmatter.description_en) {
    result.warnings.push('Missing recommended field: description');
  }

  // Version format check
  if (frontmatter.version && !/^\d+\.\d+\.\d+$/.test(frontmatter.version)) {
    result.warnings.push(`Version "${frontmatter.version}" does not follow semver (MAJOR.MINOR.PATCH)`);
  }

  return result;
}

/**
 * Get skill name from directory (uses SKILL.md name or directory name)
 */
export function getSkillName(skillDir: string): string {
  const parsed = readSkillMeta(skillDir);
  if (parsed?.frontmatter?.name) {
    return parsed.frontmatter.name as string;
  }
  return path.basename(skillDir);
}

/**
 * Get skill version from SKILL.md
 */
export function getSkillVersion(skillDir: string): string {
  const parsed = readSkillMeta(skillDir);
  return (parsed?.frontmatter?.version as string) || '0.0.0';
}

/**
 * Get skill description from SKILL.md
 */
export function getSkillDescription(skillDir: string): string {
  const parsed = readSkillMeta(skillDir);
  return (
    (parsed?.frontmatter?.description_zh as string) ||
    (parsed?.frontmatter?.description_en as string) ||
    (parsed?.frontmatter?.description as string) ||
    ''
  );
}
