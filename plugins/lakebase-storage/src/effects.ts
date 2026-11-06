/** PostgreSQL persistence for durable effects; dispatch and retry policy remain in Effects. */
import type { Database } from './database.ts'
import type { EffectRecords, EffectRow } from 'dsh-superagent/storage'
export function postgresEffects(db: Database): EffectRecords {
  const own = 'kind = ? AND key = ? AND seq = ? AND generation = ?'
  const identity = (kind: string, row: EffectRow) => [kind, row.key, row.seq, row.generation]
  return {
    maxSequence: () => Number(db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM effect').get()?.seq ?? 0),
    upsert: row => { db.prepare(`INSERT INTO effect (kind, key, value, seq, due, since) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(kind, key) DO UPDATE
      SET value = excluded.value, generation = effect.generation + 1, attempts = 0, error = '', due = excluded.due`)
      .run(row.kind, row.key, row.value, row.seq, row.due, row.since) },
    pending: (kind, key) => key === undefined ? !!db.prepare('SELECT 1 FROM effect WHERE kind = ? LIMIT 1').get(kind)
      : !!db.prepare('SELECT 1 FROM effect WHERE kind = ? AND key = ?').get(kind, key),
    cancel: (kind, key) => { db.prepare('DELETE FROM effect WHERE kind = ? AND key = ?').run(kind, key) },
    ready: (kind, ordered, now, limit) => {
      const rows = ordered
        ? db.prepare('SELECT key, value, seq, generation, attempts, due FROM effect WHERE kind = ? ORDER BY seq LIMIT 1').all(kind)
        : db.prepare('SELECT key, value, seq, generation, attempts, due FROM effect WHERE kind = ? AND due <= ? ORDER BY seq LIMIT ?').all(kind, now, limit)
      return rows.map(row => ({ key: String(row.key), value: String(row.value), seq: Number(row.seq), generation: Number(row.generation), attempts: Number(row.attempts), due: Number(row.due) }))
    },
    complete: (kind, row) => { db.prepare(`DELETE FROM effect WHERE ${own}`).run(...identity(kind, row)) },
    retry: (kind, row, due, error) => {
      if (error === undefined) db.prepare(`UPDATE effect SET due = ? WHERE ${own}`).run(due, ...identity(kind, row))
      else db.prepare(`UPDATE effect SET attempts = attempts + 1, error = ?, due = ? WHERE ${own}`).run(error, due, ...identity(kind, row))
    },
    stats: kind => {
      const row = db.prepare(`SELECT COUNT(*) AS waiting, MIN(since) AS since, MAX(attempts) AS attempts,
        (SELECT error FROM effect WHERE kind = ? AND attempts > 0 ORDER BY seq DESC LIMIT 1) AS error FROM effect WHERE kind = ?`).get(kind, kind)
      return { waiting: Number(row?.waiting ?? 0), since: String(row?.since ?? ''), attempts: Number(row?.attempts ?? 0), error: String(row?.error ?? '') }
    },
  }
}
