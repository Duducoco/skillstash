import * as path from 'node:path';
import * as fs from 'node:fs';
import { Command } from 'commander';
import { hubExists, getSkillsPath, loadRegistry, saveRegistry, getDefaultHubPath } from '../core/hub.js';
import { addSkillToRegistry, updateSkillInRegistry } from '../core/registry.js';
import { copyDirRecursive, removeDir, hashDir, exists, ensureDir } from '../utils/fs.js';
import { getSkillVersion, getSkillDescription, lintSkill } from '../core/skill.js';
import { gitCommit } from '../core/git.js';
import { logger } from '../utils/logger.js';
import chalk from 'chalk';

interface DiscoveredSkill {
  name: string;
  sourcePath: string;           // Resolved real path (follows symlinks)
  isSymlink: boolean;
  fromAgent: string;            // Which agent directory we found it in
  linkTarget?: string;          // Original symlink target if applicable
}

/**
 * Scan an agent directory and discover skills, resolving symlinks
 */
function scanAgentDir(agentName: string, agentSkillsPath: string): DiscoveredSkill[] {
  const results: DiscoveredSkill[] = [];
  if (!exists(agentSkillsPath)) return results;

  const entries = fs.readdirSync(agentSkillsPath, { withFileTypes: true });
  for (const entry of entries) {
    // On Windows, Junctions report isDirectory()=false and isSymbolicLink()=true
    // We need to accept both regular dirs and symlinks
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith('.')) continue; // skip .claude, .system etc.

    const fullPath = path.join(agentSkillsPath, entry.name);

    // Check if it's a symlink/junction
    let isSymlink = false;
    let linkTarget: string | undefined;
    let realPath = fullPath;

    try {
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink()) {
        isSymlink = true;
        linkTarget = fs.readlinkSync(fullPath) as string;
        // Resolve to absolute path
        if (!path.isAbsolute(linkTarget)) {
          linkTarget = path.resolve(path.dirname(fullPath), linkTarget);
        }
        // Use readlink target instead of realpathSync
        // (realpathSync fails on Windows Junctions in some Node.js versions)
        realPath = linkTarget;
      }
    } catch {
      // May not have permission, skip
      continue;
    }

    // Check if it has SKILL.md
    const skillMdPath = path.join(realPath, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) continue;

    results.push({
      name: entry.name,
      sourcePath: realPath,
      isSymlink,
      fromAgent: agentName,
      linkTarget,
    });
  }

  return results;
}

export function registerImportCommand(program: Command): void {
  program
    .command('import')
    .description('Scan agent directories, resolve symlinks, and import skills into hub')
    .option('-a, --agent <agent>', 'Only scan specific agent')
    .option('--force', 'Re-import skills that already exist in the hub (overwrite)')
    .option('--dry-run', 'Show what would be imported without actually importing')
    .option('--no-lint', 'Skip SKILL.md linting')
    .action(async (options) => {
      const hubPath = getDefaultHubPath();

      if (!hubExists(hubPath)) {
        logger.error('Skills hub not initialized. Run `skillstash init` first.');
        return;
      }

      const registry = loadRegistry(hubPath);
      const agents = Object.values(registry.agents).filter((a) => a.available);
      const targetAgents = options.agent
        ? agents.filter((a) => a.name === options.agent)
        : agents;

      if (targetAgents.length === 0) {
        logger.warn('No available agents to scan');
        return;
      }

      // Scan all agent directories
      const discovered = new Map<string, DiscoveredSkill>();

      for (const agent of targetAgents) {
        logger.step(`Scanning ${chalk.bold(agent.name)} skills directory...`);
        const skills = scanAgentDir(agent.name, agent.skillsPath);

        for (const skill of skills) {
          if (!discovered.has(skill.name)) {
            discovered.set(skill.name, skill);
          }
        }

        logger.info(`  Found ${skills.length} skill(s)`);
      }

      if (discovered.size === 0) {
        logger.info('No skills found in agent directories');
        return;
      }

      // Filter out skills already in hub (unless --force)
      const newSkills = options.force
        ? [...discovered.entries()]
        : [...discovered.entries()].filter(
            ([name]) => !registry.skills[name]
          );

      if (newSkills.length === 0) {
        if (options.force) {
          logger.info('No skills found in agent directories');
        } else {
          logger.info('All discovered skills are already in the hub. Use --force to re-import.');
        }
        return;
      }

      // Deduplicate by source path (multiple agents may point to the same real skill)
      const bySourcePath = new Map<string, { name: string; skill: DiscoveredSkill }>();
      for (const [name, skill] of newSkills) {
        const key = skill.sourcePath.toLowerCase(); // case-insensitive for Windows
        if (!bySourcePath.has(key)) {
          bySourcePath.set(key, { name, skill });
        }
      }

      // Display what we found
      logger.info(`\n${chalk.bold('Discovered skills:')}  ${newSkills.length} unique names, ${bySourcePath.size} unique sources\n`);

      for (const [, { name, skill }] of bySourcePath) {
        const linkInfo = skill.isSymlink
          ? chalk.cyan(`← symlink → ${skill.linkTarget}`)
          : chalk.gray('(regular directory)');
        logger.info(`  ${chalk.bold(name.padEnd(32))} ${linkInfo}`);
      }

      if (options.dryRun) {
        logger.info(`\n${chalk.yellow('Dry run — no changes made.')}`);
        return;
      }

      // Import
      const skillsDir = getSkillsPath(hubPath);
      let imported = 0;
      let updated = 0;

      for (const [, { name, skill }] of bySourcePath) {
        const destDir = path.join(skillsDir, name);
        const isUpdate = !!registry.skills[name];

        // Lint
        if (options.lint) {
          const lintResult = lintSkill(skill.sourcePath);
          if (!lintResult.valid) {
            logger.warn(`  Skipping ${name}: SKILL.md validation failed`);
            for (const err of lintResult.errors) {
              logger.error(`    ✖ ${err}`);
            }
            continue;
          }
        }

        // Remove existing directory if overwriting
        if (exists(destDir)) {
          if (!isUpdate && !options.force) {
            logger.warn(`  Skipping ${name}: already exists in hub directory`);
            continue;
          }
          removeDir(destDir);
        }

        // Copy from real path (resolves symlinks)
        const label = isUpdate ? 'Updating' : 'Importing';
        logger.step(`  ${label} ${chalk.bold(name)}`);
        copyDirRecursive(skill.sourcePath, destDir);

        const version = getSkillVersion(destDir);
        const hash = hashDir(destDir);
        const description = getSkillDescription(destDir);

        if (isUpdate) {
          updateSkillInRegistry(registry, name, {
            version,
            hash,
            description: description || undefined,
          });
          updated++;
        } else {
          addSkillToRegistry(registry, name, {
            version,
            source: 'local',
            hash,
            description: description || undefined,
            agents: [],
          });
          imported++;
        }
      }

      if (imported > 0 || updated > 0) {
        saveRegistry(registry, hubPath);
        const parts: string[] = [];
        if (imported > 0) parts.push(`imported ${imported}`);
        if (updated > 0) parts.push(`updated ${updated}`);
        gitCommit(hubPath, `import: ${parts.join(', ')} skill(s) from agent directories`);
        logger.success(`\n${parts.join(', ')} skill(s)`);
        logger.info(`Run ${chalk.cyan('skillstash link')} to distribute to all agents`);
      } else {
        logger.info('\nNo new skills to import');
      }
    });
}
