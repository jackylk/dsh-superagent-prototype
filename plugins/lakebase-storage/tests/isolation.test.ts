/** Opt-in acceptance: each concurrent instance owns its own disposable database. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import type { Storage } from 'dsh-superagent/storage'
import { createStorage } from '../src/index.ts'
function file(name: string): string {
  const path = resolve(process.env[name] ?? '')
  if (!process.env[name]) throw new Error(`Set ${name} to a disposable database connection file`)
  if (!decodeURIComponent(new URL(readFileSync(path, 'utf8').trim()).pathname.slice(1)).startsWith('superagent-test-')) throw new Error('Isolation acceptance requires disposable test databases')
  return path
}
it('isolates simultaneous instances and refuses a second owner of either database', () => {
  const a = file('SUPERAGENT_TEST_CONNECTION_FILE'), b = file('SUPERAGENT_TEST_SECOND_CONNECTION_FILE')
  const name = (path: string) => new URL(readFileSync(path, 'utf8').trim()).pathname
  expect(name(a)).not.toBe(name(b))
  const open = (connectionFile: string) => createStorage({ stateDir: '/unused', options: { connectionFile }, report: () => {}, onUnavailable: () => {} })
  let first: Storage | undefined, second: Storage | undefined
  try {
    first = open(a); second = open(b)
    first.set('isolation-first', true); second.set('isolation-second', true)
    expect(first.get('isolation-second')).toBeUndefined()
    expect(second.get('isolation-first')).toBeUndefined()
    expect(first.get('isolation-first')).toBe(true)
    expect(second.get('isolation-second')).toBe(true)
    expect(() => open(a)).toThrow('already owned')
    expect(() => open(b)).toThrow('already owned')
  } finally { first?.close(); second?.close() }
})
