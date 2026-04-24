<p align="center">
  <img src="docs/images/banner.svg" alt="skillstash Banner" width="800"/>
</p>

<p align="center">
  <a href="https://github.com/Duducoco/skillstash/actions/workflows/ci.yml">
    <img src="https://github.com/Duducoco/skillstash/actions/workflows/ci.yml/badge.svg" alt="CI Status"/>
  </a>
  <a href="https://github.com/Duducoco/skillstash/releases">
    <img src="https://img.shields.io/github/v/release/Duducoco/skillstash?include_prereleases" alt="Release"/>
  </a>
  <a href="https://www.npmjs.com/package/skillstash">
    <img src="https://img.shields.io/npm/dm/skillstash?logo=npm" alt="npm downloads"/>
  </a>
  <a href="https://github.com/Duducoco/skillstash/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License"/>
  </a>
</p>

<p align="center">
  One hub, all agents. Manage your AI agent skills in a single git-backed directory, and sync them to Cursor, Gemini, Codex, Claude Code, and more.
</p>

<p align="center">
  <a href="./README.md">English</a> | <a href="./README_zh.md">中文</a>
</p>

---

## 📦 Overview

skillstash is a CLI tool that centralizes your AI agent skills into a single git-backed hub. Install skills from ClawHub, GitHub, or local paths — then let skillstash copy them to every agent directory you use. Pull on one machine, sync everywhere.

```
~/.skillstash/skills-hub/ (git) ← Single source of truth
 ┌──────────────────────────┐
 │     registry.json  (git) │  ← Skill metadata (shared across devices)
 ├──────────────────────────┤
 │     local.json (ignored) │  ← Agent config & assignments (per-device)
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
 Gemini  Codex  Claude    Cursor
 skills/ skills/ skills/ skills/
```

**Design decisions:**
- **Copy by default** — maximum compatibility, no symlink permission issues on Windows
- **Git-backed** — version control, multi-device sync, and conflict resolution built in
- **Agent-agnostic** — auto-detects installed agents; supports custom agents via `agents add`
- **Local-first, remote-optional** — `init` works offline; add a remote later with `add-remote`

## 🚀 Quick Start

```bash
# Install globally
npm install -g skillstash

# Or use directly with npx
npx skillstash --help

# 1a. Initialize a local-only hub (no Git remote required)
skillstash init
# → Interactive: select language, choose which agents to manage

# 1b. Or initialize with a remote repository for multi-device sync
skillstash init git@github.com:yourname/my-skills.git

# 1c. Already have a local hub? Link it to a remote later
skillstash add-remote git@github.com:yourname/my-skills.git

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

## 🔄 Multi-Device Sync

skillstash supports multi-device sync via a shared Git remote. A remote is **optional** — you can start local and add one later.

```bash
# On device A (start local, no remote)
skillstash init
# → Creates local hub, imports skills

# Add remote later
skillstash add-remote git@github.com:yourname/my-skills.git

# On device B (clone existing hub)
skillstash init git@github.com:yourname/my-skills.git
# → Clones hub, imports any local-only skills, pushes merged result

