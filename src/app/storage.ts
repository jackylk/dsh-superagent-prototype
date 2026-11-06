/** Synchronous persistence contract shared by the application and optional providers. */
import type { Decision, OutboundMessage, ReplyStatus, Repositories, Thread, Trigger, ThreadFact } from '../core/index.ts'
import type { Family, Key } from '../kv.ts'
import type { Settings, SettingsOrigin, SettingsSave } from '../policy.ts'

export interface TimelinePlace { at: string; id: string }
export type DropReason = 'channelGone' | 'channelIgnored'
export interface Receipt extends OutboundMessage { status: ReplyStatus; dropped?: { at: string; reason: DropReason } }
export type Dropped = Receipt & { dropped: { at: string; reason: DropReason } }
export interface SettingsVersion {
  revision: number; savedAt: string; source: SettingsOrigin | 'internal'; block?: SettingsSave
  policyVersion: string; policyChanged: boolean; notified: string[]; settings: Settings
}
export interface StorageReads {
  recentTriggers(offset?: number, limit?: number): Trigger[]
  triggerStats(since: string): Record<string, { received: number; filtered: number; lastAt: string }>
  flow(since: string): { judged: number; accepted: number }
  triggers(options: { source?: string; filtered?: boolean }, offset?: number, limit?: number): { items: Trigger[]; more: boolean }
  threadTriggers(thread: string, limit?: number, before?: TimelinePlace, through?: boolean): Trigger[]
  threadPage(thread: string, offset: number, limit: number): Trigger[]
  neighbours(thread: string, at: string, id: string): { before?: Trigger; after?: Trigger }
  firstTrigger(thread: string, humanOnly?: boolean): Trigger | undefined
  search(query: string, limit?: number): Trigger[]
  recentDecisions(offset?: number, limit?: number): Decision[]
  decisions(options: { kinds: string[]; since: string }, offset: number, limit: number): { items: Decision[]; more: boolean }
  decisionsOfKinds(kinds: string[], limit?: number): Decision[]
  failingReplies(): (Receipt & { attempts: number; error: string })[]
  droppedReplies(limit?: number): Dropped[]
  droppedSince(since: string): number
  subscribedThreads(source?: string): Thread[]
}
/** Queue position and payload generation protect updated work from stale completions. */
export interface EffectRow { key: string; value: string; seq: number; generation: number; attempts: number; due: number }
export interface EffectInsert { kind: string; key: string; value: string; seq: number; due: number; since: string }
/** All mutations participate in the enclosing Storage.atomic transaction. */
export interface EffectRecords {
  maxSequence(): number
  upsert(row: EffectInsert): void
  pending(kind: string, key?: string): boolean
  cancel(kind: string, key: string): void
  ready(kind: string, ordered: boolean, now: number, limit: number): EffectRow[]
  complete(kind: string, row: EffectRow): void
  retry(kind: string, row: EffectRow, due: number, error?: string): void
  stats(kind: string): { waiting: number; since: string; attempts: number; error: string }
}
export interface ReceiptRecords {
  get(id: string): Receipt | undefined
  waiting(): Receipt[]
  behind(id: string, failures: number): boolean
  add(message: OutboundMessage): boolean
  settle(message: OutboundMessage, outcome: 'sent' | DropReason): void
  withdraw(id: string): boolean
}
/** Providers return values directly; transactions never contain asynchronous callbacks. */
export interface Storage extends Repositories {
  close(): void
  afterCommit(action: () => void): void
  get<V>(name: Key<V>): V | undefined
  set<V>(name: Key<V>, value: V): void
  delete(name: string): void
  keys<V>(family: Family<V, never>): Key<V>[]
  keys(prefix: string): string[]
  settings(): Settings
  blockRevision(block: SettingsSave): number
  saveSettings(value: unknown, record?: Omit<SettingsVersion, 'revision' | 'savedAt' | 'settings'>): Settings
  settingsHistory(limit?: number): SettingsVersion[]
  replyStatus(id: string): ReplyStatus | undefined
  readonly threads: Repositories['threads'] & {
    describe(key: string, patch: { label?: string; url?: string; facts?: Record<string, ThreadFact | null> }): void
    patchMeta(key: string, patch: Record<string, unknown>): void
  }
  readonly read: StorageReads
  readonly receipts: ReceiptRecords
  readonly effects: EffectRecords
}
export interface StorageRequest {
  stateDir: string
  options: Readonly<Record<string, unknown>>
  report(error: unknown): void
  onUnavailable(error: Error): void
}
export type StorageFactory = (request: StorageRequest) => Storage
