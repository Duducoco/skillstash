import { Command } from 'commander';
import { hubExists, loadRegistry, saveRegistry, getDefaultHubPath, getSkillsPath } from '../core/hub.js';
import { gitPull, gitPush, gitCommit, hasRemote, type GitPullResult } from '../core/git.js';
import { copyDirRecursive, ensureDir, exists, removeDir, hashDir } from '../utils/fs.js';
import { updateSkillInRegistry, removeSkillFromRegistry } from '../core/registry.js';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { logger } from '../utils/logger.js';
import chalk from 'chalk';

export function registerSyncCommand(program: Command): void {
  program
    .command('sync')
    .description('Sync skills: git pull + link to all agents + git push')
    .option('--no-pull', 'Skip git pull')
    .option('--no-push', 'Skip git push')
    .option('--no-link', 'Skip linking to agents')
    .option('--clean', 'Remove skills from agent dirs that are not in hub')
    .action(async (options) => {
      const hubPath = getDefaultHubPath();

      if (!hubExists(hubPath)) {
        logger.error('Skills hub not initialized. Run `skillstash init` first.');
        return;
      }

      const registry = loadRegistry(hubPath);

      // Step 1: Git pull
      if (options.pull && hasRemote(hubPath)) {
        logger.step('Pulling from remote...');
        const pullResult: GitPullResult = gitPull(hubPath);
        if (pullResult.success) {
          logger.success('Pulled latest changes');
          // Reload registry after pull
          Object.assign(registry, loadRegistry(hubPath));
        } else if (pullResult.conflict) {
          logger.error(
            'Sync aborted: conflicts between local and remote changes must be resolved manually.\n' +
            '  1. cd into your hub directory\n' +
            '  2. Run `git rebase --abort` if a rebase is still in progress\n' +
            '  3. Resolve conflicts, commit, and re-run `skillstash sync`'
          );
          return;
        } else {
          logger.warn('Pull failed (network or auth issue). Continuing with local state...');
        }
      } else if (options.pull && !hasRemote(hubPath)) {
        logger.info('No remote configured, skipping pull');
      }

      // Step 2: Verify hub integrity
      logger.step('Verifying hub integrity...');
      const skillsDir = getSkillsPath(hubPath);
      const skillNames = Object.keys(registry.skills);
      let issues = 0;

      for (const name of skillNames) {
        const skillDir = path.join(skillsDir, name);
        if (!exists(skillDir)) {
          logger.warn(`  ${name}: directory missing in hub, removing from registry`);
          removeSkillFromRegistry(registry, name);
          issues++;
          continue;
        }
        const currentHash = hashDir(skillDir);
        if (currentHash !== registry.skills[name].hash) {
          logger.step(`  ${name}: content changed, updating hash`);
          updateSkillInRegistry(registry, name, { hash: currentHash });
          issues++;
        }
      }

      // Check for skills on disk not in registry
      if (exists(skillsDir)) {
        const onDisk = fs.readdirSync(skillsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name);

        for (const name of onDisk) {
          if (!registry.skills[name]) {
            logger.step(`  ${name}: found on disk but not in registry, adding`);
            const { getSkillVersion, getSkillDescription } = await import('../core/skill.js');
            const skillDir = path.join(skillsDir, name);
            registry.skills[name] = {
              version: getSkillVersion(skillDir),
              source: 'local',
              installedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              hash: hashDir(skillDir),
              agents: [],
              enabled: true,
              description: getSkillDescription(skillDir),
            };
            issues++;
          }
        }
      }

      if (issues > 0) {
        saveRegistry(registry, hubPath);
        gitCommit(hubPath, `sync: auto-fix ${issues} issue(s)`);
      } else {
        logger.success('Hub integrity OK');
      }

      // Step 3: Link to agents
      if (options.link) {
        const agents = Object.values(registry.agents).filter((a) => a.available && a.enabled);
        const enabledSkills = skillNames.filter((s) => registry.skills[s].enabled);

        if (agents.length === 0) {
          logger.warn('No available agents to link to');
        } else if (enabledSkills.length === 0) {
          logger.warn('No enabled skills to link');
        } else {
          logger.step('Linking skills to agents...');
          let totalLinked = 0;

          for (const agent of agents) {
            ensureDir(agent.skillsPath);

            for (const skillName of enabledSkills) {
              const srcDir = path.join(skillsDir, skillName);
              const destDir = path.join(agent.skillsPath, skillName);

              if (!exists(srcDir)) continue;

              try {
                if (exists(destDir)) {
                  removeDir(destDir);
                }
                copyDirRecursive(srcDir, destDir);

                if (!registry.skills[skillName].agents.includes(agent.name)) {
                  registry.skills[skillName].agents.push(agent.name);
                }
                totalLinked++;
              } catch (e) {
                logger.error(`  ${agent.name}/${skillName}: ${(e as Error).message}`);
              }
            }

            // Clean unmanaged skills
            if (options.clean) {
              const agentDirEntries = fs.readdirSync(agent.skillsPath, { withFileTypes: true })
                .filter((d) => d.isDirectory())
                .map((d) => d.name);
              for (const entry of agentDirEntries) {
                if (!enabledSkills.includes(entry)) {
                  logger.step(`  Removing unmanaged: ${agent.name}/${entry}`);
                  removeDir(path.join(agent.skillsPath, entry));
                }
              }
            }
          }

          saveRegistry(registry, hubPath);
          logger.success(`Linked ${totalLinked} skill(s) to ${agents.length} agent(s)`);
        }
      }

      // Step 4: Git push
      if (options.push && hasRemote(hubPath)) {
        logger.step('Pushing to remote...');
        if (gitPush(hubPath)) {
          logger.success('Pushed to remote');
        }
      }

      // Update lastSync timestamp
      registry.lastSync = new Date().toISOString();
      saveRegistry(registry, hubPath);

      logger.info(`\n${chalk.green('Sync complete!')} Last sync: ${registry.lastSync}`);
    });
}
