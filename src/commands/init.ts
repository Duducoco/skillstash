import * as path from 'node:path';
import * as fs from 'node:fs';
import { Command } from 'commander';
import { initHub, hubExists, getDefaultHubPath, loadRegistry, saveRegistry, detectAgents, getSkillsPath } from '../core/hub.js';
import { addSkillToRegistry } from '../core/registry.js';
import { gitInit, gitProbeRemote, gitClone, gitAddRemote, gitPushSetUpstream, gitCommit } from '../core/git.js';
import { copyDirRecursive, hashDir, exists } from '../utils/fs.js';
import { getSkillVersion, getSkillDescription, lintSkill } from '../core/skill.js';
import { logger } from '../utils/logger.js';
import chalk from 'chalk';

interface DiscoveredSkill {
  name: string;
  sourcePath: string;
  isSymlink: boolean;
  fromAgent: string;
  linkTarget?: string;
}

/**
 * Scan an agent directory for skills, resolving symlinks/Junctions
 */
function scanAgentDir(agentName: string, agentSkillsPath: string): DiscoveredSkill[] {
  const results: DiscoveredSkill[] = [];
  if (!exists(agentSkillsPath)) return results;

  const entries = fs.readdirSync(agentSkillsPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith('.')) continue;

    const fullPath = path.join(agentSkillsPath, entry.name);
    let isSymlink = false;
    let linkTarget: string | undefined;
    let realPath = fullPath;

    try {
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink()) {
        isSymlink = true;
        linkTarget = fs.readlinkSync(fullPath) as string;
        if (!path.isAbsolute(linkTarget)) {
          linkTarget = path.resolve(path.dirname(fullPath), linkTarget);
        }
        realPath = linkTarget;
      }
    } catch {
      continue;
    }

    const skillMdPath = path.join(realPath, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) continue;

    results.push({ name: entry.name, sourcePath: realPath, isSymlink, fromAgent: agentName, linkTarget });
  }

  return results;
}

/**
 * Import skills discovered from agent directories into the hub
 */
function importDiscoveredSkills(hubPath: string, registry: ReturnType<typeof loadRegistry>, discovered: Map<string, DiscoveredSkill>): number {
  const skillsDir = getSkillsPath(hubPath);
  let imported = 0;

  // Deduplicate by source path
  const bySourcePath = new Map<string, { name: string; skill: DiscoveredSkill }>();
  for (const [name, skill] of discovered) {
    const key = skill.sourcePath.toLowerCase();
    if (!bySourcePath.has(key)) {
      bySourcePath.set(key, { name, skill });
    }
  }

  for (const [, { name, skill }] of bySourcePath) {
    // Skip if already in registry
    if (registry.skills[name]) continue;

    const destDir = path.join(skillsDir, name);
    if (exists(destDir)) continue;

    // Lint
    const lintResult = lintSkill(skill.sourcePath);
    if (!lintResult.valid) {
      logger.warn(`  Skipping ${name}: SKILL.md validation failed`);
      continue;
    }

    logger.step(`  Importing ${chalk.bold(name)}`);
    copyDirRecursive(skill.sourcePath, destDir);

    const version = getSkillVersion(destDir);
    const hash = hashDir(destDir);
    const description = getSkillDescription(destDir);

    addSkillToRegistry(registry, name, {
      version,
      source: 'local',
      hash,
      description: description || undefined,
      agents: [],
    });

    imported++;
  }

  return imported;
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize the skills-hub with a remote Git repository')
    .argument('<remote-url>', 'Remote Git repository URL (e.g. git@github.com:user/skills.git)')
    .action(async (remoteUrl: string) => {
      const hubPath = getDefaultHubPath();

      // Check if hub already exists
      if (hubExists(hubPath)) {
        logger.warn(`Skills hub already exists at ${chalk.cyan(hubPath)}`);
        const reg = loadRegistry(hubPath);
        logger.info(`  Skills: ${Object.keys(reg.skills).length}, Agents: ${Object.keys(reg.agents).length}`);
        logger.info(`  Use ${chalk.cyan('skillstash sync')} to update, or delete the hub directory to re-initialize.`);
        return;
      }

      // Step 1: Probe the remote
      logger.step(`Probing remote repository: ${chalk.cyan(remoteUrl)}`);
      const probe = gitProbeRemote(remoteUrl);

      if (probe.error) {
        logger.error(`Cannot access remote repository: ${probe.error}`);
        logger.info('  Please check the URL and your access credentials.');
        return;
      }

      if (probe.empty) {
        // ─── Case 1: Empty remote → fresh init + push ───
        logger.info('Remote repository is empty. Initializing a new skillstash hub...');
        await initFreshHub(hubPath, remoteUrl);
      } else if (probe.hasRegistry) {
        // ─── Case 2: Non-empty remote with registry.json → clone + import ───
        logger.info('Remote repository contains a skillstash hub. Cloning...');
        await cloneAndImport(hubPath, remoteUrl);
      } else {
        // ─── Case 3: Non-empty remote without registry.json → reject ───
        logger.error('Remote repository is not empty and does not appear to be a skillstash hub.');
        logger.error('  (No registry.json found in the repository)');
        logger.info('');
        logger.info('  Please either:');
        logger.info(`    1. Create a new empty repository and run ${chalk.cyan('skillstash init <new-url>')}`);
        logger.info(`    2. Or delete all content in the existing repository and retry.`);
        return;
      }
    });
}

/**
 * Case 1: Empty remote → create fresh hub, push to remote
 */
