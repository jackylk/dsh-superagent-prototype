import { testConnection } from './support.ts'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { Store as SqliteStore } from '../../../src/app/store.ts'
import { LakebaseStorage as Store } from '../src/storage.ts'
import { importSqlite } from '../src/import-sqlite.ts'
const connection = testConnection()
it('imports current SQLite state and arrival order atomically without changing the source', () => {
  const directory = mkdtempSync(join(tmpdir(), 'superagent-import-')), path = join(directory, 'source.sqlite')
  try {
    const target = new Store(connection); target.db.exec('TRUNCATE kv,trigger,disposition,thread,ticket,decision,outbox,trigger_thread,effect RESTART IDENTITY'); target.close()
    const source = new SqliteStore(path)
    source.set('import-value', { text: '中文', nullable: null })
    for (const id of ['import-b', 'import-a']) source.triggers.save({ id, source: 'github', at: '1', text: id, threads: [], human: true, actor: { source: 'github', id: 'u' }, meta: {} })
    source.close()
    const before = readFileSync(path)
    const counts = importSqlite(path, connection)
    expect(counts.trigger).toBe(2)
    expect(readFileSync(path)).toEqual(before)
    const reopened = new Store(connection)
    expect(reopened.get('import-value')).toEqual({ text: '中文', nullable: null })
    expect(reopened.read.recentTriggers().map(t => t.id)).toEqual(['import-a', 'import-b'])
    reopened.close()
    expect(() => importSqlite(path, connection)).toThrow('empty')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
it('rolls back a failed import and leaves an empty target', () => {
  const directory = mkdtempSync(join(tmpdir(), 'superagent-import-fail-')), path = join(directory, 'source.sqlite')
  try {
    const target = new Store(connection); target.db.exec('TRUNCATE kv,trigger,disposition,thread,ticket,decision,outbox,trigger_thread,effect RESTART IDENTITY'); target.close()
    const source = new SqliteStore(path); source.set('import-first', true); source.close()
    const raw = new DatabaseSync(path); raw.exec("INSERT INTO kv(key,value) VALUES('broken','invalid JSON')"); raw.close()
    expect(() => importSqlite(path, connection)).toThrow()
    const reopened = new Store(connection)
    expect(reopened.get('import-first')).toBeUndefined()
    expect(reopened.tickets.list()).toEqual([])
    reopened.close()
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
