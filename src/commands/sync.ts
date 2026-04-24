import { Command } from 'commander';
import { hubExists, loadRegistry, saveRegistry, getDefaultHubPath, getSkillsPath, getRegistryPath } from '../core/hub.js';
import {
  gitPush, gitCommit, hasRemote, gitStatus,
  gitFetch, gitRevCount, gitMergeBase, gitShowFileContent,
  gitMergeNoCommit, gitMergeFFOnly, gitMergeAbort,
  gitIsInMergeState, gitListConflictedFiles,
  gitCheckoutOurs, gitCheckoutTheirs, gitStagePath, gitCommitMerge,
} from '../core/git.js';
import { copyDirRecursive, ensureDir, exists, removeDir, hashDir, readJson, writeJson } from '../utils/fs.js';
import { updateSkillInRegistry, removeSkillFromRegistry } from '../core/registry.js';
import { mergeSharedRegistries } from '../core/merge.js';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { logger } from '../utils/logger.js';
import { t } from '../i18n/index.js';
import chalk from 'chalk';

export function registerSyncCommand(program: Command): void {
  program
    .command('sync')
    .description('Sync skills: git pull + link to all agents + git push')
    .option('--no-pull', 'Skip git pull')
    .option('--no-push', 'Skip git push')
    .option('--no-link', 'Skip linking to agents')
    .option('--clean', 'Remove skills from agent dirs that are not in hub')
    .action(async (options) => {
      const hubPath = getDefaultHubPath();

      if (!hubExists(hubPath)) {
        logger.error(t('common.hubNotInitialized'));
        return;
      }

      const registry = loadRegistry(hubPath);

      // Step 1: Git pull (fetch + smart merge)
      if (options.pull && hasRemote(hubPath)) {
        // Abort if repo is already stuck in a MERGING state
        if (gitIsInMergeState(hubPath)) {
          logger.error(t('sync.unresolvedConflicts', { path: hubPath }));
          return;
        }

        // Auto-commit any local uncommitted changes before fetching
        const dirty = gitStatus(hubPath);
        if (dirty && dirty.trim().length > 0) {
          logger.info(t('sync.autoCommitting'));
          gitCommit(hubPath, 'sync: auto-commit local changes before pull');
        }

        logger.step('Fetching remote updates...');
        const fetched = gitFetch(hubPath);
        if (!fetched) {
          logger.warn(t('sync.fetchFailed'));
        } else {
          const remoteAhead = gitRevCount(hubPath, 'HEAD', 'FETCH_HEAD');
          const localAhead  = gitRevCount(hubPath, 'FETCH_HEAD', 'HEAD');

          if (remoteAhead === 0) {
            // Remote has nothing new
          } else if (localAhead === 0) {
            // Clean fast-forward — no conflict possible
            if (gitMergeFFOnly(hubPath)) {
              Object.assign(registry, loadRegistry(hubPath));
              logger.success(t('sync.fastForwardComplete'));
            } else {
              logger.warn(t('sync.fastForwardFailed'));
            }
          } else {
            // Both sides diverged — smart three-way merge
            logger.step(t('sync.divergedHistories'));
            const mergeBase   = gitMergeBase(hubPath);
            const baseJson    = mergeBase ? gitShowFileContent(hubPath, mergeBase, 'registry.json') : null;
            const theirsJson  = gitShowFileContent(hubPath, 'FETCH_HEAD', 'registry.json');
            const oursRaw     = readJson<any>(getRegistryPath(hubPath));

            const base   = baseJson   ? JSON.parse(baseJson)   : { skills: {} };
            const theirs = theirsJson ? JSON.parse(theirsJson) : { skills: {} };

            const { mergedSkills, resolutions, winnerMap } = mergeSharedRegistries(base, oursRaw, theirs);

            if (resolutions.length > 0) {
              logger.info(t('sync.autoResolved', { count: resolutions.length }));
              for (const r of resolutions) {
                logger.step(`  ${r.skill}: ${r.reason}`);
              }
            }

            // git merge will overwrite registry.json — run it first, then overwrite with our result
            gitMergeNoCommit(hubPath, 'FETCH_HEAD');

            // Write app-level merged registry (always wins over git's textual merge)
            writeJson(getRegistryPath(hubPath), { version: oursRaw.version ?? '1.0', skills: mergedSkills });
            gitStagePath(hubPath, 'registry.json');

            // Resolve any remaining conflicted skill files using winnerMap
            const conflicted = gitListConflictedFiles(hubPath);
            for (const file of conflicted) {
              if (file === 'registry.json') continue;
              const skillMatch = file.match(/^skills\/([^/]+)\//);
              const skillName = skillMatch?.[1];
              const winner = skillName ? winnerMap[skillName] : undefined;
              if (winner === 'theirs') {
                gitCheckoutTheirs(hubPath, file);
              } else {
                gitCheckoutOurs(hubPath, file);
              }
              gitStagePath(hubPath, file);
            }

            const committed = gitCommitMerge(hubPath, 'sync: merge remote changes');
            if (!committed) {
              gitMergeAbort(hubPath);
              logger.error(t('sync.mergeCommitFailed'));
              return;
            }

            Object.assign(registry, loadRegistry(hubPath));
            logger.success(resolutions.length ? t('sync.mergeCompleteWithResolutions', { count: resolutions.length }) : t('sync.mergeComplete'));
          }
        }
      } else if (options.pull && !hasRemote(hubPath)) {
        logger.info(t('sync.noRemote'));
      }

      // Step 2: Verify hub integrity
      logger.step(t('sync.verifyingIntegrity'));
      const skillsDir = getSkillsPath(hubPath);
      const skillNames = Object.keys(registry.skills);
      let issues = 0;

      for (const name of skillNames) {
        const skillDir = path.join(skillsDir, name);
        if (!exists(skillDir)) {
          logger.warn(t('sync.skillDirMissing', { name }));
          removeSkillFromRegistry(registry, name);
          issues++;
          continue;
        }
        const currentHash = hashDir(skillDir);
        if (currentHash !== registry.skills[name].hash) {
          logger.step(t('sync.skillHashChanged', { name }));
          updateSkillInRegistry(registry, name, { hash: currentHash });
          issues++;
        }
      }

      // Check for skills on disk not in registry
      if (exists(skillsDir)) {
        const onDisk = fs.readdirSync(skillsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name);

        for (const name of onDisk) {
          if (!registry.skills[name]) {
            logger.step(t('sync.skillFoundOnDisk', { name }));
            const { getSkillVersion, getSkillDescription } = await import('../core/skill.js');
            const skillDir = path.join(skillsDir, name);
            registry.skills[name] = {
              version: getSkillVersion(skillDir),
              source: 'local',
              installedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              hash: hashDir(skillDir),
              agents: [],
              enabled: true,
              description: getSkillDescription(skillDir),
            };
            issues++;
          }
        }
      }

      if (issues > 0) {
        saveRegistry(registry, hubPath);
        gitCommit(hubPath, `sync: auto-fix ${issues} issue(s)`);
      } else {
        logger.success(t('sync.integrityOk'));
      }

      // Step 3: Link to agents
      if (options.link) {
        const agents = Object.values(registry.agents).filter((a) => a.available && a.enabled);
        const enabledSkills = skillNames.filter((s) => registry.skills[s].enabled);

        if (agents.length === 0) {
          logger.warn(t('sync.noAgentsToLink'));
        } else if (enabledSkills.length === 0) {
          logger.warn(t('sync.noSkillsToLink'));
        } else {
          logger.step(t('sync.linkingSkills'));
          let totalLinked = 0;

          for (const agent of agents) {
            ensureDir(agent.skillsPath);

            // Apply per-device skill assignment if configured
            const deviceFilter = registry.agentSkills?.[agent.name];
            const agentSkillList = deviceFilter !== undefined
              ? enabledSkills.filter((s) => deviceFilter.includes(s))
              : enabledSkills;

            for (const skillName of agentSkillList) {
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

            // Clean unmanaged skills
            if (options.clean) {
              const agentDirEntries = fs.readdirSync(agent.skillsPath, { withFileTypes: true })
                .filter((d) => d.isDirectory())
                .map((d) => d.name);
              for (const entry of agentDirEntries) {
                if (!agentSkillList.includes(entry)) {
                  logger.step(t('common.removingUnmanaged', { agent: agent.name, skill: entry }));
                  removeDir(path.join(agent.skillsPath, entry));
                }
              }
            }
          }

          saveRegistry(registry, hubPath);
          logger.success(t('common.linkedSkillsAgents', { count: totalLinked, agents: agents.length }));
        }
      }

      // Step 4: Git push
      if (options.push && hasRemote(hubPath)) {
        logger.step(t('common.pushing'));
        if (gitPush(hubPath)) {
          logger.success(t('common.pushed'));
        }
      }

      // Update lastSync timestamp
      registry.lastSync = new Date().toISOString();
      saveRegistry(registry, hubPath);

      logger.info(t('sync.syncComplete', { time: registry.lastSync ?? '' }));
    });
}
