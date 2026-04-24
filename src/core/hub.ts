import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import {
  Registry,
  LocalState,
  createEmptyRegistry,
  createEmptyLocalState,
  AgentConfig,
} from './registry.js';
import { ensureDir, readJson, writeJson, exists } from '../utils/fs.js';

const SKILL_SYNC_DIR = '.skillstash';
const HUB_DIR_NAME = 'skills-hub';
const REGISTRY_FILE = 'registry.json';
const LOCAL_FILE = 'local.json';

export function getDefaultHubPath(): string {
  return path.join(os.homedir(), SKILL_SYNC_DIR, HUB_DIR_NAME);
}

export function getRegistryPath(hubPath?: string): string {
  return path.join(hubPath || getDefaultHubPath(), REGISTRY_FILE);
}

export function getLocalPath(hubPath?: string): string {
  return path.join(hubPath || getDefaultHubPath(), LOCAL_FILE);
}

export function getSkillsPath(hubPath?: string): string {
  return path.join(hubPath || getDefaultHubPath(), 'skills');
}

export function hubExists(hubPath?: string): boolean {
  const hp = hubPath || getDefaultHubPath();
  return exists(path.join(hp, REGISTRY_FILE));
}

function ensureGitignore(hubPath: string): void {
  ensureDir(hubPath);
  const gitignorePath = path.join(hubPath, '.gitignore');
  const entry = 'local.json';
  if (!exists(gitignorePath)) {
    fs.writeFileSync(gitignorePath, entry + '\n', 'utf-8');
  } else {
    const lines = fs.readFileSync(gitignorePath, 'utf-8').split('\n').map((l) => l.trim());
    if (!lines.includes(entry)) {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      fs.appendFileSync(gitignorePath, (content.endsWith('\n') ? '' : '\n') + entry + '\n', 'utf-8');
    }
  }
}

export function loadLocalState(hubPath?: string): LocalState {
  const lp = getLocalPath(hubPath);
  if (!exists(lp)) return createEmptyLocalState();
  const state = readJson<LocalState>(lp);
  for (const name of Object.keys(state.agents || {})) {
    if ((state.agents[name] as any).enabled === undefined) {
      state.agents[name].enabled = true;
    }
  }
  return {
    lastSync: state.lastSync ?? null,
    agents: state.agents || {},
    skillAgents: state.skillAgents || {},
    agentSkills: state.agentSkills || {},
    language: state.language ?? 'en',
  };
}

export function saveLocalState(state: LocalState, hubPath?: string): void {
  writeJson(getLocalPath(hubPath), state);
}

export function loadRegistry(hubPath?: string): Registry {
  const hp = hubPath || getDefaultHubPath();
  const rp = getRegistryPath(hp);
  if (!exists(rp)) {
    return createEmptyRegistry();
  }

  const raw = readJson<any>(rp);
  const localPath = getLocalPath(hp);

  // One-time migration: old registry.json stored agents/lastSync/SkillMeta.agents inline.
  // If local.json doesn't exist yet, bootstrap it from the old-format data.
  if (!exists(localPath)) {
    ensureGitignore(hp);
    const skillAgents: Record<string, string[]> = {};
    for (const [name, meta] of Object.entries(raw.skills || {}) as [string, any][]) {
      if (Array.isArray(meta.agents) && meta.agents.length > 0) {
        skillAgents[name] = meta.agents;
      }
    }
    const migratedLocal: LocalState = {
      lastSync: raw.lastSync ?? null,
      agents: raw.agents || {},
      skillAgents,
    };
    for (const name of Object.keys(migratedLocal.agents)) {
      if ((migratedLocal.agents[name] as any).enabled === undefined) {
        migratedLocal.agents[name].enabled = true;
      }
    }
    saveLocalState(migratedLocal, hp);
  }

  const local = loadLocalState(hp);

  const skills: Record<string, any> = {};
  for (const [name, meta] of Object.entries(raw.skills || {}) as [string, any][]) {
    skills[name] = { ...meta, agents: local.skillAgents[name] ?? [] };
  }

  return {
    version: raw.version || '1.0',
    skills,
    lastSync: local.lastSync,
    agents: local.agents,
    agentSkills: local.agentSkills || {},
  };
}

export function saveRegistry(registry: Registry, hubPath?: string): void {
  const hp = hubPath || getDefaultHubPath();
  ensureGitignore(hp);

  const sharedSkills: Record<string, any> = {};
  const skillAgents: Record<string, string[]> = {};

  for (const [name, meta] of Object.entries(registry.skills)) {
    const { agents: agentList, ...rest } = meta;
    sharedSkills[name] = rest;
    if (agentList && agentList.length > 0) {
      skillAgents[name] = agentList;
    }
  }

  writeJson(getRegistryPath(hp), { version: registry.version, skills: sharedSkills });

  // Preserve language preference across registry saves
  const existingLocal = exists(getLocalPath(hp)) ? readJson<LocalState>(getLocalPath(hp)) : null;

  saveLocalState({
    lastSync: registry.lastSync,
    agents: registry.agents,
    skillAgents,
    agentSkills: registry.agentSkills || {},
    language: existingLocal?.language ?? 'en',
  }, hp);
}

export function initHub(hubPath?: string): { hubPath: string; created: boolean } {
  const hp = hubPath || getDefaultHubPath();
  const registryPath = getRegistryPath(hp);
  const skillsPath = getSkillsPath(hp);

  if (exists(registryPath)) {
    return { hubPath: hp, created: false };
  }

  ensureDir(hp);
  ensureDir(skillsPath);
  ensureGitignore(hp);

  const registry = createEmptyRegistry();
  const agents = detectAgents();
  for (const agent of agents) {
    registry.agents[agent.name] = agent;
  }

  saveRegistry(registry, hp);
  return { hubPath: hp, created: true };
}

/**
 * Detect installed AI agents on the system
 */
export function detectAgents(): AgentConfig[] {
  const home = os.homedir();
  const agentPaths: Array<{ name: string; skillsPath: string; linkType: 'copy' | 'symlink' | 'junction' }> = [
    { name: 'workbuddy', skillsPath: path.join(home, '.workbuddy', 'skills'), linkType: 'copy' },
    { name: 'codebuddy', skillsPath: path.join(home, '.codebuddy', 'skills'), linkType: 'copy' },
    { name: 'codex', skillsPath: path.join(home, '.codex', 'skills'), linkType: 'copy' },
    { name: 'claude', skillsPath: path.join(home, '.claude', 'skills'), linkType: 'copy' },
    { name: 'agents', skillsPath: path.join(home, '.agents', 'skills'), linkType: 'copy' },
  ];

  return agentPaths.map((ap) => ({
    name: ap.name,
    skillsPath: ap.skillsPath,
    linkType: ap.linkType,
    available: fs.existsSync(path.dirname(ap.skillsPath)),
    enabled: true,
  }));
}

/**
 * List skill directories in the hub
 */
export function listHubSkills(hubPath?: string): string[] {
  const sp = getSkillsPath(hubPath);
  if (!exists(sp)) return [];
  return fs
    .readdirSync(sp, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}
