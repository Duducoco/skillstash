import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { Command } from 'commander';
import { hubExists, getSkillsPath, loadRegistry, saveRegistry, getDefaultHubPath } from '../core/hub.js';
import { addSkillToRegistry, updateSkillInRegistry } from '../core/registry.js';
import { copyDirRecursive, hashDir, exists } from '../utils/fs.js';
import { getSkillName, getSkillVersion, getSkillDescription, lintSkill } from '../core/skill.js';
import { gitCommit, gitShallowClone, gitAvailable } from '../core/git.js';
import { logger } from '../utils/logger.js';
import chalk from 'chalk';

/**
 * Check if clawhub CLI is available
 */
function clawhubAvailable(): boolean {
  try {
    execSync('clawhub -V', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install a skill from ClawHub into a temp dir and return the path.
 * Uses: clawhub install <slug> --workdir <tmp> --dir skills
 */
function installFromClawhub(slug: string): string | null {
  const tmpDir = path.join(os.tmpdir(), `skillstash-clawhub-${Date.now()}`);

  try {
    logger.step(`  Downloading from ClawHub: ${chalk.bold(slug)}`);
    execSync(`clawhub install "${slug}" --workdir "${tmpDir}" --dir skills`, {
      stdio: 'pipe',
      timeout: 60_000,
    });

    // clawhub installs to <workdir>/skills/<slug>/
    const skillDir = path.join(tmpDir, 'skills', slug);
    if (!fs.existsSync(path.join(skillDir, 'SKILL.md'))) {
      // Maybe the slug differs — scan the skills dir
      const skillsDir = path.join(tmpDir, 'skills');
      if (fs.existsSync(skillsDir)) {
        const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
          .filter(d => d.isDirectory());
        if (entries.length === 1) {
          return path.join(skillsDir, entries[0].name);
        }
      }
      logger.error(`ClawHub installed but no SKILL.md found for "${slug}"`);
      return null;
    }

    return skillDir;
  } catch (e) {
    logger.error(`ClawHub install failed: ${(e as Error).message}`);
    logger.info('  Make sure you are logged in: clawhub login');
    return null;
  }
}

/**
 * Resolve skill source: ClawHub, local path, or GitHub
 */
export function resolveSkillSource(name: string): { type: 'clawhub' | 'local' | 'github'; path: string; slug?: string; url?: string; skillName?: string } | null {
  // 1. ClawHub: clawhub:<slug> or @<slug>
  if (name.startsWith('clawhub:')) {
    const slug = name.slice('clawhub:'.length);
    if (!slug) {
      logger.error('ClawHub slug is empty. Usage: skillstash install clawhub:<slug>');
      return null;
    }
    return { type: 'clawhub', path: '', slug };
  }

  // 2. Local path (starts with ./ or / or C:\ or C:/)
  if (name.startsWith('.') || name.startsWith('/') || /^[A-Za-z]:[\\\/]/.test(name)) {
    const resolved = path.resolve(name);
    if (fs.existsSync(path.join(resolved, 'SKILL.md'))) {
      return { type: 'local', path: resolved };
    }
    logger.error(`No SKILL.md found at ${resolved}`);
    return null;
  }

  // 3. GitHub format: owner/repo@skill-name or owner/repo
  if (name.includes('/') && !name.startsWith('@')) {
    const parts = name.split('@');
    const repo = parts[0];
    const skillName = parts[1] || '';
    const url = `https://github.com/${repo}`;
    return { type: 'github', path: '', url, skillName };
  }

  logger.error(`Skill "${name}" not found. Provide a ClawHub slug, local path, or GitHub repo.`);
  logger.info('  Examples:');
  logger.info('    skillstash install clawhub:finance-ops');
  logger.info('    skillstash install ./my-skill');
  logger.info('    skillstash install user/repo@skill-name');
  return null;
}

/**
 * Find a skill directory within a cloned GitHub repo.
 * Supports three repo layouts:
 *   1. Standalone skill repo: SKILL.md at repo root
 *   2. Skill-hub repo: skills/<skill-name>/SKILL.md
 *   3. Subdirectory skill: <skill-name>/SKILL.md
 *
 * If skillName is provided, only that skill is searched.
 * If not, auto-detects the skill (single skill repos only).
 */
export function findGithubSkill(repoDir: string, skillName?: string): string | null {
  // 1. Specific skill requested
  if (skillName) {
    const candidates = [
      path.join(repoDir, 'skills', skillName),
      path.join(repoDir, skillName),
    ];
    for (const c of candidates) {
      if (fs.existsSync(path.join(c, 'SKILL.md'))) return c;
    }
    logger.error(`Skill "${skillName}" not found in repo. Searched:`);
    for (const c of candidates) logger.error(`  ${c}`);
    return null;
  }

  // 2. No skillName specified — try repo root (standalone skill repo)
  if (fs.existsSync(path.join(repoDir, 'SKILL.md'))) {
    return repoDir;
  }

  // 3. Try skills/ subdirectory (skill-hub layout)
  const skillsDir = path.join(repoDir, 'skills');
  if (fs.existsSync(skillsDir)) {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && fs.existsSync(path.join(skillsDir, d.name, 'SKILL.md')));

    if (entries.length === 1) {
      // Exactly one skill — auto-select
      return path.join(skillsDir, entries[0].name);
    }

    if (entries.length > 1) {
      logger.error('Multiple skills found in repo. Specify which one:');
      for (const e of entries) {
        logger.info(`  ${e.name}`);
      }
      logger.info(`\n  Usage: skillstash install owner/repo@${entries[0].name}`);
      return null;
    }
  }

  // 4. Scan top-level directories for SKILL.md
  const topDirs = fs.readdirSync(repoDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && fs.existsSync(path.join(repoDir, d.name, 'SKILL.md')));

  if (topDirs.length === 1) {
    return path.join(repoDir, topDirs[0].name);
  }

  if (topDirs.length > 1) {
    logger.error('Multiple skills found in repo. Specify which one:');
    for (const d of topDirs) {
      logger.info(`  ${d.name}`);
    }
    logger.info(`\n  Usage: skillstash install owner/repo@${topDirs[0].name}`);
    return null;
  }

  logger.error('No SKILL.md found in this repository');
  logger.info('  If the skill is in a subdirectory, use: owner/repo@skill-name');
  return null;
}

export function registerInstallCommand(program: Command): void {
  program
    .command('install <skill-name>')
    .description('Install a skill to the hub from ClawHub, local path, or GitHub')
    .option('--no-lint', 'Skip SKILL.md linting')
    .action(async (skillName, options) => {
      const hubPath = getDefaultHubPath();

      if (!hubExists(hubPath)) {
        logger.error('Skills hub not initialized. Run `skillstash init <remote-url>` first.');
        return;
      }

      logger.step(`Resolving skill source for "${chalk.bold(skillName)}"`);
      const source = resolveSkillSource(skillName);
      if (!source) return;

      // Handle ClawHub source
      if (source.type === 'clawhub') {
        if (!clawhubAvailable()) {
          logger.error('ClawHub CLI not found. Install it first:');
          logger.info('  npm install -g clawhub');
          logger.info('  Then login: clawhub login');
          return;
        }
        const skillDir = installFromClawhub(source.slug!);
        if (!skillDir) return;

        // Proceed with the downloaded skill
        try {
          await installFromPath(skillDir, hubPath, 'clawhub', options, source.slug);
        } finally {
          // Clean up temp dir
          try {
            // The temp dir is the workdir, which contains skills/<slug>
            fs.rmSync(path.dirname(path.dirname(skillDir)), { recursive: true, force: true });
          } catch { /* best effort */ }
        }
        return;
      }

      // Handle GitHub source
      if (source.type === 'github') {
        if (!gitAvailable()) {
          logger.error('Git not found. GitHub installation requires git.');
          return;
        }

        logger.step(`  Cloning from GitHub: ${chalk.bold(source.url!)}`);
        const tmpDir = gitShallowClone(source.url!);
        if (!tmpDir) return;

        try {
          const skillDir = findGithubSkill(tmpDir, source.skillName);
          if (!skillDir) return;

          await installFromPath(skillDir, hubPath, 'github', options, undefined, source.url);
        } finally {
          try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
          } catch { /* best effort */ }
        }
        return;
      }

      // Handle local path source
      await installFromPath(source.path, hubPath, 'local', options);
    });
}

/**
 * Common install logic: copy from source dir to hub, register, commit
 */
export async function installFromPath(
  skillDir: string,
  hubPath: string,
  sourceType: 'local' | 'clawhub' | 'github',
  options: { lint?: boolean },
  overrideName?: string,
  sourceUrl?: string,
): Promise<void> {
  // Validate skill
  if (options.lint) {
    const lintResult = lintSkill(skillDir);
    if (!lintResult.valid) {
      logger.error('SKILL.md validation failed:');
      for (const err of lintResult.errors) {
        logger.error(`  ✖ ${err}`);
      }
      return;
    }
    if (lintResult.warnings.length > 0) {
      for (const warn of lintResult.warnings) {
        logger.warn(`  ${warn}`);
      }
    }
  }

  // Get skill metadata
  const name = overrideName || getSkillName(skillDir);
  const version = getSkillVersion(skillDir);
  const description = getSkillDescription(skillDir);
  // Use skill name as directory name (avoids temp dir names for GitHub/ClawHub sources)
  const destDir = path.join(getSkillsPath(hubPath), name);

  // Check if already installed
  const registry = loadRegistry(hubPath);
  const isUpdate = !!registry.skills[name];

  if (isUpdate) {
    logger.step(`Updating existing skill: ${chalk.bold(name)}`);
  } else {
    logger.step(`Installing skill: ${chalk.bold(name)} v${version}`);
  }

  copyDirRecursive(skillDir, destDir);
  const hash = hashDir(destDir);

  if (isUpdate) {
    updateSkillInRegistry(registry, name, {
      version,
      hash,
      source: sourceType,
      sourceUrl,
      description,
    });
  } else {
    addSkillToRegistry(registry, name, {
      version,
      source: sourceType,
      sourceUrl,
      hash,
      description,
      agents: [],
    });
  }

  saveRegistry(registry, hubPath);
  gitCommit(hubPath, `install: ${name} v${version}`);
  logger.success(`Installed ${chalk.bold(name)} v${version} from ${sourceType}`);
  if (description) {
    logger.info(`  ${chalk.gray(description)}`);
  }
}
