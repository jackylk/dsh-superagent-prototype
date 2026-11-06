import { testConnection } from './support.ts'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { LakebaseStorage as Store } from '../src/storage.ts'
import { storageContract } from '../../../tests/fixtures/storage-contract.ts'

const connection = testConnection()
let store: Store | undefined
const open = () => store = new Store(connection)
beforeEach(() => {
  const s = open(); s.db.exec('TRUNCATE kv,trigger,disposition,thread,ticket,decision,outbox,trigger_thread,effect RESTART IDENTITY'); s.close(); store = undefined
})
afterEach(() => { store?.close(); store = undefined })
storageContract(open)
it('rejects a transaction whose SQL error was caught instead of reporting a rolled-back commit as success', () => {
  const s = open(), events: string[] = []
  expect(() => s.atomic(() => {
    s.set('must-rollback', true)
    s.afterCommit(() => events.push('committed'))
    try { s.db.exec('SELECT 1/0') } catch { /* Application catches a statement failure. */ }
  })).toThrow('aborted')
  expect(s.get('must-rollback')).toBeUndefined()
  expect(events).toEqual([])
})
