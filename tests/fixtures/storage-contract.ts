/** Semantic acceptance cases shared unchanged by SQLite and optional providers. */
import { expect, it } from 'vitest'
import type { Storage } from '../../src/app/storage.ts'
import { KV } from '../../src/kv.ts'
import { Effects } from '../../src/app/effects.ts'
export function storageContract(open: () => Storage): void {
it('preserves synchronous nested rollback, commit callbacks, JSON and settings across reopen', () => {
  const s = open(), events: string[] = []
  s.atomic(() => {
    s.set('contract-contract', { n: 1, missing: null })
    s.afterCommit(() => events.push('outer'))
    expect(() => s.atomic(() => { s.set('contract-contract', { n: 2 }); s.afterCommit(() => events.push('bad')); throw new Error('rollback') })).toThrow('rollback')
    s.atomic(() => { s.set('contract-contract-inner', true); s.afterCommit(() => events.push('inner')) })
    expect(events).toEqual([])
  })
  expect(events).toEqual(['outer', 'inner'])
  expect(s.get('contract-contract')).toEqual({ n: 1, missing: null })
  const revision = s.blockRevision('pause')
  s.saveSettings({ ...s.settings(), paused: true }, { source: 'internal', block: 'pause', policyVersion: '', policyChanged: false, notified: [] })
  expect(s.blockRevision('pause')).toBe(revision + 1)
  s.close(); const reopened = open()
  expect(reopened.settings().paused).toBe(true)
  expect(reopened.get('contract-contract-inner')).toBe(true)
  reopened.delete('contract-contract'); reopened.delete('contract-contract-inner')
})
it('preserves arrival order and escaped case-insensitive search after updates', () => {
  const s = open()
  for (const [id, at, text] of [['contract-a', '2', 'Hello %_'], ['contract-b', '1', 'second']]) {
    s.triggers.save({ id: id!, at: at!, text: text!, source: 'github', threads: [{ source: 'github', id: 'contract-thread' }], actor: { source: 'github', id: 'user' }, human: true, meta: {} })
  }
  const a = s.triggers.get('contract-a')!; s.triggers.save({ ...a, text: 'HELLO %_ updated' })
  expect(s.read.recentTriggers().filter(t => t.id.startsWith('contract-')).map(t => t.id)).toEqual(['contract-b', 'contract-a'])
  expect(s.read.search('hello %_').map(t => t.id)).toContain('contract-a')
  expect(s.read.search('hello X_').map(t => t.id)).not.toContain('contract-a')
  expect(s.read.triggerStats('0').github?.received).toBeGreaterThanOrEqual(2)
  expect(s.read.flow('0')).toEqual({ judged: 0, accepted: 0 })
})
it('keeps outbox receipt ids idempotent and sends the oldest pending reply first', () => {
  const s = open(), channel = { source: 'github', thread: 'contract-outbox', address: {} }
  const message = (id: string) => ({ id, channel, text: id, kind: 'reply' as const, ticketId: 'contract-ticket' })
  expect(s.receipts.add(message('contract-msg-a'))).toBe(true)
  expect(s.receipts.add(message('contract-msg-a'))).toBe(false)
  s.receipts.add(message('contract-msg-b'))
  expect(s.receipts.behind('contract-msg-b', 3)).toBe(true)
  s.receipts.settle(message('contract-msg-a'), 'sent')
  expect(s.replyStatus('contract-msg-a')).toBe('sent')
  expect(s.receipts.behind('contract-msg-b', 3)).toBe(false)
  s.receipts.settle(message('contract-msg-b'), 'channelGone')
  expect(s.replyStatus('contract-msg-b')).toBe('dropped')
  expect(s.read.droppedReplies().some(r => r.id === 'contract-msg-b')).toBe(true)
})
it('dispatches committed effects, discards rolled-back effects and retains requeued generations', async () => {
  const s = open(), ran: string[] = []
  const effects = new Effects(s, { claim: () => ({ set: () => {} }) } as never)
  effects.handle('reply', async (_payload, id) => { ran.push(id) })
  expect(() => s.atomic(() => { effects.enqueue('reply', 'contract-rolledback', {}); throw new Error('abort') })).toThrow('abort')
  s.atomic(() => effects.enqueue('reply', 'contract-committed', {}))
  expect(effects.pending('reply', 'contract-rolledback')).toBe(false)
  effects.start(); await effects.idle(); await effects.drain()
  expect(ran).toEqual(['contract-committed'])
  expect(effects.pending('reply', 'contract-committed')).toBe(false)
  expect(s.get(KV.store.schema)).toBeDefined()
})
}