export async function initFreshHub(hubPath: string, remoteUrl: string): Promise<void> {
  // Create hub structure
  const result = initHub(hubPath);
  if (!result.created) {
    logger.error('Failed to create hub directory');
    return;
  }
  logger.success('Skills hub directory created');
  logger.success('Registry initialized');

  // Initialize git
  if (!gitInit(hubPath)) {
    logger.error('Git init failed');
    return;
  }
  logger.success('Git repository initialized');

  // Import any existing agent skills
  const registry = loadRegistry(hubPath);
  const agents = Object.values(registry.agents).filter((a) => a.available);

  if (agents.length > 0) {
    logger.step('Scanning agent directories for existing skills...');
    const discovered = new Map<string, DiscoveredSkill>();

    for (const agent of agents) {
      const skills = scanAgentDir(agent.name, agent.skillsPath);
      for (const skill of skills) {
        if (!discovered.has(skill.name)) {
          discovered.set(skill.name, skill);
        }
      }
      if (skills.length > 0) {
        logger.info(`  ${agent.name}: found ${skills.length} skill(s)`);
      }
    }

    if (discovered.size > 0) {
      const imported = importDiscoveredSkills(hubPath, registry, discovered);
      if (imported > 0) {
        saveRegistry(registry, hubPath);
        logger.success(`Imported ${imported} skill(s) from agent directories`);
      }
    } else {
      logger.info('  No existing skills found in agent directories');
    }
  }

  // Commit and push
  gitCommit(hubPath, 'init: create skillstash hub');
  gitAddRemote(hubPath, remoteUrl);
  logger.step('Pushing to remote...');

  if (gitPushSetUpstream(hubPath)) {
    logger.success('Pushed to remote');
  } else {
    logger.warn('Push failed — you can push manually later with: skillstash sync');
  }

  // Show summary
  showInitSummary(hubPath, registry);
}

/**
 * Case 2: Non-empty remote with registry.json → clone + import agent skills
 */
export async function cloneAndImport(hubPath: string, remoteUrl: string): Promise<void> {
  // Ensure parent directory exists
  fs.mkdirSync(path.dirname(hubPath), { recursive: true });

  // Clone
  logger.step('Cloning remote repository...');
  if (!gitClone(remoteUrl, hubPath)) {
    logger.error('Clone failed. Please check the URL and your access credentials.');
    return;
  }
  logger.success('Repository cloned');

  // Verify registry.json exists in cloned repo
  const registryPath = path.join(hubPath, 'registry.json');
  if (!fs.existsSync(registryPath)) {
    logger.error('Cloned repository does not contain registry.json. This should not happen.');
    logger.info('  Please check the repository contents.');
    return;
  }

  // Load the cloned registry
  const registry = loadRegistry(hubPath);

  // Re-detect agents on this machine (may differ from the machine that pushed)
  const currentAgents = detectAgents();
  for (const agent of currentAgents) {
    if (!registry.agents[agent.name]) {
      registry.agents[agent.name] = agent;
    } else {
      // Update availability status
      registry.agents[agent.name].available = agent.available;
    }
  }
  saveRegistry(registry, hubPath);

  // Import any agent skills not yet in the hub
  const availableAgents = Object.values(registry.agents).filter((a) => a.available);
  if (availableAgents.length > 0) {
    logger.step('Scanning agent directories for new skills...');
    const discovered = new Map<string, DiscoveredSkill>();

    for (const agent of availableAgents) {
      const skills = scanAgentDir(agent.name, agent.skillsPath);
      // Only count skills NOT already in hub
      const newSkills = skills.filter((s) => !registry.skills[s.name]);
      for (const skill of newSkills) {
        if (!discovered.has(skill.name)) {
          discovered.set(skill.name, skill);
        }
      }
      if (newSkills.length > 0) {
        logger.info(`  ${agent.name}: found ${newSkills.length} new skill(s)`);
      }
    }

    if (discovered.size > 0) {
      const imported = importDiscoveredSkills(hubPath, registry, discovered);
      if (imported > 0) {
        saveRegistry(registry, hubPath);
        gitCommit(hubPath, `init: import ${imported} skill(s) from local agents`);
        logger.success(`Imported ${imported} new skill(s) from agent directories`);

        // Push the imported skills
        logger.step('Pushing imported skills to remote...');
        if (gitPushSetUpstream(hubPath)) {
          logger.success('Pushed to remote');
        }
      }
    } else {
      logger.info('  No new skills to import from agent directories');
    }
  }

  const skillCount = Object.keys(registry.skills).length;
  logger.info(`\n  Hub contains ${chalk.bold(skillCount)} skill(s) from remote`);

  // Show summary
  showInitSummary(hubPath, registry);
}

/**
 * Display the post-init summary
 */
function showInitSummary(hubPath: string, registry: ReturnType<typeof loadRegistry>): void {
  const agents = Object.values(registry.agents);
  const skillCount = Object.keys(registry.skills).length;

  logger.info('');
  logger.info('Detected agents:');
  for (const agent of agents) {
    const status = agent.available
      ? chalk.green('✓ available')
      : chalk.gray('✗ not found');
    logger.info(`  ${chalk.bold(agent.name)}: ${status} → ${chalk.gray(agent.skillsPath)}`);
  }

  logger.info('');
  logger.success(`Done! Hub initialized at ${chalk.cyan(hubPath)}`);
  logger.info(`  Skills: ${skillCount}`);
  logger.info('');
  logger.info('Next steps:');
  logger.info(`  ${chalk.cyan('skillstash install <name>')}  — Install a new skill`);
  logger.info(`  ${chalk.cyan('skillstash link')}           — Copy skills to agent directories`);
  logger.info(`  ${chalk.cyan('skillstash sync')}           — Full sync (pull + link + push)`);
}
