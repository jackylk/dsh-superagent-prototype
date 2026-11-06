/** Named storage factories; optional provider bundles can register before application startup. */
import { Service, type Context } from '@deepseek-ai/cordis'
import { join } from 'node:path'
import { Store } from './store.ts'
import type { StorageFactory } from './storage.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { superagentStorage: StorageProviders }
  interface Events { 'superagent-storage/removed'(name: string): void }
}
export const sqliteStorage: StorageFactory = request => {
  if (Object.keys(request.options).length) throw new Error('SQLite storage does not accept provider options')
  return new Store(join(request.stateDir, 'orchestrator.sqlite'), request.report)
}
/** Provider lifetime is explicit; removing one announces unavailability to its consumers. */
export class StorageProviders extends Service {
  private readonly factories = new Map<string, StorageFactory>([['sqlite', sqliteStorage]])
  private readonly waiting = new Map<string, Set<(factory?: StorageFactory) => void>>()
  private closed = false
  constructor(ctx: Context) {
    super(ctx, 'superagentStorage')
    ctx.effect(() => () => {
      this.closed = true
      for (const requests of this.waiting.values()) for (const request of requests) request()
      this.waiting.clear()
    })
  }
  register(name: string, factory: StorageFactory): () => void {
    if (this.closed) throw new Error('Storage providers are disposed')
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('Invalid storage provider name')
    if (this.factories.has(name)) throw new Error(`Storage provider ${name} is already registered`)
    this.factories.set(name, factory)
    for (const ready of this.waiting.get(name) ?? []) ready(factory)
    return () => {
      if (this.factories.get(name) !== factory) return
      this.factories.delete(name)
      this.ctx.emit('superagent-storage/removed', name)
    }
  }
  async resolve(name: string): Promise<StorageFactory> {
    if (this.closed) throw new Error('Storage providers are disposed')
    const factory = this.factories.get(name) ?? await new Promise<StorageFactory>((resolve, reject) => {
      const pending = this.waiting.get(name) ?? new Set<(factory?: StorageFactory) => void>()
      this.waiting.set(name, pending)
      const done = (value?: StorageFactory) => {
        clearTimeout(timeout); pending.delete(done)
        if (!pending.size) this.waiting.delete(name)
        if (value) resolve(value)
        else reject(new Error(`Storage provider ${name} is unavailable; install and enable its plugin`))
      }
      const timeout = setTimeout(() => done(), 5000)
      pending.add(done)
    })
    return request => {
      if (this.closed || this.factories.get(name) !== factory) throw new Error(`Storage provider ${name} is unavailable`)
      return factory(request)
    }
  }
}
