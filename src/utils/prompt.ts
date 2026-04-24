import { checkbox, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import { AgentConfig } from '../core/registry.js';
import { t } from '../i18n/index.js';

/**
 * Interactive agent selection using @inquirer/prompts checkbox.
 * Falls back to auto-selecting all available agents in non-TTY environments.
 */
export async function selectAgents(agents: AgentConfig[]): Promise<Set<string>> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return new Set(agents.filter((a) => a.available).map((a) => a.name));
  }

  const choices = agents.map((agent) => ({
    value: agent.name,
    name: `${agent.name}  ${agent.available ? chalk.green(t('common.agentAvailable')) : chalk.gray(t('common.agentNotFound'))}`,
    checked: agent.available ? agent.enabled : false,
    disabled: agent.available ? false : true,
  }));

  const selected = await checkbox({
    message: t('prompt.selectAgents'),
    choices,
    required: false,
    shortcuts: {
      all: 'a',
      invert: 'i',
    },
  });

  return new Set(selected);
}

/**
 * Ask the user whether to run link after init.
 * Falls back to false (skip) in non-TTY environments.
 */
export async function promptLinkNow(): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }

  return confirm({
    message: t('prompt.runLinkNow'),
    default: true,
  });
}

/**
 * Interactive per-agent skill selection.
 * currentAssignment = undefined means "not configured yet" (pre-check all).
 * Falls back to returning current assignment (or all) in non-TTY environments.
 */
export async function selectSkillsForAgent(
  agentName: string,
  skills: Array<{ name: string; version: string; description?: string }>,
  currentAssignment: string[] | undefined,
): Promise<string[]> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return currentAssignment ?? skills.map((s) => s.name);
  }

  const choices = skills.map((s) => ({
    value: s.name,
    name: s.name,
    checked: currentAssignment === undefined ? true : currentAssignment.includes(s.name),
  }));

  return checkbox({
    message: t('prompt.selectSkillsForAgent', { agent: agentName }),
    choices,
    required: false,
    pageSize: Math.min(skills.length, 20),
    shortcuts: { all: 'a', invert: 'i' },
  });
}