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

import { registerAgentsCommand } from './commands/agents.js';
import { registerAssignCommand } from './commands/assign.js';
import { registerLanguageCommand } from './commands/language.js';
import { registerAddRemoteCommand } from './commands/add-remote.js';

import './i18n/en.js';
import './i18n/zh.js';
import { setLocale, type Locale } from './i18n/index.js';
import { loadLocalState } from './core/hub.js';

// Initialize locale from local.json before any command runs
try {
  const localState = loadLocalState();
  setLocale((localState.language ?? 'en') as Locale);
} catch {
  setLocale('en');
}

const program = new Command();

program
  .name('skillstash')
  .description('Personal skill management system with multi-device & multi-agent sync')
  .version('0.8.1')
  .helpOption('-h, --help', 'Show help');

// Register all commands
registerInitCommand(program);
registerInstallCommand(program);
registerLinkCommand(program);
registerListCommand(program);
registerSyncCommand(program);
registerDiffCommand(program);

registerRemoveCommand(program);
registerAgentsCommand(program);
registerAssignCommand(program);
registerImportCommand(program);
registerLanguageCommand(program);
registerAddRemoteCommand(program);

// Custom help display
program.addHelpText('after', `
${chalk.bold('Quick Start:')}
  $ skillstash init                         Initialize a local hub (no Git remote needed)
  $ skillstash init <remote-url>            Initialize hub and sync with a Git remote
  $ skillstash add-remote <url>             Link an existing local hub to a Git remote
  $ skillstash install clawhub:<slug>       Install a skill from ClawHub
  $ skillstash import                       Import existing skills from agent directories
  $ skillstash link                         Copy skills to all agent directories
  $ skillstash sync                         Full sync: pull + verify + link + push

${chalk.bold('Agent Management:')}
  $ skillstash agents list                  Show agents and their managed status
  $ skillstash agents select                Interactively choose which agents to manage
  $ skillstash agents enable <name>         Enable an agent for management
  $ skillstash agents disable <name>        Disable an agent (skip for link/sync)
  $ skillstash agents add <name> --path <p> Register a custom agent
  $ skillstash agents remove <name>         Unregister a custom agent
  $ skillstash assign                       Assign skills to agents on this device
  $ skillstash assign --agent claude        Configure only a specific agent

${chalk.bold('Install Sources:')}
  ClawHub       skillstash install clawhub:finance-ops
  Local path    skillstash install ./my-skill
  GitHub        skillstash install owner/repo@skill-name

${chalk.bold('Examples:')}
  $ skillstash init
  $ skillstash init git@github.com:user/my-skills.git
  $ skillstash add-remote git@github.com:user/my-skills.git
  $ skillstash install clawhub:finance-ops
  $ skillstash install owner/repo@skill-name
  $ skillstash import
  $ skillstash list -v
  $ skillstash link --agent workbuddy
  $ skillstash agents select
  $ skillstash diff
  $ skillstash sync
  $ skillstash remove old-skill
`);

program.parse();
