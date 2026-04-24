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
    checked: agent.enabled,
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