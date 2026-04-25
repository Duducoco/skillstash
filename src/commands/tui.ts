import { select, input, Separator } from '@inquirer/prompts';
import chalk from 'chalk';
import { t } from '../i18n/index.js';

type MainChoice =
  | 'init'
  | 'install'
  | 'list'
  | 'sync'
  | 'link'
  | 'diff'
  | 'import'
  | 'remove'
  | 'agents'
  | 'assign'
  | 'language'
  | 'add-remote'
  | 'exit';

type AgentsSubChoice = 'list' | 'select' | 'enable' | 'disable';

/** Pad a string to a fixed visual width. */
function pad(s: string, n: number): string {
  return s + ' '.repeat(Math.max(0, n - s.length));
}

/**
 * Launch the interactive TUI menu.
 * Returns the argument array to pass to Commander, or null if the user chose
 * to exit or the environment is non-interactive.
 */
export async function launchTUI(): Promise<string[] | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return null;
  }

  console.log(
    chalk.bold.cyan('\n╔══════════════════════════════════╗\n') +
    chalk.bold.cyan(  '║       🗂   skillstash  TUI        ║\n') +
    chalk.bold.cyan(  '╚══════════════════════════════════╝\n'),
  );

  const choice = await select<MainChoice>({
    message: t('tui.selectCommand'),
    choices: [
      { value: 'init',       name: `🚀  ${chalk.bold(pad('init',       12))}  ${chalk.gray(t('tui.initDesc'))}` },
      { value: 'install',    name: `📦  ${chalk.bold(pad('install',    12))}  ${chalk.gray(t('tui.installDesc'))}` },
      { value: 'list',       name: `📋  ${chalk.bold(pad('list',       12))}  ${chalk.gray(t('tui.listDesc'))}` },
      { value: 'sync',       name: `🔄  ${chalk.bold(pad('sync',       12))}  ${chalk.gray(t('tui.syncDesc'))}` },
      { value: 'link',       name: `🔗  ${chalk.bold(pad('link',       12))}  ${chalk.gray(t('tui.linkDesc'))}` },
      { value: 'diff',       name: `📊  ${chalk.bold(pad('diff',       12))}  ${chalk.gray(t('tui.diffDesc'))}` },
      { value: 'import',     name: `📥  ${chalk.bold(pad('import',     12))}  ${chalk.gray(t('tui.importDesc'))}` },
      { value: 'remove',     name: `🗑️   ${chalk.bold(pad('remove',     12))}  ${chalk.gray(t('tui.removeDesc'))}` },
      { value: 'agents',     name: `🤖  ${chalk.bold(pad('agents',     12))}  ${chalk.gray(t('tui.agentsDesc'))}` },
      { value: 'assign',     name: `🎯  ${chalk.bold(pad('assign',     12))}  ${chalk.gray(t('tui.assignDesc'))}` },
      { value: 'language',   name: `🌍  ${chalk.bold(pad('language',   12))}  ${chalk.gray(t('tui.languageDesc'))}` },
      { value: 'add-remote', name: `🌐  ${chalk.bold(pad('add-remote', 12))}  ${chalk.gray(t('tui.addRemoteDesc'))}` },
      new Separator(),
      { value: 'exit',       name: `🚪  ${chalk.gray(t('tui.exit'))}` },
    ],
    pageSize: 14,
  });

  if (choice === 'exit') return null;

  return buildArgs(choice);
}

async function buildArgs(choice: MainChoice): Promise<string[] | null> {
  switch (choice) {
    case 'init': {
      const url = await input({ message: t('tui.initUrlPrompt'), required: false });
      const trimmed = url.trim();
      return trimmed ? ['init', trimmed] : ['init'];
    }

    case 'install': {
      const skillName = await input({ message: t('tui.installNamePrompt'), required: true });
      return ['install', skillName.trim()];
    }

    case 'list': {
      const verbose = await select<boolean>({
        message: t('tui.listVerbosePrompt'),
        choices: [
          { value: false, name: t('tui.listNormal') },
          { value: true,  name: t('tui.listVerbose') },
        ],
      });
      return verbose ? ['list', '--verbose'] : ['list'];
    }

    case 'sync':     return ['sync'];
    case 'link':     return ['link'];
    case 'diff':     return ['diff'];
    case 'import':   return ['import'];
    case 'assign':   return ['assign'];
    case 'language': return ['language'];

    case 'remove': {
      const skillName = await input({ message: t('tui.removeNamePrompt'), required: true });
      return ['remove', skillName.trim()];
    }

    case 'agents': {
      const subCmd = await select<AgentsSubChoice>({
        message: t('tui.agentsSubcmdPrompt'),
        choices: [
          { value: 'list',    name: `${chalk.bold(pad('agents list',    18))}  ${chalk.gray(t('tui.agentsListDesc'))}` },
          { value: 'select',  name: `${chalk.bold(pad('agents select',  18))}  ${chalk.gray(t('tui.agentsSelectDesc'))}` },
          { value: 'enable',  name: `${chalk.bold(pad('agents enable',  18))}  ${chalk.gray(t('tui.agentsEnableDesc'))}` },
          { value: 'disable', name: `${chalk.bold(pad('agents disable', 18))}  ${chalk.gray(t('tui.agentsDisableDesc'))}` },
        ],
      });
      if (subCmd === 'enable' || subCmd === 'disable') {
        const agentName = await input({ message: t('tui.agentNamePrompt'), required: true });
        return ['agents', subCmd, agentName.trim()];
      }
      return ['agents', subCmd];
    }

    case 'add-remote': {
      const url = await input({ message: t('tui.addRemoteUrlPrompt'), required: true });
      return ['add-remote', url.trim()];
    }

    default:
      return null;
  }
}
