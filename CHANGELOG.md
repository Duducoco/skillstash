# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.8.0] - 2026-04-25

### Added
- `skillstash init` now works without a remote URL — creates a local-only hub by default
- New `skillstash add-remote <url>` command to link an existing local hub to a Git remote
- Agent plugin/extension mechanism: custom agents can be registered via `agents add <name> --path <path>` and stored in `local.json`
- New `agents add <name> --path <path>` subcommand to register a custom agent
- New `agents remove <name>` subcommand to unregister a custom agent
- `sync` now shows a spinner during fetch/push and a `[x/y]` progress counter during skill linking
- `logger.verbose()` for debug output controlled by `SKILLSTASH_VERBOSE=1`
- File-based lock (`withLock`) to prevent concurrent CLI processes from overwriting `registry.json`
- CHANGELOG.md, CONTRIBUTING.md, and NEXT.md project documentation

### Changed
- `skillstash init <remote-url>` — `<remote-url>` is now optional; omitting it runs local-only init
- All `execSync` git calls now have explicit timeouts to prevent hangs on slow networks
- `gitPull`, `gitPush`, `gitFetch` accept an optional `onProgress` callback
- `gitShallowClone` returns a `GitCloneResult` object with `errorType` for better error diagnosis
- `install` GitHub errors now show specific messages (repo not found, auth failed, timeout)
- `prepublishOnly` script now runs tests before publishing: `npm run build && npm test`

### Fixed
- `package.json` author field was empty

## [0.7.1] - 2026-04-24

### Fixed
- Hardened skill sync and install safety checks
- Stabilized git integration tests for CI environments

## [0.7.0] - 2026-04-23

### Added
- Internationalization (i18n) system with English and Chinese language support
- `skillstash language` command to switch display language
- Chinese README (`README_zh.md`)

## [0.6.1] - 2026-04-22

### Changed
- Simplified skill list display in `assign` command

## [0.6.0] - 2026-04-22

### Added
- Per-device per-agent skill assignment via `skillstash assign`
- Three-way registry merge: `sync` now uses fetch + smart merge instead of plain `git pull`
- Registry split into `registry.json` (git-tracked, shared) and `local.json` (gitignored, device-specific)

## [0.5.4] - 2026-04-21

### Added
- Interactive agent selection prompt during `init`
- Option to run `link` immediately after `init`
- Unavailable agents are automatically unchecked during selection

### Fixed
- CI matrix: dropped Node 18 support (minimum is now 20.12.0)

## [0.5.1] - 2026-04-20

### Changed
- Project renamed from `skill-sync` to `skillstash`
- Comprehensive test suite with vitest

### Added
- `skillstash diff` command
- CJK-aware column alignment in `skillstash list`
