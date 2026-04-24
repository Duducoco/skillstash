import { Command } from 'commander';
import { hubExists, loadRegistry, saveRegistry, getDefaultHubPath, detectAgents } from '../core/hub.js';
import { setAgentEnabled, addAgentToRegistry, AgentConfig } from '../core/registry.js';
import { selectAgents } from '../utils/prompt.js';
import { logger } from '../utils/logger.js';
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
        logger.error('Skills hub not initialized. Run `skillstash init` first.');
        return;
      }

      const registry = loadRegistry(hubPath);
      const agents = Object.values(registry.agents);

      if (agents.length === 0) {
        logger.info('No agents registered.');
        return;
      }

      logger.info(chalk.bold('\n  Agents\n'));
      for (const agent of agents) {
        const availStatus = agent.available
          ? chalk.green('✓ available')
          : chalk.gray('✗ not found');
        const managedStatus = agent.enabled
          ? chalk.green('✓ managed')
          : chalk.yellow('✗ disabled');
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
        logger.error('Skills hub not initialized. Run `skillstash init` first.');
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
      logger.success(`Managing ${enabledCount} of ${total} agent(s)`);
    });

  agentsCmd
    .command('enable <name>')
    .description('Enable an agent for skillstash management')
    .action(async (name: string) => {
      const hubPath = getDefaultHubPath();

      if (!hubExists(hubPath)) {
        logger.error('Skills hub not initialized. Run `skillstash init` first.');
        return;
      }

      const registry = loadRegistry(hubPath);

      if (!registry.agents[name]) {
        logger.error(`Agent "${name}" not found in registry.`);
        logger.info('  Available agents: ' + Object.keys(registry.agents).join(', '));
        return;
      }

      setAgentEnabled(registry, name, true);
      saveRegistry(registry, hubPath);
      logger.success(`Agent "${chalk.bold(name)}" is now managed`);
    });

  agentsCmd
    .command('disable <name>')
    .description('Disable an agent (keep detected but skip for link/sync)')
    .action(async (name: string) => {
      const hubPath = getDefaultHubPath();

      if (!hubExists(hubPath)) {
        logger.error('Skills hub not initialized. Run `skillstash init` first.');
        return;
      }

      const registry = loadRegistry(hubPath);

      if (!registry.agents[name]) {
        logger.error(`Agent "${name}" not found in registry.`);
        logger.info('  Available agents: ' + Object.keys(registry.agents).join(', '));
        return;
      }

      setAgentEnabled(registry, name, false);
      saveRegistry(registry, hubPath);
      logger.success(`Agent "${chalk.bold(name)}" is now disabled (will be skipped for link/sync)`);
    });
}