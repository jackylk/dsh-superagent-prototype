/** PostgreSQL schema version 1 for the schema-11 SuperAgent domain model. */
import type { Database } from './database.ts'
export function initializePostgres(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value JSONB NOT NULL);
    CREATE TABLE IF NOT EXISTS trigger (id TEXT PRIMARY KEY, value JSONB NOT NULL, at TEXT NOT NULL, rowid BIGINT GENERATED ALWAYS AS IDENTITY);
    CREATE TABLE IF NOT EXISTS disposition (id TEXT PRIMARY KEY, value JSONB NOT NULL);
    CREATE TABLE IF NOT EXISTS thread (key TEXT PRIMARY KEY, value JSONB NOT NULL, rowid BIGINT GENERATED ALWAYS AS IDENTITY,
      active INTEGER GENERATED ALWAYS AS (CASE WHEN jsonb_array_length(value->'pending') > 0 OR value->'evaluating' IS NOT NULL THEN 1 END) STORED,
      subscribed TEXT GENERATED ALWAYS AS (CASE WHEN jsonb_array_length(value->'subscriptions') > 0 THEN value#>>'{ref,source}' END) STORED);
    CREATE TABLE IF NOT EXISTS ticket (id TEXT PRIMARY KEY, value JSONB NOT NULL, rowid BIGINT GENERATED ALWAYS AS IDENTITY,
      open INTEGER GENERATED ALWAYS AS (CASE WHEN value->'ended' IS NULL THEN 1 END) STORED,
      active INTEGER GENERATED ALWAYS AS (CASE WHEN jsonb_array_length(value->'undelivered') > 0 OR value#>>'{assignments,-1,state}' IN ('pending','running') THEN 1 END) STORED);
    CREATE TABLE IF NOT EXISTS decision (id TEXT PRIMARY KEY, thread TEXT NOT NULL, value JSONB NOT NULL, rowid BIGINT GENERATED ALWAYS AS IDENTITY);
    CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, value JSONB NOT NULL, rowid BIGINT GENERATED ALWAYS AS IDENTITY,
      dropped TEXT GENERATED ALWAYS AS (value#>>'{dropped,at}') STORED,
      pending TEXT GENERATED ALWAYS AS (CASE WHEN value->>'status' = 'pending' AND value->>'ticketId' IS NOT NULL
        THEN (value->>'ticketId') || ' ' || (value#>>'{channel,thread}') END) STORED);
    CREATE TABLE IF NOT EXISTS trigger_thread (thread TEXT NOT NULL, id TEXT NOT NULL, at TEXT NOT NULL, human INTEGER NOT NULL, PRIMARY KEY(thread,id));
    CREATE TABLE IF NOT EXISTS effect (kind TEXT NOT NULL, key TEXT NOT NULL, value JSONB NOT NULL, seq BIGINT NOT NULL,
      generation BIGINT NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', due BIGINT NOT NULL,
      since TEXT NOT NULL, PRIMARY KEY(kind,key));
    CREATE INDEX IF NOT EXISTS trigger_at ON trigger(at);
    CREATE INDEX IF NOT EXISTS trigger_thread_at ON trigger_thread(thread,at);
    CREATE INDEX IF NOT EXISTS decision_thread ON decision(thread);
    CREATE INDEX IF NOT EXISTS effect_due ON effect(kind,due,seq);
    CREATE INDEX IF NOT EXISTS ticket_open ON ticket(open) WHERE open IS NOT NULL;
    CREATE INDEX IF NOT EXISTS ticket_active ON ticket(active) WHERE active IS NOT NULL;
    CREATE INDEX IF NOT EXISTS thread_active ON thread(active) WHERE active IS NOT NULL;
    CREATE INDEX IF NOT EXISTS thread_subscribed ON thread(subscribed) WHERE subscribed IS NOT NULL;
    CREATE INDEX IF NOT EXISTS outbox_pending ON outbox(pending) WHERE pending IS NOT NULL;
    CREATE INDEX IF NOT EXISTS outbox_dropped ON outbox(dropped) WHERE dropped IS NOT NULL;
  `)
}
