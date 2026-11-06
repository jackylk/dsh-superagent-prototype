/** Run the same provider contract on the original SQLite implementation. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach } from 'vitest'
import { Store } from '../src/app/store.ts'
import { storageContract } from './fixtures/storage-contract.ts'
let directory: string, store: Store | undefined
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'sqlite-contract-')) })
afterEach(() => { store?.close(); store = undefined; rmSync(directory, { recursive: true, force: true }) })
storageContract(() => store = new Store(join(directory, 'state.sqlite')))
