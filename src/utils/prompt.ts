import { checkbox, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import { AgentConfig } from '../core/registry.js';

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
    name: `${agent.name}  ${agent.available ? chalk.green('✓ available') : chalk.gray('✗ not found')}`,
    checked: agent.available ? agent.enabled : false,
    disabled: agent.available ? false : true,
  }));

  const selected = await checkbox({
    message: 'Select agents to manage (space to toggle, enter to confirm)',
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
    message: 'Run link now? This will copy all skills from the hub to your managed agent directories.',
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
    message: `为 ${chalk.cyan(agentName)} 选择要启用的 skill（空格切换，回车确认，a 全选，i 反选）`,
    choices,
    required: false,
    pageSize: Math.min(skills.length, 20),
    shortcuts: { all: 'a', invert: 'i' },
  });
}