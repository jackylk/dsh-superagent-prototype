import { testConnection } from './support.ts'
/** Real native lifecycle checks run in child processes so crashes cannot masquerade as success. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'
import { expect, it } from 'vitest'
testConnection()
it('survives immediate GC after closing a native connection', () => {
  const compiled = resolve('.artifacts/lakebase/postgres-under-test.mjs')
  mkdirSync(resolve('.artifacts/lakebase'), { recursive: true })
  writeFileSync(compiled, ts.transpileModule(readFileSync('src/postgres.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.ESNext } }).outputText)
  const code = `import {readFileSync} from 'node:fs'; import {PostgresDatabase} from ${JSON.stringify('file://' + compiled)};
    let db = new PostgresDatabase(readFileSync(process.env.SUPERAGENT_TEST_CONNECTION_FILE,'utf8').trim());
    db.close(); db=null; global.gc(); setTimeout(()=>{global.gc();console.log('closed safely')},30)`
  const result = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', code], { env: process.env, encoding: 'utf8', timeout: 60000 })
  expect({ status: result.status, signal: result.signal, stderr: result.stderr }).toEqual({ status: 0, signal: null, stderr: '' })
  expect(result.stdout).toContain('closed safely')
})
it('recovers committed state and rolls back unfinished work after a process is killed', async () => {
  const { spawn } = await import('node:child_process')
  const compiled = resolve('.artifacts/lakebase/postgres-under-test.mjs')
  mkdirSync(resolve('.artifacts/lakebase'), { recursive: true })
  writeFileSync(compiled, ts.transpileModule(readFileSync('src/postgres.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.ESNext } }).outputText)
  const code = `import {readFileSync} from 'node:fs'; import {PostgresDatabase} from ${JSON.stringify('file://' + compiled)};
    const db = new PostgresDatabase(readFileSync(process.env.SUPERAGENT_TEST_CONNECTION_FILE,'utf8').trim());
    db.exec("CREATE TABLE IF NOT EXISTS superagent_lifecycle(id TEXT PRIMARY KEY); TRUNCATE superagent_lifecycle; INSERT INTO superagent_lifecycle VALUES('committed')"); db.exec("BEGIN; INSERT INTO superagent_lifecycle VALUES('unfinished')");
    console.log('ready to kill'); setInterval(()=>{},1000)`
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
  let diagnostics = ''
  child.stderr.on('data', chunk => { diagnostics += String(chunk) })
  const exited = new Promise<void>(resolveExit => { child.once('exit', () => resolveExit()) })
  try {
    await new Promise<void>((resolveReady, reject) => {
      const timeout = setTimeout(() => reject(new Error('Child did not reach transaction: ' + diagnostics)), 60000)
      child.stdout.on('data', chunk => { if (String(chunk).includes('ready to kill')) { clearTimeout(timeout); resolveReady() } })
      child.once('error', error => { clearTimeout(timeout); reject(error) })
      child.once('exit', () => { clearTimeout(timeout); reject(new Error('Child exited before ready: ' + diagnostics)) })
    })
    child.kill('SIGKILL'); await exited
    const { PostgresDatabase } = await import('../src/postgres.ts')
    const db = new PostgresDatabase(testConnection())
    try { expect(db.prepare('SELECT id FROM superagent_lifecycle ORDER BY id').all()).toEqual([{ id: 'committed' }]) }
    finally { try { db.exec('DROP TABLE IF EXISTS superagent_lifecycle') } finally { db.close() } }
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }
})
