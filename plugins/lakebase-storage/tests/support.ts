/** Destructive integration tests must target a clearly named disposable database. */
import { readFileSync } from 'node:fs'
export function testConnection(): string {
  const path = process.env.SUPERAGENT_TEST_CONNECTION_FILE
  if (!path) throw new Error('Set SUPERAGENT_TEST_CONNECTION_FILE to a disposable test database connection file')
  const connection = readFileSync(path, 'utf8').trim()
  const database = decodeURIComponent(new URL(connection).pathname.slice(1))
  if (!database.startsWith('superagent-test-')) throw new Error('Lakebase tests reset tables; database name must start with superagent-test-')
  return connection
}
