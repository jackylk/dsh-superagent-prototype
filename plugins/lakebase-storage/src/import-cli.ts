/** CLI for offline import. Credentials stay in a private connection file. */
import { readFileSync, statSync } from 'node:fs'
import { importSqlite } from './import-sqlite.ts'
const [source, connectionFile] = process.argv.slice(2)
if (!source || !connectionFile) throw new Error('Usage: node lib/import-sqlite.js SOURCE.sqlite CONNECTION_FILE')
if (statSync(connectionFile).mode & 0o077) throw new Error('Connection file must have owner-only permissions (chmod 600)')
try { console.log(JSON.stringify(importSqlite(source, readFileSync(connectionFile, 'utf8').trim()))) }
catch { console.error('SQLite import failed. Check source schema and connection; verify target state before retrying, especially after a lost COMMIT response.'); process.exitCode = 1 }
