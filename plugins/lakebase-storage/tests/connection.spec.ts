import { testConnection } from './support.ts'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { PostgresDatabase } from '../src/postgres.ts'

const connection = testConnection
let db: PostgresDatabase | undefined
afterEach(() => { db?.close(); db = undefined })
it('uses native synchronous parameterized queries and rejects a second database owner', () => {
  db = new PostgresDatabase(connection())
  expect(db.prepare('SELECT ?::jsonb AS value').get(JSON.stringify('master'))?.value).toBe(JSON.stringify('master'))
  expect(db.prepare('SELECT ?::jsonb AS value').get('null')?.value).toBe('null')
  expect(db.prepare('SELECT ?::text AS value').get("x' ? $1" )?.value).toBe("x' ? $1")
  expect(db.prepare("SELECT '?' AS literal, ?::int AS n").get(7)).toEqual({ literal: '?', n: 7 })
  expect(() => new PostgresDatabase(connection())).toThrow('already owned')
})
it('requires verified TLS for remote connections', () => {
  expect(() => new PostgresDatabase('postgres://user:secret@remote.example/db?sslmode=disable')).toThrow('verify-full')
  expect(() => new PostgresDatabase('postgres://user:secret@remote.example/db?sslmode=verify-full&sslmode=disable')).toThrow('verify-full')
})
it('keeps a connection usable after a rolled-back SQL error', () => {
  db = new PostgresDatabase(connection())
  db.exec('BEGIN; SAVEPOINT inner_work')
  expect(() => db!.exec('SELECT 1/0')).toThrow()
  db.exec('ROLLBACK TO inner_work; RELEASE inner_work; COMMIT')
  expect(db.prepare('SELECT 42 AS answer').get()?.answer).toBe(42)
})
it('fails closed after its server session is terminated, then allows a new owner to reopen', () => {
  const lost: Error[] = []
  db = new PostgresDatabase(connection(), error => { lost.push(error) })
  expect(() => db!.exec('SELECT pg_terminate_backend(pg_backend_pid())')).toThrow()
  expect(() => db!.prepare('SELECT 1').get()).toThrow('closed')
  expect(lost).toHaveLength(1)
  db.close()
  db = new PostgresDatabase(connection())
  expect(db.prepare('SELECT 1 AS n').get()?.n).toBe(1)
})
it('rejects a certificate presented for the wrong hostname', () => {
  const uri = new URL(connection())
  uri.searchParams.set('hostaddr', uri.searchParams.get('hostaddr') || uri.hostname)
  uri.hostname = 'wrong-host.invalid'
  expect(() => new PostgresDatabase(uri.toString())).toThrow(/certificate|does not match/)
})

it('preserves URI escaping when the trusted CA file path contains spaces', () => {
  const directory = mkdtempSync(join(tmpdir(), 'superagent CA '))
  try {
    const uri = new URL(connection()), ca = join(directory, 'trusted CA.pem')
    copyFileSync(uri.searchParams.get('sslrootcert')!, ca)
    uri.searchParams.set('sslrootcert', ca)
    // libpq URIs use percent encoding, not form-style plus encoding.
    uri.search = [...uri.searchParams].map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')
    db = new PostgresDatabase(uri.toString())
    expect(db.prepare('SELECT 1 AS n').get()?.n).toBe(1)
  } finally { db?.close(); rmSync(directory, { recursive: true, force: true }) }
})
