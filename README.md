<p align="center">
  <img src="docs/images/banner.svg" alt="skillstash Banner" width="800"/>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/skillstash">
    <img src="https://img.shields.io/npm/dm/skillstash?logo=npm" alt="npm downloads"/>
  </a>
  <a href="https://github.com/1mGee/skillstash/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License"/>
  </a>
</p>

<p align="center">
  One hub, all agents. Manage your AI agent skills in a single git-backed directory, and sync them to WorkBuddy, Codex, Claude Code, and more.
</p>

---

## Overview

skillstash is a CLI tool that centralizes your AI agent skills into a single git-backed hub. Install skills from ClawHub, GitHub, or local paths — then let skillstash copy them to every agent directory you use. Pull on one machine, sync everywhere.

```
~/.skillstash/skills-hub/ (git) ← Single source of truth
 ┌──────────────────────────┐
 │     registry.json        │  ← Tracks versions, hashes, agents
 └──────────────────────────┘
 ┌──────────────────────────┐
 │     skills/              │
 │       finance-ops/       │
 │       anti-distill/      │
 │       my-custom-skill/   │
 └──────────────────────────┘
          │  skillstash link (copy)
    ┌─────┼──────┬──────────┐
    ▼     ▼      ▼          ▼
   WB    Codex  Claude    Agents
 skills/ skills/ skills/  skills/
```

**Design decisions:**
- **Copy by default** — maximum compatibility, no symlink permission issues on Windows
- **Git-backed** — version control, multi-device sync, and conflict resolution built in
- **Agent-agnostic** — auto-detects installed agents, works with any combination
- **Remote-first init** — `init` requires a remote Git URL, ensuring multi-device sync from day one

## Quick Start

```bash
# Install globally
npm install -g skillstash

# Or use directly with npx
npx skillstash --help

# 1. Initialize the hub with a remote repository
skillstash init git@github.com:yourname/my-skills.git

# 2. Install skills (from ClawHub, GitHub, or local path)
skillstash install clawhub:finance-ops
skillstash install owner/repo@skill-name   # GitHub
skillstash install ./my-local-skill         # Local path

# 3. Import existing skills from agent directories
skillstash import --force   # --force to overwrite existing

# 4. Link (copy) to all agent directories
skillstash link

# 5. Full sync — pull + verify + link + push
skillstash sync
```

## Multi-Device Sync

Since `init` requires a remote URL, multi-device sync is built in from the start:

```bash
# On device A (first time)
skillstash init git@github.com:yourname/my-skills.git
# → Creates hub, imports local skills, pushes to remote

# On device B (first time)
skillstash init git@github.com:yourname/my-skills.git
# → Clones hub, imports any local-only skills, pushes merged result

# Daily workflow on any device
skillstash sync    # pull + verify + link + push
```

## Command Reference

### `skillstash init <remote-url>`

Initialize the skills-hub with a remote Git repository. The hub is always at `~/.skillstash/skills-hub`.

| Remote Status | Behavior |
|---|---|
| **Empty repo** | Create hub locally → auto-import existing agent skills → git push |
| **Non-empty with `registry.json`** | Clone hub → re-detect local agents → import new local skills → git push |
| **Non-empty without `registry.json`** | ❌ Reject — not a skillstash repo. Prompt to create a new empty repo |

```bash
skillstash init git@github.com:yourname/my-skills.git
skillstash init https://github.com/yourname/my-skills.git
```

### `skillstash install <source>`

Install a skill from ClawHub, a local path, or a GitHub repository.

```bash
skillstash install clawhub:finance-ops         # From ClawHub (requires clawhub CLI)
skillstash install ./my-local-skill            # From local path
skillstash install owner/repo@skill-name       # From GitHub
skillstash install clawhub:finance-ops --no-lint # Skip SKILL.md validation
```

**ClawHub integration** requires the `clawhub` CLI installed and logged in:
```bash
npm install -g clawhub
clawhub login
```

