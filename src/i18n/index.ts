export interface Messages {
  common: {
    hubNotInitialized: string;
    hubNotInitializedWithUrl: string;
    agentNotInRegistry: string;
    availableAgents: string;
    pushing: string;
    pushed: string;
    pushFailed: string;
    skillLinkError: string;
    agentAvailable: string;
    agentNotFound: string;
    agentManaged: string;
    agentDisabled: string;
    linkingSkillsToAgents: string;
    linkedSkillsAgents: string;
    noAvailableAgents: string;
    noSkillsToLink: string;
    skillSourceMissing: string;
    removingUnmanaged: string;
  };
  init: {
    alreadyExists: string;
    alreadyExistsStats: string;
    alreadyExistsHint: string;
    probingRemote: string;
    cannotAccessRemote: string;
    checkUrlCredentials: string;
    remoteEmpty: string;
    remoteHasHub: string;
    remoteNotEmpty: string;
    noRegistryFound: string;
    pleaseEither: string;
    pleaseDo1: string;
    pleaseDo2: string;
    failedCreateHub: string;
    hubDirCreated: string;
    registryInitialized: string;
    gitInitFailed: string;
    gitInitialized: string;
    scanningAgentDirs: string;
    scanningAgentNew: string;
    agentFoundSkills: string;
    agentFoundNewSkills: string;
    importedSkillsFromAgents: string;
    importedNewSkillsFromAgents: string;
    noExistingSkills: string;
    noNewFromAgents: string;
    importingSkill: string;
    skippingLintFailed: string;
    cloning: string;
    cloned: string;
    cloneFailed: string;
    noRegistryInClone: string;
    checkRepoContents: string;
    pushingImported: string;
    hubContains: string;
    detectedAgentsHeader: string;
    done: string;
    skillsCount: string;
    nextSteps: string;
    nextInstall: string;
    nextLink: string;
    nextSync: string;
  };
  sync: {
    unresolvedConflicts: string;
    autoCommitting: string;
    fetchingRemote: string;
    fetchFailed: string;
    fastForwardComplete: string;
    fastForwardFailed: string;
    divergedHistories: string;
    autoResolved: string;
    mergeCommitFailed: string;
    mergeComplete: string;
    mergeCompleteWithResolutions: string;
    noRemote: string;
    verifyingIntegrity: string;
    skillDirMissing: string;
    skillHashChanged: string;
    skillFoundOnDisk: string;
    integrityOk: string;
    noAgentsToLink: string;
    noSkillsToLink: string;
    linkingSkills: string;
    removingUnmanaged: string;
    syncComplete: string;
  };
  assign: {
    agentNotFoundOrEnabled: string;
    noAgentsToConfigure: string;
    noEnabledSkills: string;
    configuringHeader: string;
    assignmentSaved: string;
    agentSkillCount: string;
    runLinkHint: string;
    linkingSkills: string;
    linkedSkills: string;
  };
  agents: {
    noAgentsRegistered: string;
    header: string;
    managingCount: string;
    agentNowManaged: string;
    agentNowDisabled: string;
  };
  diff: {
    noAgentsToDiff: string;
    missingInHub: string;
    notLinked: string;
    outOfSync: string;
    inSync: string;
    unmanaged: string;
    allInSync: string;
    runSync: string;
  };
  import: {
    noAgentsToScan: string;
    scanningAgent: string;
    foundSkills: string;
    noSkillsFound: string;
    allAlreadyInHub: string;
    discoveredSkills: string;
    dryRun: string;
    skippingAlreadyExists: string;
    skippingLintFailed: string;
    updatingSkill: string;
    importingSkill: string;
    importSummary: string;
    runLinkHint: string;
    noNewSkills: string;
  };
  install: {
    slugEmpty: string;
    noSkillMdAtPath: string;
    skillSourceNotFound: string;
    exampleInstalls: string;
    exampleClawhub: string;
    exampleLocal: string;
    exampleGithub: string;
    clawhubCliNotFound: string;
    clawhubInstallCmd: string;
    clawhubLoginCmd: string;
    downloadingFromClawhub: string;
    clawhubNoSkillMd: string;
    clawhubInstallFailed: string;
    skillNotFoundInRepo: string;
    multipleSkillsFound: string;
    usageInstallRepo: string;
    noSkillMdInRepo: string;
    subdirHint: string;
    resolvingSource: string;
    gitNotFound: string;
    cloningFromGithub: string;
    lintFailed: string;
    updatingSkill: string;
    installingSkill: string;
    installed: string;
  };
  link: {
    noAgentsToLink: string;
    noSkillsToLink: string;
    linked: string;
    removingUnmanaged: string;
  };
  list: {
    noSkills: string;
    installedHeader: string;
    agentsHeader: string;
    noneAgents: string;
    colName: string;
    colVersion: string;
    colSource: string;
    colAgents: string;
    colStatus: string;
  };
  remove: {
    skillNotFound: string;
    removedFromHub: string;
    removedFromAgent: string;
    skillRemoved: string;
  };
  language: {
    optionEn: string;
    optionZh: string;
    saved: string;
    currentLanguage: string;
  };
  prompt: {
    selectAgents: string;
    runLinkNow: string;
    selectSkillsForAgent: string;
    selectLanguage: string;
  };
  merge: {
    localNewer: string;
    sameTimestampKeepLocal: string;
    remoteNewer: string;
    remoteDeletedLocalHasChanges: string;
    deletedByRemote: string;
    localDeletedRemoteHasChanges: string;
    deletedByLocal: string;
  };
}

export type Locale = 'en' | 'zh';

const localeData: Record<Locale, Messages> = {} as any;

let _locale: Locale = 'en';

export function registerLocale(lang: Locale, messages: Messages): void {
  localeData[lang] = messages;
}

export function setLocale(lang: Locale): void {
  if (localeData[lang]) {
    _locale = lang;
  }
}

export function getLocale(): Locale {
  return _locale;
}

export function t(key: string, params?: Record<string, string | number>): string {
  const messages: Record<string, any> = localeData[_locale] || localeData['en'] || {};
  const parts = key.split('.');
  let node: any = messages;

  for (const part of parts) {
    if (node == null || typeof node !== 'object') return key;
    node = node[part];
  }

  if (typeof node !== 'string') return key;

  if (!params) return node;

  return node.replace(/\{(\w+)\}/g, (_, k: string) =>
    Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : `{${k}}`,
  );
}