# Daily workflow on any device
skillstash sync    # pull + verify + link + push
```

### ⚙️ Conflict Resolution

`skillstash sync` handles merge conflicts automatically — no manual intervention required in most cases.

**How it works:**

When two devices independently install or modify skills, `sync` uses a smart three-way merge instead of a plain `git pull`:

1. `git fetch` — downloads remote changes without touching local files
2. If both sides have diverged, skillstash performs an application-level merge of `registry.json`:
   - **Newer `updatedAt` wins** when the same skill was modified on both sides
   - Remote additions are merged in; local additions are preserved
   - A deletion on one side is respected unless the other side modified the skill after the deletion
3. Any skill directory file conflicts are resolved automatically based on the same registry decision
4. A merge commit is created and the sync continues normally

**Uncommitted local changes** are automatically committed before fetching, so they're never at risk.

**If the hub is stuck in a MERGING state** (e.g. from a previous interrupted sync):

```bash
cd ~/.skillstash/skills-hub && git merge --abort
# Then re-run:
skillstash sync
```

## 📖 Command Reference

### `skillstash init [remote-url]`

Initialize the skills-hub. The hub is always at `~/.skillstash/skills-hub`.

During init, you'll be prompted to select a display language (English / 中文) and choose which agents to manage. Use arrow keys to navigate, space to toggle selection, and enter to confirm.

After agent selection and skill import, you'll be asked whether to run `link` immediately — this copies all skills from the hub into your managed agent directories so they're ready to use right away.

The remote URL is **optional**. Omit it to create a local-only hub and add a remote later with `add-remote`.

| Remote status | Behavior |
|---|---|
| **No URL (local mode)** | Create hub locally → select language → select agents → auto-import existing agent skills → prompt to link |
| **Empty repo** | Create hub locally → select language → select agents → auto-import existing agent skills → prompt to link → git push |
| **Non-empty with `registry.json`** | Clone hub → select language → select agents → re-detect local agents → import new local skills → prompt to link → git push |
| **Non-empty without `registry.json`** | ❌ Reject — not a skillstash repo. Prompt to create a new empty repo |

```bash
skillstash init                                       # Local-only hub
skillstash init git@github.com:yourname/my-skills.git
skillstash init https://github.com/yourname/my-skills.git
```

### `skillstash add-remote <remote-url>`

Link an existing local hub to a Git remote and push. Use this after running `skillstash init` without a URL.

```bash
skillstash add-remote git@github.com:yourname/my-skills.git
skillstash add-remote https://github.com/yourname/my-skills.git
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

### `skillstash agents`

Manage which agents skillstash syncs with. Only enabled agents receive skills during `link` and `sync`.

```bash
skillstash agents list              # Show all agents with available/managed status
skillstash agents select            # Interactively choose which agents to manage
skillstash agents enable claude     # Enable a specific agent
skillstash agents disable codex     # Disable an agent (skip for link/sync)
skillstash agents add <name> --path <skills-path>   # Register a custom agent
skillstash agents remove <name>     # Unregister a custom agent (built-ins cannot be removed)
```

The `select` subcommand shows the same interactive checkbox UI as `init` — arrow keys to navigate, space to toggle, enter to confirm. Shortcuts: `a` to select all, `i` to invert selection.

**Custom agents** are registered with `agents add` and stored in `local.json` (device-local). Built-in agents cannot be removed, only enabled/disabled.

### `skillstash language`

Change the display language for all CLI output. The setting is persisted to `local.json` and applied automatically on every subsequent command.

```bash
skillstash language    # Interactive prompt: English / 中文
```

Language can also be selected during `skillstash init`.

### `skillstash assign`

Configure which skills each agent receives **on the current device**, independently from every other device.

```bash
skillstash assign                   # Configure all enabled agents
skillstash assign --agent claude    # Configure only a specific agent
```

Running the command opens a checkbox prompt for each agent. Items are pre-checked based on the previous assignment (or all-checked on first run). After confirming, you are prompted to apply the changes immediately with `link`.

Assignments are stored in `local.json` (gitignored) and are completely independent per machine. Agents without an explicit assignment continue to receive all globally enabled skills — the new capability is entirely opt-in.

**Example: different skills per device**

```bash
# On your workstation: claude gets coding tools only
skillstash assign --agent claude
# → select: git-commit, finance-ops

# On your writing machine: claude gets document tools only
skillstash assign --agent claude
# → select: document-pdf, citation-management
```

Both machines share the same hub and sync the same skill files. Only the assignment differs.

## 🤖 Supported Agents

