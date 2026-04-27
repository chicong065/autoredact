import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

// Mirror the path alias declared in `tsconfig.json` so test files can import
// from `@/...` and have vitest resolve those imports against `./src/`.
const SOURCE_ROOT = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': SOURCE_ROOT,
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    benchmark: { include: ['test/bench/**/*.bench.ts'] },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/types.ts', 'src/index.ts', 'src/cli/index.ts'],
      reporter: ['text', 'html'],
      thresholds: {
        'src/engine/**/*.ts': { lines: 95, statements: 95, functions: 95, branches: 90 },
        'src/logger/**/*.ts': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/cli/**/*.ts': { lines: 80, statements: 80, functions: 80, branches: 75 },
      },
    },
  },
})
