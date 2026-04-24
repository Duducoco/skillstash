import * as path from 'node:path';
import * as fs from 'node:fs';
import { Command } from 'commander';
import { initHub, hubExists, getDefaultHubPath, loadRegistry, saveRegistry, detectAgents, getSkillsPath, loadLocalState, saveLocalState } from '../core/hub.js';
import { addSkillToRegistry, setAgentEnabled } from '../core/registry.js';
import { selectAgents, promptLinkNow } from '../utils/prompt.js';
import { gitInit, gitProbeRemote, gitClone, gitAddRemote, gitPushSetUpstream, gitCommit } from '../core/git.js';
import { copyDirRecursive, hashDir, exists, ensureDir, removeDir } from '../utils/fs.js';
import { getSkillVersion, getSkillDescription, lintSkill } from '../core/skill.js';
import { logger } from '../utils/logger.js';
import { select } from '@inquirer/prompts';
import { setLocale, type Locale, t } from '../i18n/index.js';
import chalk from 'chalk';

interface DiscoveredSkill {
  name: string;
  sourcePath: string;
  isSymlink: boolean;
  fromAgent: string;
  linkTarget?: string;
}

/**
 * Scan an agent directory for skills, resolving symlinks/Junctions
 */
function scanAgentDir(agentName: string, agentSkillsPath: string): DiscoveredSkill[] {
  const results: DiscoveredSkill[] = [];
  if (!exists(agentSkillsPath)) return results;

  const entries = fs.readdirSync(agentSkillsPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith('.')) continue;

    const fullPath = path.join(agentSkillsPath, entry.name);
    let isSymlink = false;
    let linkTarget: string | undefined;
    let realPath = fullPath;

    try {
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink()) {
        isSymlink = true;
        linkTarget = fs.readlinkSync(fullPath) as string;
        if (!path.isAbsolute(linkTarget)) {
          linkTarget = path.resolve(path.dirname(fullPath), linkTarget);
        }
        realPath = linkTarget;
      }
    } catch {
      continue;
    }

    const skillMdPath = path.join(realPath, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) continue;

    results.push({ name: entry.name, sourcePath: realPath, isSymlink, fromAgent: agentName, linkTarget });
  }

  return results;
}

/**
 * Import skills discovered from agent directories into the hub
 */
function importDiscoveredSkills(hubPath: string, registry: ReturnType<typeof loadRegistry>, discovered: Map<string, DiscoveredSkill>): number {
  const skillsDir = getSkillsPath(hubPath);
  let imported = 0;

  // Deduplicate by source path
  const bySourcePath = new Map<string, { name: string; skill: DiscoveredSkill }>();
  for (const [name, skill] of discovered) {
    const key = skill.sourcePath.toLowerCase();
    if (!bySourcePath.has(key)) {
      bySourcePath.set(key, { name, skill });
    }
  }

  for (const [, { name, skill }] of bySourcePath) {
    // Skip if already in registry
    if (registry.skills[name]) continue;

    const destDir = path.join(skillsDir, name);
    if (exists(destDir)) continue;

    // Lint
    const lintResult = lintSkill(skill.sourcePath);
    if (!lintResult.valid) {
      logger.warn(t('common.skippingLintFailed', { name }));
      continue;
    }

    logger.step(t('init.importingSkill', { name: chalk.bold(name) }));
    copyDirRecursive(skill.sourcePath, destDir);

    const version = getSkillVersion(destDir);
    const hash = hashDir(destDir);
    const description = getSkillDescription(destDir);

    addSkillToRegistry(registry, name, {
      version,
      source: 'local',
      hash,
      description: description || undefined,
      agents: [],
    });

    imported++;
  }

  return imported;
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize the skills-hub (local-only by default; provide <remote-url> to sync via Git)')
    .argument('[remote-url]', 'Optional remote Git repository URL (e.g. git@github.com:user/skills.git)')
    .action(async (remoteUrl: string | undefined) => {
      const hubPath = getDefaultHubPath();

      // ── Language selection: MUST be first, before any logger call ──
      let selectedLang: Locale = 'en';
      if (process.stdin.isTTY && process.stdout.isTTY) {
        selectedLang = await select<Locale>({
          message: t('prompt.selectLanguage'),
          choices: [
            { value: 'en', name: 'English' },
            { value: 'zh', name: '中文' },
          ],
        });
      }
      setLocale(selectedLang);
      // ── End language selection ──

      // Check if hub already exists
      if (hubExists(hubPath)) {
        logger.warn(t('init.alreadyExists', { path: hubPath }));
        const reg = loadRegistry(hubPath);
        logger.info(t('init.alreadyExistsStats', { skills: Object.keys(reg.skills).length, agents: Object.keys(reg.agents).length }));
        logger.info(t('init.alreadyExistsHint'));
        return;
      }

      if (!remoteUrl) {
        // ─── Local-only mode ───
        logger.info(t('init.localMode'));
        await initLocalHub(hubPath);
      } else {
        // ─── Remote mode: probe → fresh or clone ───
        logger.step(t('init.probingRemote', { url: chalk.cyan(remoteUrl) }));
        const probe = gitProbeRemote(remoteUrl);

        if (probe.error) {
          logger.error(t('init.cannotAccessRemote', { error: probe.error }));
          logger.info(t('init.checkUrlCredentials'));
          return;
        }

        if (probe.empty) {
          logger.info(t('init.remoteEmpty'));
          await initFreshHub(hubPath, remoteUrl);
        } else if (probe.hasRegistry) {
          logger.info(t('init.remoteHasHub'));
          await cloneAndImport(hubPath, remoteUrl);
        } else {
          logger.error(t('init.remoteNotEmpty'));
          logger.error(t('init.noRegistryFound'));
          logger.info('');
          logger.info(t('init.pleaseEither'));
          logger.info(`    ${t('init.pleaseDo1')}`);
          logger.info(`    ${t('init.pleaseDo2')}`);
          return;
        }
      }

      // Persist language preference to local.json
      const localState = loadLocalState(hubPath);
      localState.language = selectedLang;
      saveLocalState(localState, hubPath);
    });
}

