import { Command } from 'commander';
import { select } from '@inquirer/prompts';
import { loadLocalState, saveLocalState, getDefaultHubPath } from '../core/hub.js';
import { setLocale, getLocale, type Locale } from '../i18n/index.js';
import { t } from '../i18n/index.js';
import { logger } from '../utils/logger.js';

export function registerLanguageCommand(program: Command): void {
  program
    .command('language')
    .description('Set the display language (en / zh)')
    .action(async () => {
      const hubPath = getDefaultHubPath();
      const currentLang = getLocale();

      logger.info(t('language.currentLanguage', { lang: currentLang }));

      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return;
      }

      // Prompt is bilingual so it reads correctly regardless of current locale
      const selectedLang = await select<Locale>({
        message: t('prompt.selectLanguage'),
        choices: [
          { value: 'en', name: t('language.optionEn') },
          { value: 'zh', name: t('language.optionZh') },
        ],
      });

      setLocale(selectedLang);

      // Persist to local.json
      const state = loadLocalState(hubPath);
      state.language = selectedLang;
      saveLocalState(state, hubPath);

      logger.success(t('language.saved'));
    });
}