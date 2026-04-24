import * as path from 'node:path';
import { Command } from 'commander';
import { hubExists, getSkillsPath, loadRegistry, saveRegistry, getDefaultHubPath } from '../core/hub.js';
import { removeSkillFromRegistry } from '../core/registry.js';
import { exists, removeDir } from '../utils/fs.js';
import { gitCommit } from '../core/git.js';
import { logger } from '../utils/logger.js';
import { t } from '../i18n/index.js';
import chalk from 'chalk';

export function registerRemoveCommand(program: Command): void {
  program
    .command('remove <skill-name>')
    .alias('rm')
    .description('Remove a skill from the hub and all agent directories')
    .option('--keep-agents', 'Only remove from hub, keep in agent directories')
    .action(async (skillName, options) => {
      const hubPath = getDefaultHubPath();

      if (!hubExists(hubPath)) {
        logger.error(t('common.hubNotInitialized'));
        return;
      }

      const registry = loadRegistry(hubPath);
      const skillMeta = registry.skills[skillName];

      if (!skillMeta) {
        logger.error(t('remove.skillNotFound', { name: skillName }));
        return;
      }

      // Remove from hub
      const hubSkillDir = path.join(getSkillsPath(hubPath), skillName);
      if (exists(hubSkillDir)) {
        removeDir(hubSkillDir);
        logger.success(t('remove.removedFromHub', { name: skillName }));
      }

      // Remove from agent directories
      if (!options.keepAgents) {
        for (const agentName of skillMeta.agents) {
          const agent = registry.agents[agentName];
          if (!agent) continue;
          const agentSkillDir = path.join(agent.skillsPath, skillName);
          if (exists(agentSkillDir)) {
            removeDir(agentSkillDir);
            logger.success(t('remove.removedFromAgent', { agent: agentName, name: skillName }));
          }
        }
      }

      // Remove from registry
      removeSkillFromRegistry(registry, skillName);
      saveRegistry(registry, hubPath);
      gitCommit(hubPath, `remove: ${skillName}`);

      logger.info(t('remove.skillRemoved', { name: chalk.bold(skillName) }));
    });
}