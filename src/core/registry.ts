/**
 * Registry types and operations for skillstash
 */

export interface SkillMeta {
  version: string;
  source: 'local' | 'github' | 'clawhub';
  sourceUrl?: string;
  installedAt: string;
  updatedAt: string;
  hash: string;
  agents: string[];
  enabled: boolean;
  description?: string;
}

export interface AgentConfig {
  name: string;
  skillsPath: string;
  linkType: 'copy' | 'symlink' | 'junction';
  available: boolean;
  enabled: boolean;
}

export interface Registry {
  version: string;
  lastSync: string | null;
  skills: Record<string, SkillMeta>;
  agents: Record<string, AgentConfig>;
  agentSkills: Record<string, string[]>;
}

export function createEmptyRegistry(): Registry {
  return {
    version: '1.0',
    lastSync: null,
    skills: {},
    agents: {},
    agentSkills: {},
  };
}

export function addSkillToRegistry(
  registry: Registry,
  name: string,
  meta: Partial<SkillMeta> & Pick<SkillMeta, 'version' | 'source' | 'hash'>
): Registry {
  const now = new Date().toISOString();
  registry.skills[name] = {
    version: meta.version,
    source: meta.source,
    sourceUrl: meta.sourceUrl,
    installedAt: meta.installedAt || now,
    updatedAt: now,
    hash: meta.hash,
    agents: meta.agents || [],
    enabled: meta.enabled ?? true,
    description: meta.description,
  };
  return registry;
}

export function removeSkillFromRegistry(registry: Registry, name: string): Registry {
  delete registry.skills[name];
  return registry;
}

export function addAgentToRegistry(
  registry: Registry,
  name: string,
  config: AgentConfig
): Registry {
  registry.agents[name] = config;
  return registry;
}

export function updateSkillInRegistry(
  registry: Registry,
  name: string,
  updates: Partial<SkillMeta>
): Registry {
  if (!registry.skills[name]) return registry;
  Object.assign(registry.skills[name], updates, { updatedAt: new Date().toISOString() });
  return registry;
}

export function setAgentEnabled(
  registry: Registry,
  name: string,
  enabled: boolean
): Registry {
  if (!registry.agents[name]) return registry;
  registry.agents[name].enabled = enabled;
  return registry;
}

export interface LocalState {
  lastSync: string | null;
  agents: Record<string, AgentConfig>;
  skillAgents: Record<string, string[]>;
  agentSkills?: Record<string, string[]>;
}

export function createEmptyLocalState(): LocalState {
  return { lastSync: null, agents: {}, skillAgents: {}, agentSkills: {} };
}
