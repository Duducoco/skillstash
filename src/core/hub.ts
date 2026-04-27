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
import { AgentDefinition, registerAgent, getAgentDefinitions, resolveSkillsPath, isBuiltinAgent } from './agents.js';
import { withLock } from '../utils/lock.js';

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
  const entries = ['local.json', '.lock'];
  const content = exists(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
  const lines = content.split('\n').filter(l => l.trim().length > 0);
  const lineSet = new Set(lines);
  let modified = false;
  for (const entry of entries) {
    if (!lineSet.has(entry)) {
      lines.push(entry);
      modified = true;
    }
  }
  if (modified || !exists(gitignorePath)) {
    fs.writeFileSync(gitignorePath, lines.join('\n') + '\n', 'utf-8');
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
  // Register any persisted custom agents
  for (const def of state.customAgents || []) {
    registerAgent(def);
  }
  return {
    lastSync: state.lastSync ?? null,
    agents: state.agents || {},
    skillAgents: state.skillAgents || {},
    agentSkills: state.agentSkills || {},
    language: state.language ?? 'en',
    customAgents: state.customAgents || [],
  };
}

export function saveLocalState(state: LocalState, hubPath?: string): void {
  const hp = hubPath || getDefaultHubPath();
  withLock(hp, () => writeJson(getLocalPath(hp), state));
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
  // Double-check pattern: check outside lock for speed, re-check inside lock for safety.
  if (!exists(localPath)) {
    withLock(hp, () => {
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
        // Write directly (we already hold the lock, can't call saveLocalState which also locks)
        writeJson(getLocalPath(hp), migratedLocal);
      }
    });
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

  const existingLocal = exists(getLocalPath(hp)) ? readJson<LocalState>(getLocalPath(hp)) : null;
  const existingCustomNames = new Set((existingLocal?.customAgents ?? []).map((a) => a.name));
  const mergedCustomAgents = [
    ...(existingLocal?.customAgents ?? []),
    ...Object.values(registry.agents)
      .filter((a) => !isBuiltinAgent(a.name) && !existingCustomNames.has(a.name))
      .map(({ name, skillsPath, linkType }) => ({ name, skillsPath, linkType })),
  ];
  const newLocal: LocalState = {
    lastSync: registry.lastSync,
    agents: registry.agents,
    skillAgents,
    agentSkills: registry.agentSkills || {},
    language: existingLocal?.language ?? 'en',
    customAgents: mergedCustomAgents,
  };

  withLock(hp, () => {
    writeJson(getRegistryPath(hp), { version: registry.version, skills: sharedSkills });
    writeJson(getLocalPath(hp), newLocal);
  });
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
 * Detect installed AI agents on the system using registered definitions
 */
export function detectAgents(): AgentConfig[] {
  return getAgentDefinitions().map((def) => {
    const skillsPath = resolveSkillsPath(def.skillsPath);
    return {
      name: def.name,
      skillsPath,
      linkType: def.linkType,
      available: fs.existsSync(path.dirname(skillsPath)),
      enabled: true,
    };
  });
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
