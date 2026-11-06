/** Native libpq synchronous PostgreSQL access. No worker, polling, or async bridge. */
import { createRequire } from 'node:module'
import type { SQLInputValue } from './database.ts'
import type { Database, Statement } from './database.ts'

interface NativeClient {
  connectSync(connection: string): void
  querySync(sql: string, parameters?: (string | null)[]): Record<string, unknown>[]
  getTransactionStatus(): string | null
  end(): void
  pq: { cmdTuples(): string; nfields(): number; ftype(index: number): number; fname(index: number): string; getisnull(row: number, column: number): boolean }
}
// libpq embeds a uv_poll_t in its GC-managed wrapper. finish() schedules uv_close,
// but releases the native ref immediately. Keep it alive through the close phase;
// otherwise GC before that phase can free the handle (verified with --expose-gc).
const closingClients = new Set<NativeClient>()
function finish(client: NativeClient): void {
  closingClients.add(client)
  client.end()
  setImmediate(() => { setImmediate(() => { closingClients.delete(client) }) })
}
/** Bind SQLite-style ? parameters without changing question marks inside SQL literals. */
export function parameters(sql: string): string {
  let index = 0, quoted = false, result = ''
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!
    if (ch === "'") {
      if (quoted && sql[i + 1] === "'") { result += "''"; i++; continue }
      quoted = !quoted
    }
    result += ch === '?' && !quoted ? `$${++index}` : ch
  }
  return result
}
/** One synchronous, exclusively owned PostgreSQL session; transport failure requires reopening. */
export class PostgresDatabase implements Database {
  readonly dialect = 'postgres' as const
  private client: NativeClient
  private closed = false
  constructor(connection: string, private readonly onConnectionLost?: (error: Error) => void) {
    const uri = new URL(connection)
    if (!['postgres:', 'postgresql:'].includes(uri.protocol)) throw new Error('Expected a PostgreSQL connection URI')
    if (uri.searchParams.getAll('sslmode').length !== 1 || uri.searchParams.get('sslmode') !== 'verify-full') throw new Error('Lakebase requires sslmode=verify-full')
    uri.searchParams.set('connect_timeout', uri.searchParams.get('connect_timeout') || '15')
    uri.searchParams.set('application_name', 'dsh-superagent')
    // libpq percent-decodes URI options but does not interpret form-style '+' as a space.
    uri.search = [...uri.searchParams].map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')
    const Native = createRequire(import.meta.url)('pg-native') as new () => NativeClient
    this.client = new Native()
    let connected = false
    try {
      this.client.connectSync(uri.toString())
      connected = true
      this.exec("SET client_min_messages = warning; SET statement_timeout = '15s'; SET lock_timeout = '5s'; SET idle_in_transaction_session_timeout = '60s'; SET synchronous_commit = on")
      // The entire database belongs to one instance; keep ownership until close.
      const row = this.client.querySync('SELECT pg_try_advisory_lock(1685287985, 1) AS owned')[0]
      if (!row?.owned) throw new Error('Lakebase database is already owned by another SuperAgent')
    } catch (error) { if (connected) this.close(); else this.closed = true; throw error }
  }
  prepare(text: string): Statement {
    const query = parameters(text)
    const execute = (values: SQLInputValue[]) => {
      if (this.closed) throw new Error('Lakebase connection is closed; reopen the Store')
      try {
        const rows = this.client.querySync(query, values.map(value => value === null ? null : String(value)))
        // pg-native decodes JSONB scalars too; restore JSON text using field OIDs,
        // rather than guessing from JavaScript object types or column names.
        const fields = Array.from({ length: this.client.pq.nfields() }, (_, index) => ({
          index, name: this.client.pq.fname(index), type: this.client.pq.ftype(index),
        })).filter(field => field.type === 114 || field.type === 3802)
        return rows.map((row, index) => {
          for (const field of fields) if (!this.client.pq.getisnull(index, field.index)) row[field.name] = JSON.stringify(row[field.name])
          return row
        }) as ReturnType<Statement['all']>
      } catch (error) {
        // A broken transport loses the session owner lock. Never reconnect or replay automatically.
        if (this.client.getTransactionStatus() === null) this.lost(error)
        throw error
      }
    }
    return {
      all: (...values) => execute(values),
      get: (...values) => execute(values)[0],
      run: (...values) => { execute(values); return { changes: Number(this.client.pq.cmdTuples() || 0) } },
    }
  }
  exec(text: string): void {
    if (this.closed) throw new Error('Lakebase connection is closed; reopen the Store')
    // PostgreSQL answers COMMIT in an aborted transaction with ROLLBACK, not an error.
    // Reject it before Store can publish afterCommit callbacks.
    if (text.trim().toUpperCase() === 'COMMIT' && this.client.getTransactionStatus() !== 'T')
      throw new Error('Cannot commit an aborted PostgreSQL transaction')
    try { this.client.querySync(text) }
    catch (error) {
      if (this.client.getTransactionStatus() === null) this.lost(error)
      throw error
    }
  }
  private lost(error: unknown): void {
    this.close()
    try { this.onConnectionLost?.(error instanceof Error ? error : new Error(String(error))) } catch { /* Preserve the transport error. */ }
  }
  close(): void { if (!this.closed) { this.closed = true; finish(this.client) } }
}
