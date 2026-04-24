import * as path from 'node:path';
import * as fs from 'node:fs';
import { Command } from 'commander';
import { hubExists, getSkillsPath, loadRegistry, getDefaultHubPath } from '../core/hub.js';
import { exists } from '../utils/fs.js';
import { getSkillVersion, getSkillDescription } from '../core/skill.js';
import { logger } from '../utils/logger.js';
import chalk from 'chalk';

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

// CJK and fullwidth chars take 2 columns in a terminal
const charWidth = (ch: string) => {
  const cp = ch.codePointAt(0)!;
  if ((cp >= 0x4E00 && cp <= 0x9FFF) ||   // CJK Unified
      (cp >= 0x3400 && cp <= 0x4DBF) ||   // CJK Extension A
      (cp >= 0xF900 && cp <= 0xFAFF) ||   // CJK Compat
      (cp >= 0x3000 && cp <= 0x303F) ||   // CJK Symbols
      (cp >= 0xFF01 && cp <= 0xFF60) ||   // Fullwidth forms
      (cp >= 0xAC00 && cp <= 0xD7AF) ||   // Hangul
      (cp >= 0xFE30 && cp <= 0xFE6F)) {   // CJK Compat Forms
    return 2;
  }
  return 1;
};

const visLen = (s: string) => {
  const clean = stripAnsi(s);
  let len = 0;
  for (const ch of clean) len += charWidth(ch);
  return len;
};

const padVis = (s: string, len: number) => s + ' '.repeat(Math.max(0, len - visLen(s)));

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .alias('ls')
    .description('List installed skills and their status across agents')
    .option('-v, --verbose', 'Show detailed information')
    .action(async (options) => {
      const hubPath = getDefaultHubPath();

      if (!hubExists(hubPath)) {
        logger.error('Skills hub not initialized. Run `skillstash init` first.');
        return;
      }

      const registry = loadRegistry(hubPath);
      const skillsDir = getSkillsPath(hubPath);
      const skillNames = Object.keys(registry.skills);

      if (skillNames.length === 0) {
        logger.info('No skills installed yet. Use `skillstash install <name>` to add one.');
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
      logger.info(chalk.gray('  ' + '─'.repeat(102)));

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
          padVis(chalk.bold(name), 28) +
          (meta.version || '?').padEnd(10) +
          meta.source.padEnd(14) +
          padVis(agentList, 50) +
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
        const availStatus = agent.available
          ? chalk.green('✓ available')
          : chalk.gray('✗ not found');
        const managedStatus = agent.enabled
          ? chalk.green('✓ managed')
          : chalk.yellow('✗ disabled');
        const agentSkills = agent.available && exists(agent.skillsPath)
          ? fs.readdirSync(agent.skillsPath, { withFileTypes: true })
              .filter((d) => d.isDirectory())
              .length
          : 0;
        logger.info(`  ${chalk.bold(agent.name.padEnd(14))} ${availStatus}  ${managedStatus}  (${agentSkills} skills)  ${chalk.gray(agent.skillsPath)}`);
      }

      logger.info('');
    });
}
