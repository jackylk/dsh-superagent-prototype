/** Minimal synchronous database surface used by Store and its durable queues. */
export type SQLInputValue = string | number | bigint | null | Uint8Array
export interface Statement {
  get(...parameters: SQLInputValue[]): Record<string, string | number | bigint | null | Uint8Array> | undefined
  all(...parameters: SQLInputValue[]): Record<string, string | number | bigint | null | Uint8Array>[]
  run(...parameters: SQLInputValue[]): { changes: number | bigint }
}
export interface Database {
  readonly dialect?: 'postgres'
  prepare(sql: string): Statement
  exec(sql: string): void
  close(): void
}