/**
 * Local-only mode: create hub, init git, detect agents, import skills. No remote.
 */
export async function initLocalHub(
  hubPath: string,
  agentSelector?: (agents: import('../core/registry.js').AgentConfig[]) => Promise<Set<string>>,
  linkPrompter?: () => Promise<boolean>
): Promise<void> {
  const result = initHub(hubPath);
  if (!result.created) {
    logger.error(t('init.failedCreateHub'));
    return;
  }
  logger.success(t('init.hubDirCreated'));
  logger.success(t('init.registryInitialized'));

  if (!gitInit(hubPath)) {
    logger.error(t('init.gitInitFailed'));
    return;
  }
  logger.success(t('init.gitInitialized'));

  const registry = loadRegistry(hubPath);
  const allAgents = Object.values(registry.agents);
  const selector = agentSelector ?? selectAgents;
  const selectedNames = await selector(allAgents);
  for (const agent of allAgents) {
    setAgentEnabled(registry, agent.name, selectedNames.has(agent.name));
  }
  saveRegistry(registry, hubPath);

  const agents = Object.values(registry.agents).filter((a) => a.available && a.enabled);
  if (agents.length > 0) {
    logger.step(t('init.scanningAgentDirs'));
    const discovered = new Map<string, DiscoveredSkill>();
    for (const agent of agents) {
      const skills = scanAgentDir(agent.name, agent.skillsPath);
      for (const skill of skills) {
        if (!discovered.has(skill.name)) discovered.set(skill.name, skill);
      }
      if (skills.length > 0) {
        logger.info(t('init.agentFoundSkills', { agent: agent.name, count: skills.length }));
      }
    }
    if (discovered.size > 0) {
      const imported = importDiscoveredSkills(hubPath, registry, discovered);
      if (imported > 0) {
        saveRegistry(registry, hubPath);
        logger.success(t('init.importedSkillsFromAgents', { count: imported }));
      }
    } else {
      logger.info(t('init.noExistingSkills'));
    }
  }

  gitCommit(hubPath, 'init: create local skillstash hub');

  await showInitSummary(hubPath, registry, linkPrompter);
  logger.info('');
  logger.info(t('init.localNote'));
}

/**
 * Case 1: Empty remote → create fresh hub, push to remote
 */
