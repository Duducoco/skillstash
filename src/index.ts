#!/usr/bin/env node

import { createRequire } from 'module';
import { Command } from 'commander';
import chalk from 'chalk';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

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
  .version(version)
  .helpOption('-h, --help', 'Show help');

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

async function registerAllCommands(): Promise<void> {
  const [
    { registerInitCommand },
    { registerInstallCommand },
    { registerLinkCommand },
    { registerListCommand },
    { registerSyncCommand },
    { registerDiffCommand },
    { registerRemoveCommand },
    { registerAgentsCommand },
    { registerAssignCommand },
    { registerImportCommand },
    { registerLanguageCommand },
    { registerAddRemoteCommand },
  ] = await Promise.all([
    import('./commands/init.js'),
    import('./commands/install.js'),
    import('./commands/link.js'),
    import('./commands/list.js'),
    import('./commands/sync.js'),
    import('./commands/diff.js'),
    import('./commands/remove.js'),
    import('./commands/agents.js'),
    import('./commands/assign.js'),
    import('./commands/import.js'),
    import('./commands/language.js'),
    import('./commands/add-remote.js'),
  ]);

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
}

// When invoked with no arguments and in an interactive terminal, launch TUI.
// Explicit subcommands, flags, and `--help` / `--version` bypass TUI.
const rawArgs = process.argv.slice(2);
const hasFlagOrCmd = rawArgs.length > 0;

if (!hasFlagOrCmd) {
  // TUI path: load React/Ink only here; command modules loaded only if TUI returns args
  const { launchTUI } = await import('./commands/tui.js');
  const selectedArgs = await launchTUI();
  if (selectedArgs !== null) {
    await registerAllCommands();
    await program.parseAsync(selectedArgs, { from: 'user' });
  }
} else {
  // CLI path: load command modules; skip React/Ink entirely
  await registerAllCommands();
  await program.parseAsync(process.argv);
}
