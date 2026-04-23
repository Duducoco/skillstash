#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';

import { registerInitCommand } from './commands/init.js';
import { registerInstallCommand } from './commands/install.js';
import { registerLinkCommand } from './commands/link.js';
import { registerListCommand } from './commands/list.js';
import { registerSyncCommand } from './commands/sync.js';
import { registerDiffCommand } from './commands/diff.js';

import { registerRemoveCommand } from './commands/remove.js';
import { registerImportCommand } from './commands/import.js';

const program = new Command();

program
  .name('skill-sync')
  .description('Personal skill management system with multi-device & multi-agent sync')
  .version('0.5.0')
  .helpOption('-h, --help', 'Show help');

// Register all commands
registerInitCommand(program);
registerInstallCommand(program);
registerLinkCommand(program);
registerListCommand(program);
registerSyncCommand(program);
registerDiffCommand(program);

registerRemoveCommand(program);
registerImportCommand(program);

// Custom help display
program.addHelpText('after', `
${chalk.bold('Quick Start:')}
  $ skill-sync init <remote-url>            Initialize hub with a Git remote
  $ skill-sync install clawhub:<slug>       Install a skill from ClawHub
  $ skill-sync import                       Import existing skills from agent directories
  $ skill-sync link                         Copy skills to all agent directories
  $ skill-sync sync                         Full sync: pull + verify + link + push

${chalk.bold('Install Sources:')}
  ClawHub       skill-sync install clawhub:finance-ops
  Local path    skill-sync install ./my-skill
  GitHub        skill-sync install owner/repo@skill-name

${chalk.bold('Examples:')}
  $ skill-sync init git@github.com:user/my-skills.git
  $ skill-sync install clawhub:finance-ops
  $ skill-sync install owner/repo@skill-name
  $ skill-sync import
  $ skill-sync list -v
  $ skill-sync link --agent workbuddy
  $ skill-sync diff
  $ skill-sync sync
  $ skill-sync remove old-skill
`);

program.parse();
