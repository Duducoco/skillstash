import { Command } from 'commander';
import { hubExists, getDefaultHubPath } from '../core/hub.js';
import { gitAddRemote, gitPushSetUpstream, hasRemote } from '../core/git.js';
import { logger } from '../utils/logger.js';
import { t } from '../i18n/index.js';
import chalk from 'chalk';

export function registerAddRemoteCommand(program: Command): void {
  program
    .command('add-remote <remote-url>')
    .description('Link an existing local hub to a Git remote and push')
    .action(async (remoteUrl: string) => {
      const hubPath = getDefaultHubPath();

      if (!hubExists(hubPath)) {
        logger.error(t('common.hubNotInitialized'));
        return;
      }

      if (hasRemote(hubPath)) {
        logger.error(t('addRemote.alreadyHasRemote', { path: hubPath }));
        return;
      }

      if (!gitAddRemote(hubPath, remoteUrl)) {
        logger.error(t('addRemote.remoteAddFailed', { message: 'git remote add failed' }));
        return;
      }

      logger.step(t('addRemote.pushing'));
      if (gitPushSetUpstream(hubPath)) {
        logger.success(t('addRemote.remoteAdded', { url: chalk.cyan(remoteUrl) }));
      } else {
        logger.error(t('addRemote.remoteAddFailed', { message: 'push failed' }));
      }
    });
}
