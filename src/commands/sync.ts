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
        logger.error('Skills hub not initialized. Run `skillstash init` first.');
        return;
      }

      const registry = loadRegistry(hubPath);

      // Step 1: Git pull (fetch + smart merge)
      if (options.pull && hasRemote(hubPath)) {
        // Abort if repo is already stuck in a MERGING state
        if (gitIsInMergeState(hubPath)) {
          logger.error(`Hub 存在未解决的合并冲突，请手动处理后重试：\n  cd "${hubPath}" && git merge --abort`);
          return;
        }

        // Auto-commit any local uncommitted changes before fetching
        const dirty = gitStatus(hubPath);
        if (dirty && dirty.trim().length > 0) {
          logger.info('检测到未提交的本地改动，自动提交...');
          gitCommit(hubPath, 'sync: auto-commit local changes before pull');
        }

        logger.step('从远端拉取更新...');
        const fetched = gitFetch(hubPath);
        if (!fetched) {
          logger.warn('Git fetch 失败，继续使用本地状态');
        } else {
          const remoteAhead = gitRevCount(hubPath, 'HEAD', 'FETCH_HEAD');
          const localAhead  = gitRevCount(hubPath, 'FETCH_HEAD', 'HEAD');

          if (remoteAhead === 0) {
            // Remote has nothing new
          } else if (localAhead === 0) {
            // Clean fast-forward — no conflict possible
            if (gitMergeFFOnly(hubPath)) {
              Object.assign(registry, loadRegistry(hubPath));
              logger.success('已拉取最新改动（快进合并）');
            } else {
              logger.warn('快进合并失败，继续使用本地状态');
            }
          } else {
            // Both sides diverged — smart three-way merge
            logger.step('检测到分叉，执行三路合并...');
            const mergeBase   = gitMergeBase(hubPath);
            const baseJson    = mergeBase ? gitShowFileContent(hubPath, mergeBase, 'registry.json') : null;
            const theirsJson  = gitShowFileContent(hubPath, 'FETCH_HEAD', 'registry.json');
            const oursRaw     = readJson<any>(getRegistryPath(hubPath));

            const base   = baseJson   ? JSON.parse(baseJson)   : { skills: {} };
            const theirs = theirsJson ? JSON.parse(theirsJson) : { skills: {} };

            const { mergedSkills, resolutions, winnerMap } = mergeSharedRegistries(base, oursRaw, theirs);

            if (resolutions.length > 0) {
              logger.info(`自动解决 ${resolutions.length} 个技能冲突：`);
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
              logger.error('合并提交失败，已自动撤销合并。请检查 hub 状态后重试。');
              return;
            }

            Object.assign(registry, loadRegistry(hubPath));
            logger.success(`合并完成${resolutions.length ? `（自动解决 ${resolutions.length} 个冲突）` : ''}`);
          }
        }
      } else if (options.pull && !hasRemote(hubPath)) {
        logger.info('未配置远端，跳过拉取');
      }

      // Step 2: Verify hub integrity
      logger.step('Verifying hub integrity...');
      const skillsDir = getSkillsPath(hubPath);
      const skillNames = Object.keys(registry.skills);
      let issues = 0;

      for (const name of skillNames) {
        const skillDir = path.join(skillsDir, name);
        if (!exists(skillDir)) {
          logger.warn(`  ${name}: directory missing in hub, removing from registry`);
          removeSkillFromRegistry(registry, name);
          issues++;
          continue;
        }
        const currentHash = hashDir(skillDir);
        if (currentHash !== registry.skills[name].hash) {
          logger.step(`  ${name}: content changed, updating hash`);
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
            logger.step(`  ${name}: found on disk but not in registry, adding`);
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
        logger.success('Hub integrity OK');
      }

      // Step 3: Link to agents
      if (options.link) {
        const agents = Object.values(registry.agents).filter((a) => a.available && a.enabled);
        const enabledSkills = skillNames.filter((s) => registry.skills[s].enabled);

        if (agents.length === 0) {
          logger.warn('No available agents to link to');
        } else if (enabledSkills.length === 0) {
          logger.warn('No enabled skills to link');
        } else {
          logger.step('Linking skills to agents...');
          let totalLinked = 0;

          for (const agent of agents) {
            ensureDir(agent.skillsPath);

            for (const skillName of enabledSkills) {
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
                logger.error(`  ${agent.name}/${skillName}: ${(e as Error).message}`);
              }
            }

            // Clean unmanaged skills
            if (options.clean) {
              const agentDirEntries = fs.readdirSync(agent.skillsPath, { withFileTypes: true })
                .filter((d) => d.isDirectory())
                .map((d) => d.name);
              for (const entry of agentDirEntries) {
                if (!enabledSkills.includes(entry)) {
                  logger.step(`  Removing unmanaged: ${agent.name}/${entry}`);
                  removeDir(path.join(agent.skillsPath, entry));
                }
              }
            }
          }

          saveRegistry(registry, hubPath);
          logger.success(`Linked ${totalLinked} skill(s) to ${agents.length} agent(s)`);
        }
      }

      // Step 4: Git push
      if (options.push && hasRemote(hubPath)) {
        logger.step('Pushing to remote...');
        if (gitPush(hubPath)) {
          logger.success('Pushed to remote');
        }
      }

      // Update lastSync timestamp
      registry.lastSync = new Date().toISOString();
      saveRegistry(registry, hubPath);

      logger.info(`\n${chalk.green('Sync complete!')} Last sync: ${registry.lastSync}`);
    });
}