export async function initFreshHub(
  hubPath: string,
  remoteUrl: string,
  agentSelector?: (agents: import('../core/registry.js').AgentConfig[]) => Promise<Set<string>>,
  linkPrompter?: () => Promise<boolean>
): Promise<void> {
  // Create hub structure
  const result = initHub(hubPath);
  if (!result.created) {
    logger.error(t('init.failedCreateHub'));
    return;
  }
  logger.success(t('init.hubDirCreated'));
  logger.success(t('init.registryInitialized'));

  // Initialize git
  if (!gitInit(hubPath)) {
    logger.error(t('init.gitInitFailed'));
    return;
  }
  logger.success(t('init.gitInitialized'));

  // Interactive agent selection
  const registry = loadRegistry(hubPath);
  const allAgents = Object.values(registry.agents);
  const selector = agentSelector ?? selectAgents;
  const selectedNames = await selector(allAgents);
  for (const agent of allAgents) {
    setAgentEnabled(registry, agent.name, selectedNames.has(agent.name));
  }
  saveRegistry(registry, hubPath);

  // Import any existing agent skills (only from managed agents)
  const agents = Object.values(registry.agents).filter((a) => a.available && a.enabled);

  if (agents.length > 0) {
    logger.step(t('init.scanningAgentDirs'));
    const discovered = new Map<string, DiscoveredSkill>();

    for (const agent of agents) {
      const skills = scanAgentDir(agent.name, agent.skillsPath);
      for (const skill of skills) {
        if (!discovered.has(skill.name)) {
          discovered.set(skill.name, skill);
        }
      }
      if (skills.length > 0) {
        logger.info(t('init.agentFoundSkills', { agent: agent.name, count: skills.length }));
      }
    }

    if (discovered.size > 0) {
      const imported = importDiscoveredSkills(hubPath, registry, discovered);
      if (imported > 0) {
        saveRegistry(registry, hubPath);
        logger.success(t('init.importedSkillsFromAgents', { count: imported }));
      }
    } else {
      logger.info(t('init.noExistingSkills'));
    }
  }

  // Commit and push
  gitCommit(hubPath, 'init: create skillstash hub');
  gitAddRemote(hubPath, remoteUrl);
  logger.step(t('common.pushing'));

  if (gitPushSetUpstream(hubPath)) {
    logger.success(t('common.pushed'));
  } else {
    logger.warn(t('common.pushFailed'));
  }

  // Show summary
  await showInitSummary(hubPath, registry, linkPrompter);
}

/**
 * Case 2: Non-empty remote with registry.json → clone + import agent skills
 */
export async function cloneAndImport(
  hubPath: string,
  remoteUrl: string,
  agentSelector?: (agents: import('../core/registry.js').AgentConfig[]) => Promise<Set<string>>,
  linkPrompter?: () => Promise<boolean>
): Promise<void> {
  // Ensure parent directory exists
  fs.mkdirSync(path.dirname(hubPath), { recursive: true });

  // Clone
  logger.step(t('init.cloning'));
  if (!gitClone(remoteUrl, hubPath)) {
    logger.error(t('init.cloneFailed'));
    return;
  }
  logger.success(t('init.cloned'));

  // Verify registry.json exists in cloned repo
  const registryPath = path.join(hubPath, 'registry.json');
  if (!fs.existsSync(registryPath)) {
    logger.error(t('init.noRegistryInClone'));
    logger.info(t('init.checkRepoContents'));
    return;
  }

  // Load the cloned registry
  const registry = loadRegistry(hubPath);

  // Re-detect agents on this machine (may differ from the machine that pushed)
  const currentAgents = detectAgents();
  for (const agent of currentAgents) {
    if (!registry.agents[agent.name]) {
      registry.agents[agent.name] = agent;
    } else {
      // Update availability status
      registry.agents[agent.name].available = agent.available;
    }
  }

  // Interactive agent selection
  const allAgents = Object.values(registry.agents);
  const selector = agentSelector ?? selectAgents;
  const selectedNames = await selector(allAgents);
  for (const agent of allAgents) {
    setAgentEnabled(registry, agent.name, selectedNames.has(agent.name));
  }
  saveRegistry(registry, hubPath);

  // Import any agent skills not yet in the hub (only from managed agents)
  const availableAgents = Object.values(registry.agents).filter((a) => a.available && a.enabled);
  if (availableAgents.length > 0) {
    logger.step(t('init.scanningAgentNew'));
    const discovered = new Map<string, DiscoveredSkill>();

    for (const agent of availableAgents) {
      const skills = scanAgentDir(agent.name, agent.skillsPath);
      // Only count skills NOT already in hub
      const newSkills = skills.filter((s) => !registry.skills[s.name]);
      for (const skill of newSkills) {
        if (!discovered.has(skill.name)) {
          discovered.set(skill.name, skill);
        }
      }
      if (newSkills.length > 0) {
        logger.info(t('init.agentFoundNewSkills', { agent: agent.name, count: newSkills.length }));
      }
    }

    if (discovered.size > 0) {
      const imported = importDiscoveredSkills(hubPath, registry, discovered);
      if (imported > 0) {
        saveRegistry(registry, hubPath);
        gitCommit(hubPath, `init: import ${imported} skill(s) from local agents`);
        logger.success(t('init.importedNewSkillsFromAgents', { count: imported }));

        // Push the imported skills
        logger.step(t('init.pushingImported'));
        if (gitPushSetUpstream(hubPath)) {
          logger.success(t('common.pushed'));
        }
      }
    } else {
      logger.info(t('init.noNewFromAgents'));
    }
  }

  const skillCount = Object.keys(registry.skills).length;
  logger.info(t('init.hubContains', { count: chalk.bold(skillCount) }));

  // Show summary
  await showInitSummary(hubPath, registry, linkPrompter);
}

