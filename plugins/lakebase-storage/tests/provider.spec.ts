/** Optional bundle registration and configuration validation without database writes. */
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { StorageProviders } from 'dsh-superagent/storage'
import { apply, createStorage } from '../src/index.ts'
it('registers the independent provider and removes it with its Cordis scope', async () => {
  const ctx = new Context(), providers = new StorageProviders(ctx)
  const fork = ctx.plugin({ apply })
  await new Promise(resolve => setTimeout(resolve, 0))
  const factory = await providers.resolve('lakebase')
  await fork.dispose()
  expect(() => factory({ stateDir: '/unused', options: {}, report: () => {}, onUnavailable: () => {} })).toThrow('unavailable')
})
it('rejects unknown options, relative paths and readable connection files before opening', () => {
  const request = { stateDir: '/unused', options: {}, report: () => {}, onUnavailable: () => {} }
  expect(() => createStorage({ ...request, options: { connectionFile: 'relative' } })).toThrow('absolute')
  expect(() => createStorage({ ...request, options: { connectionFile: '/unused', typo: true } })).toThrow()
  const directory = mkdtempSync(join(tmpdir(), 'provider-config-'))
  try {
    const connectionFile = join(directory, 'connection')
    writeFileSync(connectionFile, 'unused', { mode: 0o644 })
    expect(() => createStorage({ ...request, options: { connectionFile } })).toThrow('owner-only')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
