import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import {
  Registry,
  createEmptyRegistry,
  AgentConfig,
} from './registry.js';
import { ensureDir, readJson, writeJson, exists } from '../utils/fs.js';

const SKILL_SYNC_DIR = '.skillstash';
const HUB_DIR_NAME = 'skills-hub';
const REGISTRY_FILE = 'registry.json';

export function getDefaultHubPath(): string {
  return path.join(os.homedir(), SKILL_SYNC_DIR, HUB_DIR_NAME);
}

export function getRegistryPath(hubPath?: string): string {
  return path.join(hubPath || getDefaultHubPath(), REGISTRY_FILE);
}

export function getSkillsPath(hubPath?: string): string {
  return path.join(hubPath || getDefaultHubPath(), 'skills');
}

export function hubExists(hubPath?: string): boolean {
  const hp = hubPath || getDefaultHubPath();
  return exists(path.join(hp, REGISTRY_FILE));
}

export function loadRegistry(hubPath?: string): Registry {
  const rp = getRegistryPath(hubPath);
  if (!exists(rp)) {
    return createEmptyRegistry();
  }
  const reg = readJson<Registry>(rp);
  // Backward compat: ensure all agents have enabled field
  for (const name of Object.keys(reg.agents)) {
    if (reg.agents[name].enabled === undefined) {
      reg.agents[name].enabled = true;
    }
  }
  return reg;
}

export function saveRegistry(registry: Registry, hubPath?: string): void {
  const rp = getRegistryPath(hubPath);
  writeJson(rp, registry);
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

  // Detect available agents and add to registry
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
