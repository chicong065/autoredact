import { fileURLToPath } from 'node:url'

import { defineConfig } from 'tsdown'

// Mirror the path alias declared in `tsconfig.json` so the bundler can
// resolve imports written as `@/...` against `./src/`.
const SOURCE_ROOT = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  minify: false,
  // The library entry stays platform neutral so a browser bundler can
  // tree shake the logger to nothing Node specific. The CLI entry imports
  // Node built ins (`node:fs`, `node:readline`, `node:stream`), which the
  // explicit external pattern marks so the bundler does not try to resolve
  // them at build time.
  platform: 'neutral',
  target: 'es2023',
  external: [/^node:/],
  alias: {
    '@': SOURCE_ROOT,
  },
})
