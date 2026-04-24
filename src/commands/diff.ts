import * as path from 'node:path';
import * as fs from 'node:fs';
import { Command } from 'commander';
import { hubExists, getSkillsPath, loadRegistry, getDefaultHubPath } from '../core/hub.js';
import { exists, hashDir } from '../utils/fs.js';
import { logger } from '../utils/logger.js';
import { t } from '../i18n/index.js';
import chalk from 'chalk';

export function registerDiffCommand(program: Command): void {
  program
    .command('diff')
    .description('Show differences between hub and agent directories')
    .option('-a, --agent <agent>', 'Only diff specific agent')
    .action(async (options) => {
      const hubPath = getDefaultHubPath();

      if (!hubExists(hubPath)) {
        logger.error(t('common.hubNotInitialized'));
        return;
      }

      const registry = loadRegistry(hubPath);
      const skillsDir = getSkillsPath(hubPath);
      const agents = Object.values(registry.agents).filter((a) => a.available);
      const targetAgents = options.agent
        ? agents.filter((a) => a.name === options.agent)
        : agents;

      if (targetAgents.length === 0) {
        logger.warn(t('diff.noAgentsToDiff'));
        return;
      }

      const skillNames = Object.keys(registry.skills);
      let hasDiff = false;

      for (const agent of targetAgents) {
        logger.info(`\n${chalk.bold(agent.name)} (${agent.skillsPath})`);
        logger.info(chalk.gray('─'.repeat(60)));

        for (const skillName of skillNames) {
          const hubDir = path.join(skillsDir, skillName);
          const agentDir = path.join(agent.skillsPath, skillName);

          if (!exists(hubDir)) {
            logger.warn(t('diff.missingInHub', { skill: skillName }));
            hasDiff = true;
            continue;
          }

          if (!exists(agentDir)) {
            logger.warn(t('diff.notLinked', { skill: skillName }));
            hasDiff = true;
            continue;
          }

          const hubHash = hashDir(hubDir);
          const agentHash = hashDir(agentDir);

          if (hubHash !== agentHash) {
            logger.warn(t('diff.outOfSync', { skill: skillName, hubHash, agentHash }));
            hasDiff = true;
          } else {
            logger.success(t('diff.inSync', { skill: skillName }));
          }
        }

        // Check for skills in agent dir that are NOT in hub
        if (exists(agent.skillsPath)) {
          const agentOnlySkills = fs.readdirSync(agent.skillsPath, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name)
            .filter((name) => !skillNames.includes(name));

          for (const name of agentOnlySkills) {
            logger.info(t('diff.unmanaged', { skill: name }));
            hasDiff = true;
          }
        }
      }

      if (!hasDiff) {
        logger.info(t('diff.allInSync'));
      } else {
        logger.info(t('diff.runSync'));
      }
    });
}