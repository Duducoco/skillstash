# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # Compile TypeScript → dist/
npm run dev            # Watch mode (tsc --watch)
npm run test           # Run all tests (vitest run)
npm run test:watch     # Run tests in watch mode
npm run test:coverage  # Run tests with coverage report
```

Run a single test file:
```bash
npx vitest run test/hub.test.ts
```

The CLI itself (after build):
```bash
node dist/index.js <command>
```

## Architecture

skillstash is a CLI tool for managing and syncing AI agent skills across multiple devices. It maintains a git-backed hub at `~/.skillstash/skills-hub/` and copies/links skills to managed agent directories.

### Storage model

The hub splits state across two files:
- **`registry.json`** — shared across devices via git; contains skill metadata (name, version, hash, source URL)
- **`local.json`** — gitignored; contains agent configs and skill→agent assignments (device-specific)

Skills live under `skills/<name>/` in the hub; each skill directory must have a `SKILL.md` with YAML frontmatter.

### Command flow

```
CLI (src/index.ts)
  └─ Commands (src/commands/)
       └─ Core (src/core/)         ← hub.ts · git.ts · registry.ts · skill.ts
            └─ Utils (src/utils/)  ← fs.ts · logger.ts · prompt.ts
```

Key command flows:
- **`init`** — probe remote → detect agents → clone/init hub → auto-import → `link` → push
- **`install`** — resolve source (ClawHub / GitHub shallow-clone / local path) → validate SKILL.md → copy to hub → update registry → commit
- **`link`** — read registry → copy hub skills to each enabled agent directory (default: copy; alt: symlink/junction)
- **`sync`** — git pull → verify hashes → `link` → git push

### Supported agents (auto-detected)

| Agent | Key | Global skills path |
|---|---|---|
| Claude Code | `claude` | `~/.claude/skills` |
| Codex CLI | `codex` | `~/.codex/skills` |
| Gemini CLI | `gemini` | `~/.gemini/skills` |
| Cursor | `cursor` | `~/.cursor/skills-cursor` |
| Kilo Code | `kilocode` | `~/.kilocode/skills` |
| TRAE (ByteDance) | `trae` | `~/.trae/skills` |
| Qoder (Alibaba) | `qoder` | `~/.qoder/skills` |
| CodeBuddy (Tencent) | `codebuddy` | `~/.codebuddy/skills` |
| Kimi Code | `kimi` | `~/.config/agents/skills` |
| OpenClaw | `openclaw` | `~/.openclaw/skills` |
| Vercel Skills | `agents` | `~/.agents/skills` |
| OpenCode | `opencode` | `~/.opencode/skills` |
| AntiGravity | `antigravity` | `~/.gemini/antigravity/skills` |
| Codes CLI | `codes` | `~/.codes/skills` |
| iFlow CLI | `iflow` | `~/.iflow/skills` |

### Key design notes

- **Copy-by-default** for maximum Windows compatibility; symlink/junction modes are opt-in.
- `hashDir()` in `src/utils/fs.ts` computes a deterministic SHA-256 over a skill directory — used for change detection in `sync` and `diff`.
- Registry mutations go through helpers in `src/core/registry.ts` (`addSkill`, `removeSkill`, `updateSkill`); never write registry JSON directly.
- `src/core/hub.ts` owns the migration logic when loading old registry formats (agents/lastSync moved from `registry.json` to `local.json` in the v1 split).
- Non-TTY environments (CI) auto-select agents in prompts (`src/utils/prompt.ts`).

## Special Instructions
- If you modified README.md, please update README_zh.md accordingly.
- Before committing, please update the version number in package.json,package-lock.json and src/index.ts. You may ask the user whether to increment the patch, minor, or major version number, this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).