import * as path from 'node:path';
import * as fs from 'node:fs';
import { Command } from 'commander';
import { hubExists, getSkillsPath, loadRegistry, saveRegistry, getDefaultHubPath } from '../core/hub.js';
import { copyDirRecursive, removeDir, ensureDir, exists } from '../utils/fs.js';
import { updateSkillInRegistry } from '../core/registry.js';
import { gitCommit } from '../core/git.js';
import { logger } from '../utils/logger.js';
import { t } from '../i18n/index.js';
import chalk from 'chalk';

export function registerLinkCommand(program: Command): void {
  program
    .command('link')
    .description('Copy skills from hub to agent directories')
    .option('-a, --agent <agent>', 'Only link to specific agent')
    .option('-s, --skill <skill>', 'Only link specific skill')
    .option('--clean', 'Remove skills from agent dirs that are not in hub')
    .action(async (options) => {
      const hubPath = getDefaultHubPath();

      if (!hubExists(hubPath)) {
        logger.error(t('common.hubNotInitialized'));
        return;
      }

      const registry = loadRegistry(hubPath);
      const agents = Object.values(registry.agents);
      const skillsDir = getSkillsPath(hubPath);

      // Filter agents
      const targetAgents = options.agent
        ? agents.filter((a) => a.name === options.agent)
        : agents.filter((a) => a.available && a.enabled);

      if (targetAgents.length === 0) {
        logger.warn(t('link.noAgentsToLink'));
        return;
      }

      // Get skill list
      let skillNames = Object.keys(registry.skills).filter((s) => registry.skills[s].enabled);
      if (options.skill) {
        skillNames = skillNames.filter((s) => s === options.skill);
      }

      if (skillNames.length === 0) {
        logger.warn(t('link.noSkillsToLink'));
        return;
      }

      let totalLinked = 0;

      for (const agent of targetAgents) {
        logger.info(`\n${chalk.bold(agent.name)} → ${chalk.gray(agent.skillsPath)}`);
        ensureDir(agent.skillsPath);

        // Apply per-device skill assignment if configured
        const deviceFilter = registry.agentSkills?.[agent.name];
        const agentSkillNames = deviceFilter !== undefined
          ? skillNames.filter((s) => deviceFilter.includes(s))
          : skillNames;

        for (const skillName of agentSkillNames) {
          const srcDir = path.join(skillsDir, skillName);
          const destDir = path.join(agent.skillsPath, skillName);

          if (!exists(srcDir)) {
            logger.warn(t('link.skillSourceMissing', { skill: skillName }));
            continue;
          }

          try {
            if (agent.linkType === 'copy') {
              // Remove old copy first for clean sync
              if (exists(destDir)) {
                removeDir(destDir);
              }
              copyDirRecursive(srcDir, destDir);
            } else if (agent.linkType === 'symlink' || agent.linkType === 'junction') {
              if (exists(destDir)) {
                fs.rmSync(destDir, { recursive: true, force: true });
              }
              try {
                fs.symlinkSync(srcDir, destDir, 'junction');
              } catch {
                // junction/symlink may fail on restricted environments — fall back to copy
                copyDirRecursive(srcDir, destDir);
              }
            } else {
              logger.warn(`  ! ${skillName}: unsupported link type "${agent.linkType}"`);
              continue;
            }

            // Update registry to track which agents have this skill
            if (!registry.skills[skillName].agents.includes(agent.name)) {
              registry.skills[skillName].agents.push(agent.name);
            }

            logger.success(`  ✓ ${skillName}`);
            totalLinked++;
          } catch (e) {
            logger.error(`  ✗ ${skillName}: ${(e as Error).message}`);
          }
        }

        // Clean mode: remove skills not in hub
        if (options.clean) {
          const agentDirEntries = fs.readdirSync(agent.skillsPath, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);

          for (const entry of agentDirEntries) {
            if (!agentSkillNames.includes(entry)) {
              const removePath = path.join(agent.skillsPath, entry);
              logger.step(t('link.removingUnmanaged', { name: entry }));
              removeDir(removePath);
            }
          }
        }
      }

      saveRegistry(registry, hubPath);
      logger.info(t('link.linked', { count: totalLinked, agents: targetAgents.length }));
    });
}
