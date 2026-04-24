import * as os from 'node:os';

export interface AgentDefinition {
  name: string;
  skillsPath: string;
  linkType: 'copy' | 'symlink' | 'junction';
}

const builtinAgents: AgentDefinition[] = [
  { name: 'workbuddy', skillsPath: '{home}/.workbuddy/skills', linkType: 'copy' },
  { name: 'codebuddy', skillsPath: '{home}/.codebuddy/skills', linkType: 'copy' },
  { name: 'codex',     skillsPath: '{home}/.codex/skills',     linkType: 'copy' },
  { name: 'claude',    skillsPath: '{home}/.claude/skills',    linkType: 'copy' },
  { name: 'agents',    skillsPath: '{home}/.agents/skills',    linkType: 'copy' },
];

const customAgents: AgentDefinition[] = [];

export function resolveSkillsPath(template: string): string {
  return template.replace('{home}', os.homedir());
}

export function registerAgent(def: AgentDefinition): void {
  const isBuiltin = builtinAgents.some((a) => a.name === def.name);
  if (isBuiltin) return;
  const existing = customAgents.findIndex((a) => a.name === def.name);
  if (existing >= 0) {
    customAgents[existing] = def;
  } else {
    customAgents.push(def);
  }
}

export function unregisterAgent(name: string): boolean {
  const isBuiltin = builtinAgents.some((a) => a.name === name);
  if (isBuiltin) return false;
  const idx = customAgents.findIndex((a) => a.name === name);
  if (idx < 0) return false;
  customAgents.splice(idx, 1);
  return true;
}

export function isBuiltinAgent(name: string): boolean {
  return builtinAgents.some((a) => a.name === name);
}

export function getAgentDefinitions(): AgentDefinition[] {
  return [...builtinAgents, ...customAgents];
}

export function resetCustomAgents(): void {
  customAgents.length = 0;
}