**GitHub installation** supports three repository layouts:
- Standalone skill repo: `SKILL.md` at repository root
- Skill-hub repo: `skills/<name>/SKILL.md`
- Subdirectory skill: `<name>/SKILL.md`

Multi-skill repositories without `@skill-name` will prompt for selection.

### `skillstash import`

Scan agent directories (resolving symlinks/Junctions), and import skills into the hub.

```bash
skillstash import                  # Import from all agents
skillstash import --agent claude   # Only from specific agent
skillstash import --force          # Re-import existing skills (overwrite)
skillstash import --dry-run        # Preview without making changes
skillstash import --no-lint        # Skip SKILL.md validation
```

### `skillstash link`

Copy skills from hub to all agent directories.

```bash
skillstash link                    # Link all skills to all agents
skillstash link --agent workbuddy  # Only to specific agent
skillstash link --skill finance-ops # Only specific skill
skillstash link --clean            # Remove unmanaged skills from agent dirs
```

### `skillstash list`

List installed skills and their status across agents.

```bash
skillstash list                    # Summary view
skillstash list -v                 # Verbose with descriptions
```

### `skillstash sync`

Full sync: git pull → verify integrity → link to agents → git push.

```bash
skillstash sync                    # Full sync
skillstash sync --no-pull          # Skip git pull
skillstash sync --no-push          # Skip git push
skillstash sync --no-link          # Skip linking
skillstash sync --clean            # Remove unmanaged skills
```

### `skillstash diff`

Show differences between hub and agent directories.

```bash
skillstash diff                    # Compare all agents
skillstash diff --agent workbuddy  # Only specific agent
```

### `skillstash remove <skill-name>`

Remove a skill from hub and all agent directories.

```bash
skillstash remove old-skill              # Remove everywhere
skillstash remove old-skill --keep-agents  # Only remove from hub
```

## Supported Agents

| Agent | Skills Directory | Auto-detected |
|---|---|:---:|
| WorkBuddy | `~/.workbuddy/skills/` | ✅ |
| CodeBuddy | `~/.codebuddy/skills/` | ✅ |
| Codex | `~/.codex/skills/` | ✅ |
| Claude Code | `~/.claude/skills/` | ✅ |
| Agents (generic) | `~/.agents/skills/` | ✅ |

## Registry Schema

The `registry.json` in the hub tracks everything:

```json
{
  "version": "1.0",
  "lastSync": "2026-04-24T12:00:00Z",
  "skills": {
    "finance-ops": {
      "version": "1.0.0",
      "source": "github",
      "sourceUrl": "https://github.com/owner/repo",
      "hash": "sha256:abc123...",
      "agents": ["workbuddy", "codex", "claude", "agents"],
      "enabled": true,
      "description": "AI CFO assistant"
    }
  },
  "agents": {
    "workbuddy": {
      "name": "workbuddy",
      "skillsPath": "~/.workbuddy/skills",
      "linkType": "copy",
      "available": true
    }
  }
}
```

## Project Structure

```
skillstash/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── commands/
│   │   ├── init.ts           # skillstash init <remote-url>
│   │   ├── install.ts        # skillstash install
│   │   ├── link.ts           # skillstash link
│   │   ├── list.ts           # skillstash list
│   │   ├── sync.ts           # skillstash sync
│   │   ├── diff.ts           # skillstash diff
│   │   ├── remove.ts         # skillstash remove
│   │   └── import.ts         # skillstash import
│   ├── core/
│   │   ├── registry.ts       # Registry types & operations
│   │   ├── hub.ts            # Hub directory management
│   │   ├── git.ts            # Git operations (probe, clone, push, etc.)
│   │   └── skill.ts          # SKILL.md parsing & linting
│   └── utils/
│       ├── fs.ts             # File system utilities
│       └── logger.ts         # Colored logging
├── docs/
│   └── images/               # Assets
├── package.json
├── tsconfig.json
└── README.md
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run locally
node dist/index.js --help

# Watch mode
npm run dev
```

## License

MIT
