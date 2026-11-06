/** Offline, read-only SQLite import into an empty Lakebase database. */
import { DatabaseSync } from 'node:sqlite'
import { isDeepStrictEqual } from 'node:util'
import { SCHEMA_VERSION } from 'dsh-superagent/storage'
import { LakebaseStorage } from './storage.ts'

const TABLES = {
  kv: ['key', 'value'], trigger: ['id', 'value', 'at'], disposition: ['id', 'value'],
  thread: ['key', 'value'], ticket: ['id', 'value'], decision: ['id', 'thread', 'value'],
  outbox: ['id', 'value'], trigger_thread: ['thread', 'id', 'at', 'human'],
  effect: ['kind', 'key', 'value', 'seq', 'generation', 'attempts', 'error', 'due', 'since'],
} as const
const ORDERED = new Set(['trigger', 'thread', 'ticket', 'decision', 'outbox'])
/** Requires stopped source process, schema 11, and a target containing no user state. */
export function importSqlite(sourcePath: string, connection: string): Record<string, number> {
  const source = new DatabaseSync(sourcePath, { readOnly: true })
  let target: LakebaseStorage | undefined
  try {
    source.exec('BEGIN')
    const version = source.prepare("SELECT value FROM kv WHERE key='schema'").get()?.value
    if (Number(version) !== SCHEMA_VERSION) throw new Error(`Import requires SQLite schema ${SCHEMA_VERSION}; upgrade a backup with upstream first`)
    target = new LakebaseStorage(connection)
    const store = target
    return store.atomic(() => {
      for (const table of Object.keys(TABLES)) {
        const where = table === 'kv' ? " WHERE key NOT IN ('schema','postgres-schema')" : ''
        if (Number(store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}${where}`).get()?.n)) throw new Error('Import requires an empty target database')
      }
      const counts: Record<string, number> = {}
      for (const [table, fields] of Object.entries(TABLES)) {
        const ordered = ORDERED.has(table)
        const columns = ordered ? [...fields, 'rowid'] : [...fields]
        const rows = source.prepare(`SELECT ${columns.join(',')} FROM ${table}${ordered ? ' ORDER BY rowid' : ''}`).all()
        for (const row of rows) {
          if (table === 'kv' && row.key === 'postgres-schema') throw new Error('Source contains reserved PostgreSQL schema metadata')
          const override = ordered ? ' OVERRIDING SYSTEM VALUE' : ''
          const conflict = table === 'kv' ? ' ON CONFLICT(key) DO UPDATE SET value=excluded.value' : ''
          store.db.prepare(`INSERT INTO ${table} (${columns.join(',')})${override} VALUES (${columns.map(() => '?').join(',')})${conflict}`).run(...columns.map(column => row[column]!))
        }
        const actual = store.db.prepare(`SELECT ${columns.join(',')} FROM ${table}${table === 'kv' ? " WHERE key <> 'postgres-schema'" : ''}`).all()
        const normalize = (row: Record<string, unknown>) => columns.map(column => column === 'value' ? JSON.parse(String(row[column])) : String(row[column]))
        const key = (row: Record<string, unknown>) => JSON.stringify(fields.filter(column => column !== 'value').map(column => row[column]))
        const expected = [...rows].sort((a,b) => key(a).localeCompare(key(b))).map(normalize)
        const received = [...actual].sort((a,b) => key(a).localeCompare(key(b))).map(normalize)
        if (!isDeepStrictEqual(expected, received)) throw new Error(`Import verification failed for ${table}`)
        counts[table] = rows.length
        if (ordered) store.db.exec(`SELECT setval(pg_get_serial_sequence('${table}','rowid'), COALESCE(MAX(rowid),1), MAX(rowid) IS NOT NULL) FROM ${table}`)
      }
      return counts
    })
  } finally { target?.close(); source.close() }
}
