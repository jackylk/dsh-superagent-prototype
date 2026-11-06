import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
export default defineConfig({ resolve: { alias: { 'dsh-superagent/storage': fileURLToPath(new URL('../../src/storage.ts', import.meta.url)) } }, test: { include: ['tests/**/*.spec.ts'], fileParallelism: false, testTimeout: Number(process.env.SUPERAGENT_TEST_TIMEOUT_MS ?? 180000), hookTimeout: 60000 } })
