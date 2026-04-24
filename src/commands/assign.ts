import * as path from 'node:path';
import * as fs from 'node:fs';
import { Command } from 'commander';
import { hubExists, getSkillsPath, loadRegistry, saveRegistry, getDefaultHubPath } from '../core/hub.js';
import { copyDirRecursive, removeDir, ensureDir, exists } from '../utils/fs.js';
import { selectSkillsForAgent, promptLinkNow } from '../utils/prompt.js';
import { gitCommit } from '../core/git.js';
import { logger } from '../utils/logger.js';
import { t } from '../i18n/index.js';
import chalk from 'chalk';

export function registerAssignCommand(program: Command): void {
  program
    .command('assign')
    .description('Interactively assign skills to agents on this device')
    .option('-a, --agent <agent>', 'Only configure specific agent')
    .action(async (options) => {
      const hubPath = getDefaultHubPath();

      if (!hubExists(hubPath)) {
        logger.error(t('common.hubNotInitialized'));
        return;
      }

      const registry = loadRegistry(hubPath);

      // Determine target agents
      const targetAgents = Object.values(registry.agents).filter(
        (a) => a.available && a.enabled && (!options.agent || a.name === options.agent),
      );

      if (targetAgents.length === 0) {
        if (options.agent) {
          logger.error(t('assign.agentNotFoundOrEnabled', { name: options.agent }));
        } else {
          logger.warn(t('assign.noAgentsToConfigure'));
        }
        return;
      }

      // Build skill list for display
      const enabledSkills = Object.entries(registry.skills)
        .filter(([, meta]) => meta.enabled)
        .map(([name, meta]) => ({ name, version: meta.version, description: meta.description }));

      if (enabledSkills.length === 0) {
        logger.warn(t('assign.noEnabledSkills'));
        return;
      }

      logger.info(t('assign.configuringHeader', { count: enabledSkills.length }) + '\n');

      // Interactive selection for each agent
      for (const agent of targetAgents) {
        logger.info(chalk.bold(`──── ${agent.name} ${'─'.repeat(Math.max(0, 50 - agent.name.length))}`));

        const currentAssignment = registry.agentSkills[agent.name];
        const selected = await selectSkillsForAgent(agent.name, enabledSkills, currentAssignment);
        registry.agentSkills[agent.name] = selected;
      }

      saveRegistry(registry, hubPath);
      logger.success(t('assign.assignmentSaved'));

      // Summarise per agent
      for (const agent of targetAgents) {
        const assigned = registry.agentSkills[agent.name] ?? [];
        logger.info(t('assign.agentSkillCount', { agent: chalk.cyan(agent.name), count: assigned.length }));
      }

      logger.info(t('assign.runLinkHint'));

      // Optionally run link now
      const runLink = await promptLinkNow();
      if (!runLink) return;

      logger.step(t('assign.linkingSkills'));
      const skillsDir = getSkillsPath(hubPath);
      let totalLinked = 0;

      for (const agent of targetAgents) {
        ensureDir(agent.skillsPath);
        const agentSkillList = registry.agentSkills[agent.name] ?? enabledSkills.map((s) => s.name);

        for (const skillName of agentSkillList) {
          const srcDir = path.join(skillsDir, skillName);
          const destDir = path.join(agent.skillsPath, skillName);

          if (!exists(srcDir)) continue;

          try {
            if (agent.linkType === 'copy') {
              if (exists(destDir)) removeDir(destDir);
              copyDirRecursive(srcDir, destDir);
            } else if (agent.linkType === 'symlink') {
              if (exists(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
              fs.symlinkSync(srcDir, destDir, 'junction');
            }

            if (!registry.skills[skillName].agents.includes(agent.name)) {
              registry.skills[skillName].agents.push(agent.name);
            }
            totalLinked++;
          } catch (e) {
            logger.error(t('common.skillLinkError', { agent: agent.name, skill: skillName, message: (e as Error).message }));
          }
        }
      }

      saveRegistry(registry, hubPath);
      gitCommit(hubPath, 'assign: update skill assignments');
      logger.success(t('assign.linkedSkills', { count: totalLinked }));
    });
}
