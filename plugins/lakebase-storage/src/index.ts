/** Optional Lakebase provider bundle; core never imports this package. */
import type { Context } from '@deepseek-ai/cordis'
import type { StorageFactory } from 'dsh-superagent/storage'
import { readFileSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { LakebaseStorage } from './storage.ts'
export const inject = ['superagentStorage']
export const createStorage: StorageFactory = request => {
  const { connectionFile } = z.object({ connectionFile: z.string().min(1) }).strict().parse(request.options)
  if (!isAbsolute(connectionFile)) throw new Error('Lakebase connectionFile must be an absolute path')
  if (statSync(connectionFile).mode & 0o077) throw new Error('Lakebase connection file must be owner-only (chmod 600)')
  return new LakebaseStorage(readFileSync(connectionFile, 'utf8').trim(), request.report, request.onUnavailable)
}
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.superagentStorage.register('lakebase', createStorage))
}
