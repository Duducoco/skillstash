import { Command } from 'commander';
import { hubExists, loadRegistry, saveRegistry, getDefaultHubPath, detectAgents } from '../core/hub.js';
import { setAgentEnabled, addAgentToRegistry, AgentConfig } from '../core/registry.js';
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
}