<p align="center">
  <img src="docs/images/banner.svg" alt="skill-sync Banner" width="800"/>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/skill-sync">
    <img src="https://img.shields.io/npm/dm/skill-sync?logo=npm" alt="npm downloads"/>
  </a>
  <a href="https://github.com/1mGee/skill-sync/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License"/>
  </a>
</p>

<p align="center">
  One hub, all agents. Manage your AI agent skills in a single git-backed directory, and sync them to WorkBuddy, Codex, Claude Code, and more.
</p>

---

## What's New in v0.5.0

- **GitHub Installation** — Install skills directly from any GitHub repository. Supports three repo layouts: standalone skill repo, skill-hub (with `skills/` subdirectory), and subdirectory skill. Multi-skill repos prompt for selection automatically.
- **`import --force`** — Re-import skills already in the hub, overwriting with the latest version from agent directories.
- **Windows Path Fix** — Local paths with forward slashes (`C:/...`) are now correctly recognized on Windows.
- **GitHub Source Tracing** — Installed GitHub skills record their `sourceUrl` in the registry for full provenance tracking.
- **ClawHub Integration** — Install from the public ClawHub registry via `clawhub:` prefix (requires `clawhub` CLI).

## Architecture

```
~/.skill-sync/skills-hub/ (git) ← Single source of truth
 ┌──────────────────────────┐
 │     registry.json        │  ← Tracks versions, hashes, agents
 └──────────────────────────┘
 ┌──────────────────────────┐
 │     skills/              │
 │       finance-ops/       │
 │       anti-distill/      │
 │       my-custom-skill/   │
 └──────────────────────────┘
          │  skill-sync link (copy)
    ┌─────┼──────┬──────────┐
    ▼     ▼      ▼          ▼
   WB    Codex  Claude    Agents
 skills/ skills/ skills/  skills/
```

**Key design decisions:**
- **Copy by default** — maximum compatibility, no symlink permission issues on Windows
- **Git-backed** — version control, multi-device sync, and conflict resolution built in
- **Agent-agnostic** — auto-detects installed agents, works with any combination
- **Remote-first init** — `init` requires a remote Git URL, ensuring multi-device sync from day one

## Quick Start

```bash
# Install globally
npm install -g skill-sync

# Or use directly with npx
npx skill-sync --help

# 1. Initialize the hub with a remote repository
skill-sync init git@github.com:yourname/my-skills.git

# 2. Install skills (from ClawHub, local path, or GitHub)
skill-sync install clawhub:finance-ops
skill-sync install owner/repo@skill-name   # GitHub
skill-sync install ./my-local-skill         # Local path

# 3. Import existing skills from agent directories
skill-sync import --force   # --force to overwrite existing

# 4. Link (copy) to all agent directories
skill-sync link

# 5. Full sync — pull + verify + link + push
skill-sync sync
```

## Command Reference

### `skill-sync init <remote-url>`

Initialize the skills-hub with a remote Git repository. The hub is always at `~/.skill-sync/skills-hub`.

| Remote Status | Behavior |
|---|---|
| **Empty repo** | Create hub locally → auto-import existing agent skills → git push |
| **Non-empty with `registry.json`** | Clone hub → re-detect local agents → import new local skills → git push |
| **Non-empty without `registry.json`** | ❌ Reject — not a skill-sync repo. Prompt to create a new empty repo |

```bash
skill-sync init git@github.com:yourname/my-skills.git
skill-sync init https://github.com/yourname/my-skills.git
```

### `skill-sync install <source>`

Install a skill from ClawHub, a local path, or a GitHub repository.

```bash
skill-sync install clawhub:finance-ops         # From ClawHub (requires clawhub CLI)
skill-sync install ./my-local-skill            # From local path
skill-sync install owner/repo@skill-name       # From GitHub
skill-sync install clawhub:finance-ops --no-lint # Skip SKILL.md validation
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

### `skill-sync import`

Scan agent directories (resolving symlinks/Junctions), and import skills into the hub.

```bash
skill-sync import                  # Import from all agents
skill-sync import --agent claude   # Only from specific agent
skill-sync import --force         # Re-import existing skills (overwrite)
skill-sync import --dry-run       # Preview without making changes
skill-sync import --no-lint       # Skip SKILL.md validation
```

### `skill-sync link`

Copy skills from hub to all agent directories.

```bash
skill-sync link                    # Link all skills to all agents
skill-sync link --agent workbuddy  # Only to specific agent
skill-sync link --skill finance-ops # Only specific skill
skill-sync link --clean            # Remove unmanaged skills from agent dirs
```

### `skill-sync list`

List installed skills and their status across agents.

```bash
skill-sync list                    # Summary view
skill-sync list -v                 # Verbose with descriptions
```

### `skill-sync sync`

Full sync: git pull → verify integrity → link to agents → git push.

```bash
skill-sync sync                    # Full sync
skill-sync sync --no-pull          # Skip git pull
skill-sync sync --no-push          # Skip git push
skill-sync sync --no-link          # Skip linking
skill-sync sync --clean            # Remove unmanaged skills
```

### `skill-sync diff`

Show differences between hub and agent directories.

```bash
skill-sync diff                    # Compare all agents
skill-sync diff --agent workbuddy  # Only specific agent
```

### `skill-sync remove <skill-name>`

Remove a skill from hub and all agent directories.

```bash
skill-sync remove old-skill        # Remove everywhere
skill-sync remove old-skill --keep-agents  # Only remove from hub
```

## Multi-Device Sync

Since `init` requires a remote URL, multi-device sync is built in from the start:

```bash
# On device A (first time)
skill-sync init git@github.com:yourname/my-skills.git
# → Creates hub, imports local skills, pushes to remote

# On device B (first time)
skill-sync init git@github.com:yourname/my-skills.git
# → Clones hub, imports any local-only skills, pushes merged result

# Daily workflow on any device
skill-sync sync    # pull + verify + link + push
```

### What happens on `init`

```
┌──────────────────────────────────────────────────┐
│            skill-sync init <remote-url>           │
└──────────────────────┬───────────────────────────┘
                       │
                Probe remote repo
                       │
          ┌────────────┼────────────────┐
          ▼            ▼                ▼
     Empty repo   Has registry.json   No registry.json
          │            │                │
          ▼            ▼                ▼
   Create hub     Clone hub          ❌ Reject:
   Import local   Detect agents     "Not a skill-sync repo"
   skills         Import new        Suggest creating
   Push to remote local skills      a new empty repo
                  Push merged
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
skill-sync/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── commands/
│   │   ├── init.ts           # skill-sync init <remote-url>
│   │   ├── install.ts        # skill-sync install
│   │   ├── link.ts           # skill-sync link
│   │   ├── list.ts           # skill-sync list
│   │   ├── sync.ts           # skill-sync sync
│   │   ├── diff.ts           # skill-sync diff
│   │   ├── remove.ts         # skill-sync remove
│   │   └── import.ts         # skill-sync import
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
