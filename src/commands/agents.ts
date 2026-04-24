import { Command } from 'commander';
import { hubExists, loadRegistry, saveRegistry, getDefaultHubPath, detectAgents, loadLocalState, saveLocalState } from '../core/hub.js';
import { setAgentEnabled, addAgentToRegistry, AgentConfig } from '../core/registry.js';
import { isBuiltinAgent } from '../core/agents.js';
import type { AgentDefinition } from '../core/agents.js';
import { selectAgents } from '../utils/prompt.js';
import { logger } from '../utils/logger.js';
import { t } from '../i18n/index.js';
import chalk from 'chalk';

export function registerAgentsCommand(program: Command): void {
  const agentsCmd = program
    .command('agents')
    .description('Manage which agents skillstash syncs with');

  agentsCmd
    .command('list')
    .alias('ls')
    .description('Show all agents and their managed status')
    .action(async () => {
      const hubPath = getDefaultHubPath();

      if (!hubExists(hubPath)) {
        logger.error(t('common.hubNotInitialized'));
        return;
      }

      const registry = loadRegistry(hubPath);
      const agents = Object.values(registry.agents);

      if (agents.length === 0) {
        logger.info(t('agents.noAgentsRegistered'));
        return;
      }

      logger.info(chalk.bold(`\n  ${t('agents.header')}\n`));
      for (const agent of agents) {
        const availStatus = agent.available
          ? chalk.green(t('common.agentAvailable'))
          : chalk.gray(t('common.agentNotFound'));
        const managedStatus = agent.enabled
          ? chalk.green(t('common.agentManaged'))
          : chalk.yellow(t('common.agentDisabled'));
        logger.info(`  ${chalk.bold(agent.name.padEnd(14))} ${availStatus}  ${managedStatus}  ${chalk.gray(agent.skillsPath)}`);
      }
      logger.info('');
    });

  agentsCmd
    .command('select')
    .description('Interactively choose which agents to manage')
    .action(async () => {
      const hubPath = getDefaultHubPath();

      if (!hubExists(hubPath)) {
        logger.error(t('common.hubNotInitialized'));
        return;
      }

      const registry = loadRegistry(hubPath);
      const agents = Object.values(registry.agents);

      // Re-detect to update availability
      const detected = detectAgents();
      for (const agent of detected) {
        if (!registry.agents[agent.name]) {
          addAgentToRegistry(registry, agent.name, agent);
        } else {
          registry.agents[agent.name].available = agent.available;
        }
      }

      const selectedNames = await selectAgents(Object.values(registry.agents));

      for (const agent of Object.values(registry.agents)) {
        setAgentEnabled(registry, agent.name, selectedNames.has(agent.name));
      }

      saveRegistry(registry, hubPath);

      const enabledCount = Object.values(registry.agents).filter((a) => a.enabled).length;
      const total = Object.keys(registry.agents).length;
      logger.success(t('agents.managingCount', { enabled: enabledCount, total }));
    });

  agentsCmd
    .command('enable <name>')
    .description('Enable an agent for skillstash management')
    .action(async (name: string) => {
      const hubPath = getDefaultHubPath();

      if (!hubExists(hubPath)) {
        logger.error(t('common.hubNotInitialized'));
        return;
      }

      const registry = loadRegistry(hubPath);

      if (!registry.agents[name]) {
        logger.error(t('common.agentNotInRegistry', { name }));
        logger.info(t('common.availableAgents', { list: Object.keys(registry.agents).join(', ') }));
        return;
      }

      setAgentEnabled(registry, name, true);
      saveRegistry(registry, hubPath);
      logger.success(t('agents.agentNowManaged', { name: chalk.bold(name) }));
    });

  agentsCmd
    .command('disable <name>')
    .description('Disable an agent (keep detected but skip for link/sync)')
    .action(async (name: string) => {
      const hubPath = getDefaultHubPath();

      if (!hubExists(hubPath)) {
        logger.error(t('common.hubNotInitialized'));
        return;
      }

      const registry = loadRegistry(hubPath);

      if (!registry.agents[name]) {
        logger.error(t('common.agentNotInRegistry', { name }));
        logger.info(t('common.availableAgents', { list: Object.keys(registry.agents).join(', ') }));
        return;
      }

      setAgentEnabled(registry, name, false);
      saveRegistry(registry, hubPath);
      logger.success(t('agents.agentNowDisabled', { name: chalk.bold(name) }));
    });

  agentsCmd
    .command('add <name>')
    .description('Register a custom agent definition')
    .requiredOption('--path <skills-path>', 'Absolute path to the agent\'s skills directory')
    .option('--link-type <type>', 'Link type: copy, symlink, or junction', 'copy')
    .action(async (name: string, options: { path: string; linkType: string }) => {
      const hubPath = getDefaultHubPath();

      if (!hubExists(hubPath)) {
        logger.error(t('common.hubNotInitialized'));
        return;
      }

      if (isBuiltinAgent(name)) {
        logger.warn(t('agents.builtinCannotRemove', { name }));
        return;
      }

      const linkType = options.linkType as 'copy' | 'symlink' | 'junction';
      const def: AgentDefinition = { name, skillsPath: options.path, linkType };

      const localState = loadLocalState(hubPath);
      const customAgents = localState.customAgents ?? [];
      const existingIdx = customAgents.findIndex((a) => a.name === name);
      if (existingIdx >= 0) {
        customAgents[existingIdx] = def;
      } else {
        customAgents.push(def);
      }
      localState.customAgents = customAgents;
      saveLocalState(localState, hubPath);

      // Also register in the registry agents map
      const registry = loadRegistry(hubPath);
      const { existsSync } = await import('node:fs');
      const { dirname } = await import('node:path');
      const agentConfig: AgentConfig = {
        name,
        skillsPath: options.path,
        linkType,
        available: existsSync(dirname(options.path)),
        enabled: true,
      };
      addAgentToRegistry(registry, name, agentConfig);
      saveRegistry(registry, hubPath);

      logger.success(t('agents.agentAdded', { name: chalk.bold(name), path: options.path }));
      logger.info(t('agents.customAgentHint'));
    });

  agentsCmd
    .command('remove <name>')
    .description('Unregister a custom agent (built-in agents cannot be removed)')
    .action(async (name: string) => {
      const hubPath = getDefaultHubPath();

      if (!hubExists(hubPath)) {
        logger.error(t('common.hubNotInitialized'));
        return;
      }

      if (isBuiltinAgent(name)) {
        logger.error(t('agents.builtinCannotRemove', { name }));
        return;
      }

      const localState = loadLocalState(hubPath);
      const customAgents = localState.customAgents ?? [];
      const idx = customAgents.findIndex((a) => a.name === name);
      if (idx < 0) {
        logger.error(t('common.agentNotInRegistry', { name }));
        return;
      }
      customAgents.splice(idx, 1);
      localState.customAgents = customAgents;
      saveLocalState(localState, hubPath);

      // Remove from registry agents map
      const registry = loadRegistry(hubPath);
      delete registry.agents[name];
      saveRegistry(registry, hubPath);

      logger.success(t('agents.agentRemoved', { name: chalk.bold(name) }));
    });
}