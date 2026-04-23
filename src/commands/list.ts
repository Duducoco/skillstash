import * as path from 'node:path';
import * as fs from 'node:fs';
import { Command } from 'commander';
import { hubExists, getSkillsPath, loadRegistry, getDefaultHubPath } from '../core/hub.js';
import { exists } from '../utils/fs.js';
import { getSkillVersion, getSkillDescription } from '../core/skill.js';
import { logger } from '../utils/logger.js';
import chalk from 'chalk';

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .alias('ls')
    .description('List installed skills and their status across agents')
    .option('-v, --verbose', 'Show detailed information')
    .action(async (options) => {
      const hubPath = getDefaultHubPath();

      if (!hubExists(hubPath)) {
        logger.error('Skills hub not initialized. Run `skill-sync init` first.');
        return;
      }

      const registry = loadRegistry(hubPath);
      const skillsDir = getSkillsPath(hubPath);
      const skillNames = Object.keys(registry.skills);

      if (skillNames.length === 0) {
        logger.info('No skills installed yet. Use `skill-sync install <name>` to add one.');
        return;
      }

      // Header
      logger.info(chalk.bold('\n  Installed Skills\n'));
      logger.info(
        chalk.gray('  ' +
          'Name'.padEnd(28) +
          'Version'.padEnd(10) +
          'Source'.padEnd(14) +
          'Agents'.padEnd(20) +
          'Status'
        )
      );
      logger.info(chalk.gray('  ' + '─'.repeat(80)));

      for (const name of skillNames) {
        const meta = registry.skills[name];
        const skillDir = path.join(skillsDir, name);
        const inHub = exists(skillDir);
        const status = inHub ? chalk.green('✓') : chalk.red('✗ missing');

        const agentList = meta.agents.length > 0
          ? meta.agents.map((a) => {
              const agent = registry.agents[a];
              if (!agent) return a;
              const agentSkillDir = path.join(agent.skillsPath, name);
              return exists(agentSkillDir) ? chalk.green(a) : chalk.red(a);
            }).join(', ')
          : chalk.gray('none');

        const line = '  ' +
          chalk.bold(name.padEnd(28)) +
          (meta.version || '?').padEnd(10) +
          meta.source.padEnd(14) +
          agentList.padEnd(30) +
          status;

        logger.info(line);

        if (options.verbose && meta.description) {
          logger.info(chalk.gray('    ' + meta.description));
        }
      }

      logger.info('');

      // Agent summary
      const agents = Object.values(registry.agents);
      logger.info(chalk.bold('  Agents\n'));
      for (const agent of agents) {
        const status = agent.available
          ? chalk.green('✓ available')
          : chalk.gray('✗ not found');
        const agentSkills = agent.available && exists(agent.skillsPath)
          ? fs.readdirSync(agent.skillsPath, { withFileTypes: true })
              .filter((d) => d.isDirectory())
              .length
          : 0;
        logger.info(`  ${chalk.bold(agent.name.padEnd(14))} ${status}  (${agentSkills} skills)  ${chalk.gray(agent.skillsPath)}`);
      }

      logger.info('');
    });
}
