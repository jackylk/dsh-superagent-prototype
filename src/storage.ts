/** Public synchronous storage API and the built-in provider registry plugin. */
import type { Context } from '@deepseek-ai/cordis'
import { StorageProviders } from './app/storage-providers.ts'
export * from './app/storage.ts'
export { StorageProviders } from './app/storage-providers.ts'
export { Versions } from './app/versions.ts'
export { threadKey } from './core/index.ts'
export { KV } from './kv.ts'
export { SettingsSchema } from './policy.ts'
export type { Settings, SettingsSave, SettingsOrigin } from './policy.ts'
export type { Key, Family } from './kv.ts'
export type { Trigger, Thread, Ticket, Decision, TriggerDisposition, ChannelRef, OutboundMessage, ReplyStatus, ThreadFact, ThreadFacts } from './core/index.ts'
export { SCHEMA_VERSION } from './app/migration.ts'
export function apply(ctx: Context): void { new StorageProviders(ctx) }
