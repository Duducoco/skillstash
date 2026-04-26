import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuildOptions: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/commands/init.ts', 'src/commands/install.ts', 'src/commands/sync.ts', 'src/commands/diff.ts', 'src/commands/remove.ts', 'src/commands/import.ts'],
    },
  },
});