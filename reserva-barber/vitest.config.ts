import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    // Two environments in one run: server logic stays on Node (fast, no DOM
    // globals to accidentally depend on), component tests get jsdom.
    // `environmentMatchGlobs` was removed in Vitest 4 — projects replace it.
    projects: [
      {
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          // `app` is included on purpose: not everything under it is a
          // component. A `.test.ts` there (an action, the form-state mapping)
          // would otherwise match neither project — Vitest would collect it
          // nowhere, the test would never run, and the suite would still
          // report green.
          include: ['{app,src}/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'components',
          environment: 'jsdom',
          include: ['{app,src}/**/*.test.tsx'],
          setupFiles: ['./vitest.setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // Deliberately scoped to domain + application only: component tests must
      // never inflate the threshold that protects business rules (design D4).
      include: ['src/server/domain/**', 'src/server/application/**'],
      // `*.probe.ts` is gate harness, not shipped logic: it is executed by
      // scripts/*-gate.ts and by an isolated worker to prove a runtime
      // capability, never by the application. Counting it would let test
      // scaffolding move the threshold that protects business rules.
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/*.probe.ts', '**/node_modules/**'],
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