| Agent | Skills Directory | Auto-detected |
|---|---|:---:|
| Claude Code | `~/.claude/skills/` | ✅ |
| Codex CLI | `~/.codex/skills/` | ✅ |
| Gemini CLI | `~/.gemini/skills/` | ✅ |
| Cursor | `~/.cursor/skills-cursor/` | ✅ |
| Kilo Code | `~/.kilocode/skills/` | ✅ |
| TRAE (ByteDance) | `~/.trae/skills/` | ✅ |
| Qoder (Alibaba) | `~/.qoder/skills/` | ✅ |
| CodeBuddy (Tencent) | `~/.codebuddy/skills/` | ✅ |
| Kimi Code | `~/.config/agents/skills/` | ✅ |
| OpenClaw | `~/.openclaw/skills/` | ✅ |
| Vercel Skills | `~/.agents/skills/` | ✅ |
| OpenCode | `~/.opencode/skills/` | ✅ |
| AntiGravity | `~/.gemini/antigravity/skills/` | ✅ |
| Codes CLI | `~/.codes/skills/` | ✅ |
| iFlow CLI | `~/.iflow/skills/` | ✅ |

All agents are auto-detected, but you can choose which ones to manage via `skillstash init` or `skillstash agents select`. Disabled agents are still detected but skipped during `link` and `sync`.

## 🗂️ Registry Schema

The hub splits state across two files:

| File | Git-tracked | Contains |
|---|:---:|---|
| `registry.json` | ✅ | Skill metadata: name, version, hash, source URL |
| `local.json` | ❌ | Agent config, skill assignments, last sync time |

`local.json` is added to the hub's `.gitignore` automatically. This eliminates merge conflicts from device-specific state, and gives each device its own independent `assign` configuration.

**`registry.json`** (shared across devices):

```json
{
  "version": "1.0",
  "skills": {
    "finance-ops": {
      "version": "1.0.0",
      "source": "github",
      "sourceUrl": "https://github.com/owner/repo",
      "hash": "sha256:abc123...",
      "enabled": true,
      "description": "AI CFO assistant",
      "installedAt": "2026-04-24T12:00:00Z",
      "updatedAt": "2026-04-24T12:00:00Z"
    }
  }
}
```

**`local.json`** (gitignored, per-device):

```json
{
  "lastSync": "2026-04-24T12:00:00Z",
  "language": "en",
  "agents": {
    "claude": {
      "name": "claude",
      "skillsPath": "~/.claude/skills",
      "linkType": "copy",
      "available": true,
      "enabled": true
    }
  },
  "agentSkills": {
    "claude": ["finance-ops", "git-commit"]
  },
  "customAgents": [
    {
      "name": "my-agent",
      "skillsPath": "/custom/path/to/skills",
      "linkType": "copy"
    }
  ]
}
```

## 🏗️ Project Structure

```
skillstash/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── commands/
│   │   ├── agents.ts         # skillstash agents
│   │   ├── assign.ts         # skillstash assign
│   │   ├── init.ts           # skillstash init [remote-url]
│   │   ├── add-remote.ts     # skillstash add-remote <url>
│   │   ├── install.ts        # skillstash install
│   │   ├── link.ts           # skillstash link
│   │   ├── list.ts           # skillstash list
│   │   ├── sync.ts           # skillstash sync
│   │   ├── diff.ts           # skillstash diff
│   │   ├── remove.ts         # skillstash remove
│   │   ├── import.ts         # skillstash import
│   │   └── language.ts       # skillstash language
│   ├── core/
│   │   ├── agents.ts         # Built-in agent definitions & plugin API
│   │   ├── registry.ts       # Registry types & operations
│   │   ├── hub.ts            # Hub directory management
│   │   ├── git.ts            # Git operations
│   │   ├── merge.ts          # Three-way registry merge
│   │   └── skill.ts          # SKILL.md parsing & linting
│   ├── i18n/
│   │   ├── index.ts          # Locale management
│   │   ├── en.ts             # English strings
│   │   └── zh.ts             # Chinese strings
│   └── utils/
│       ├── fs.ts             # File system utilities
│       ├── lock.ts           # File-based lock (concurrent write guard)
│       ├── logger.ts         # Colored logging with spinner & progress
│       └── prompt.ts         # Interactive prompts (checkbox)
├── docs/
│   └── images/               # Assets
├── package.json
├── tsconfig.json
└── README.md
```

## 🛠️ Development

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

## 📄 License

MIT
