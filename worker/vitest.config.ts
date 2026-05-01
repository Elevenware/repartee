import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@repartee/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  // Worker tests don't use CSS; pin an empty PostCSS config so Vite doesn't
  // walk up the tree and pick up the parent authentique project's
  // postcss.config.js (which depends on Tailwind plugins not installed here).
  css: { postcss: { plugins: [] } },
  test: {
    include: ['test/**/*.test.ts'],
  },
})
