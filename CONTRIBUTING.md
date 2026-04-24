# Contributing to skillstash

Thank you for your interest in contributing! Here's everything you need to get started.

## Development Setup

```bash
git clone https://github.com/<your-fork>/skillstash.git
cd skillstash
npm ci
npm run build
```

Run the CLI from source after building:

```bash
node dist/index.js <command>
```

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

## Project Structure

```
src/
  index.ts           # CLI entry point
  commands/          # One file per command
  core/              # Hub, registry, git, skill, merge logic
  utils/             # fs, logger, prompt, lock
  i18n/              # en.ts, zh.ts, index.ts (Messages type)
test/                # Vitest test files
```

See `CLAUDE.md` for a detailed architecture overview.

## Testing Conventions

- Tests live in `test/` alongside source files
- Use `os.tmpdir()` + unique suffixes for temporary directories — always clean up in `afterEach`
- Prefer integration-style tests that operate on real files and git repos (see `test/hub.test.ts`)
- Mock network calls and external processes when unavoidable
- Run `npm run test:coverage` and check the report before submitting a PR

## i18n Rules

Every user-facing string must be added to **both** locale files and the `Messages` type:

1. `src/i18n/index.ts` — add the key to the `Messages` interface
2. `src/i18n/en.ts` — add the English string
3. `src/i18n/zh.ts` — add the Chinese string

Use `t('section.key', { param: value })` for parameterized strings.

## Version Bump Protocol

Before committing, update the version in **three** places:

1. `package.json` — `"version"` field
2. `package-lock.json` — `"version"` field (also the inner `"packages"."".version`)
3. `src/index.ts` — `.version('x.y.z')` on line ~38

Use [Semantic Versioning](https://semver.org/):

| Change type | Version bump |
|---|---|
| Bug fix, dependency update | Patch (`0.7.1 → 0.7.2`) |
| New feature, new command | Minor (`0.7.x → 0.8.0`) |
| Breaking change | Major (`0.x.y → 1.0.0`) |

## Documentation Rules

- If you modify `README.md`, update `README_zh.md` accordingly
- Add a CHANGELOG entry under `[Unreleased]` for every user-facing change

## Commit Style

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(command): add --dry-run flag to import
fix(sync): handle missing FETCH_HEAD gracefully
docs: update README with add-remote example
chore: bump version to 0.8.1
test: add concurrent lock test
```

## Pull Request Checklist

- [ ] All tests pass: `npm test`
- [ ] TypeScript compiles cleanly: `npm run build`
- [ ] New user-facing strings added to both `en.ts` and `zh.ts`
- [ ] Version bumped in all three locations (if applicable)
- [ ] `README.md` and `README_zh.md` updated (if applicable)
- [ ] CHANGELOG entry added under `[Unreleased]`

## Windows Compatibility

skillstash is designed to run on Windows. Keep these in mind:

- Use `path.join()` / `path.resolve()` — never string-concatenate paths
- The default link type is `copy` (symlinks require elevated permissions on Windows)
- Test file operations against both Unix and Windows paths when possible
- CI runs on both `ubuntu-latest` and `windows-latest`