/**
 * Run link during init — copy skills from hub to managed agent directories
 */
async function runInitLink(
  hubPath: string,
  registry: ReturnType<typeof loadRegistry>,
  agents: import('../core/registry.js').AgentConfig[],
  skillNames: string[]
): Promise<void> {
  const skillsDir = getSkillsPath(hubPath);
  let totalLinked = 0;

  logger.step(t('common.linkingSkillsToAgents'));

  for (const agent of agents) {
    ensureDir(agent.skillsPath);

    for (const skillName of skillNames) {
      const srcDir = path.join(skillsDir, skillName);
      const destDir = path.join(agent.skillsPath, skillName);

      if (!exists(srcDir)) continue;

      try {
        if (exists(destDir)) {
          removeDir(destDir);
        }
        copyDirRecursive(srcDir, destDir);

        if (!registry.skills[skillName].agents.includes(agent.name)) {
          registry.skills[skillName].agents.push(agent.name);
        }
        totalLinked++;
      } catch (e) {
        logger.error(t('common.skillLinkError', { agent: agent.name, skill: skillName, message: (e as Error).message }));
      }
    }
  }

  saveRegistry(registry, hubPath);
  logger.success(t('common.linkedSkillsAgents', { count: totalLinked, agents: agents.length }));
}

/**
 * Display the post-init summary and optionally run link
 */
async function showInitSummary(
  hubPath: string,
  registry: ReturnType<typeof loadRegistry>,
  linkPrompter?: () => Promise<boolean>
): Promise<void> {
  const agents = Object.values(registry.agents);
  const skillCount = Object.keys(registry.skills).length;

  logger.info('');
  logger.info(t('init.detectedAgentsHeader'));
  for (const agent of agents) {
    const availStatus = agent.available
      ? chalk.green(t('common.agentAvailable'))
      : chalk.gray(t('common.agentNotFound'));
    const managedStatus = agent.enabled
      ? chalk.green(t('common.agentManaged'))
      : chalk.yellow(t('common.agentDisabled'));
    logger.info(`  ${chalk.bold(agent.name)}: ${availStatus}  ${managedStatus} → ${chalk.gray(agent.skillsPath)}`);
  }

  logger.info('');
  logger.success(t('init.done', { path: chalk.cyan(hubPath) }));
  logger.info(t('init.skillsCount', { count: skillCount }));

  // Prompt to run link now
  const managedAgents = agents.filter((a) => a.available && a.enabled);
  const skillNames = Object.keys(registry.skills).filter((s) => registry.skills[s].enabled);

  if (managedAgents.length > 0 && skillNames.length > 0) {
    const shouldLink = await (linkPrompter ?? promptLinkNow)();
    if (shouldLink) {
      await runInitLink(hubPath, registry, managedAgents, skillNames);
    }
  }

  logger.info('');
  logger.info(t('init.nextSteps'));
  logger.info(`  ${chalk.cyan('skillstash install <name>')}  — ${t('init.nextInstall')}`);
  logger.info(`  ${chalk.cyan('skillstash link')}           — ${t('init.nextLink')}`);
  logger.info(`  ${chalk.cyan('skillstash sync')}           — ${t('init.nextSync')}`);
}
