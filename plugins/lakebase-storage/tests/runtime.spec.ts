import { testConnection } from './support.ts'
import { afterEach, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { createStorage } from '../src/index.ts'
import type { LakebaseStorage } from '../src/storage.ts'
import { feishu, startRuntime, type Host } from '../../../tests/fixtures/host.ts'
testConnection()
let host: Host | undefined
afterEach(async () => { await host?.stop(); host = undefined })
it('runs intake, decision, worker launch, follow-up, stop and management views with real Lakebase state', async () => {
  host = await startRuntime(undefined, createStorage, { connectionFile: resolve(process.env.SUPERAGENT_TEST_CONNECTION_FILE!) })
  const h = host
  expect(h.runtime.store.get('postgres-schema')).toBe(1)
  const accepted = await h.acceptedTicket(feishu('9101', '@bot 修复测试错误'))
  expect(accepted.ticket.assignments.length).toBe(1)
  expect(h.agents.has(accepted.sessionId)).toBe(true)
  const followup = feishu('9102', '补充：保留原接口', { root_id: 'om_9101', mentions: [] })
  h.runtime.receive(followup)
  await h.runtime.idle()
  expect(h.runtime.store.triggers.get(followup.id)).toBeDefined()
  h.runtime.engine.stopTicket(accepted.ticket.id, 'integration completed')
  await h.runtime.idle()
  expect(h.runtime.store.tickets.get(accepted.ticket.id)?.ended).toBeDefined()
  const overview = await h.api('GET', 'overview')
  expect(overview.status).toBe(200)
  expect(h.runtime.store.read.recentDecisions().length).toBeGreaterThan(0)
})
it('stops intake and shuts down cleanly when its Lakebase session is lost', async () => {
  host = await startRuntime(undefined, createStorage, { connectionFile: resolve(process.env.SUPERAGENT_TEST_CONNECTION_FILE!) })
  const h = host
  expect(() => (h.runtime.store as LakebaseStorage).db.exec('SELECT pg_terminate_backend(pg_backend_pid())')).toThrow()
  expect(h.runtime.lifetime.aborted).toBe(true)
  expect(() => h.runtime.receive(feishu('9201', '@bot 不应该接收'))).toThrow('stopping')
  await h.runtime.stop()
  expect(h.runtime.health.runtime?.state).toBe('error')
})
