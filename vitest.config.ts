import { defineConfig } from 'vitest/config'
import path from 'path'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _testCfg: any = {
  globals: true,
  environment: 'node',
  // Memory/intelligence/tenant-isolation tests all read+write the same
  // shared SQLite file (gtm-os.db). libsql serializes writes with a
  // single-writer lock, so running files in parallel workers causes
  // sporadic SQLITE_BUSY. Force single-worker execution for correctness.
  pool: 'forks',
  // Vitest 4 moved pool options to top-level.
  forks: { singleFork: true },
  fileParallelism: false,
  globalSetup: ['./vitest.globalSetup.ts'],
}

export default defineConfig({
  test: _testCfg,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
