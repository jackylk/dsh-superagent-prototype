/** Provider selection stays generic and preserves synchronous storage semantics. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { StorageProviders } from '../src/app/storage-providers.ts'
import { Store } from '../src/app/store.ts'

it('uses SQLite by default and commits effect records with the same transaction', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'storage-provider-'))
  const providers = new StorageProviders(new Context())
  const factory = await providers.resolve('sqlite')
  const storage = factory({ stateDir: directory, options: {}, report: () => {}, onUnavailable: () => {} })
  try {
    expect(storage.get('contract')).toBeUndefined()
    expect(() => storage.atomic(() => {
      storage.set('contract', true)
      storage.effects.upsert({ kind: 'reply', key: 'rollback', value: '{}', seq: 1, due: 0, since: 'now' })
      throw new Error('abort')
    })).toThrow('abort')
    expect(storage.get('contract')).toBeUndefined()
    expect(storage.effects.pending('reply', 'rollback')).toBe(false)
  } finally { storage.close(); rmSync(directory, { recursive: true, force: true }) }
})
it('waits for an explicitly selected provider and never silently falls back', async () => {
  const providers = new StorageProviders(new Context())
  const resolve = providers.resolve('custom')
  const factory = () => { throw new Error('not opened') }
  const remove = providers.register('custom', factory)
  expect(await resolve).toBeTypeOf('function')
  remove()
  expect(() => providers.register('sqlite', factory)).toThrow('already registered')
})
it('fails missing provider selection with an actionable error', async () => {
  vi.useFakeTimers()
  try {
    const providers = new StorageProviders(new Context())
    const failure = expect(providers.resolve('missing')).rejects.toThrow('install and enable')
    await vi.advanceTimersByTimeAsync(5000)
    await failure
  } finally { vi.useRealTimers() }
})
it('keeps the SQLite queue generation when an old attempt finishes after a payload update', () => {
  const directory = mkdtempSync(join(tmpdir(), 'storage-effects-')), storage = new Store(join(directory, 'store.sqlite'))
  try {
    storage.effects.upsert({ kind: 'reply', key: 'k', value: '{}', seq: 1, due: 0, since: 'now' })
    const old = storage.effects.ready('reply', false, 0, 10)[0]!
    storage.effects.upsert({ kind: 'reply', key: 'k', value: '{"new":true}', seq: 2, due: 0, since: 'later' })
    storage.effects.complete('reply', old)
    expect(storage.effects.ready('reply', false, 0, 10)).toMatchObject([{ seq: 1, generation: 1, value: '{"new":true}' }])
  } finally { storage.close(); rmSync(directory, { recursive: true, force: true }) }
})
it('finishes shutdown once when storage loss is first detected while stopping', async () => {
  const { startRuntime } = await import('./fixtures/host.ts')
  const { sqliteStorage } = await import('../src/app/storage-providers.ts')
  let fail = false
  const host = await startRuntime(undefined, request => {
    const storage = sqliteStorage(request), list = storage.tickets.list
    storage.tickets.list = (...args) => {
      if (fail) { request.onUnavailable(new Error('session lost')); throw new Error('closed') }
      return list(...args)
    }
    return storage
  })
  try {
    fail = true
    await expect(host.runtime.stop()).resolves.toBeUndefined()
    expect(host.ctx.sessionPersistence.flush).toHaveBeenCalledTimes(1)
  } finally { await host.stop().catch(() => {}) }
})
it('rejects an already resolved factory after its provider is removed', async () => {
  const ctx = new Context(), providers = new StorageProviders(ctx), removed = vi.fn()
  ctx.on('superagent-storage/removed', removed)
  const open = vi.fn(() => { throw new Error('should not open') })
  const dispose = providers.register('custom', open)
  const resolved = await providers.resolve('custom')
  dispose(); dispose()
  expect(removed).toHaveBeenCalledExactlyOnceWith('custom')
  expect(() => resolved({ stateDir: '/unused', options: {}, report: () => {}, onUnavailable: () => {} })).toThrow('unavailable')
  expect(open).not.toHaveBeenCalled()
})
