import { newId } from '../core/ids'
import type { ArgoDatabase } from './database'

const cache = new WeakMap<ArgoDatabase, string>()

/** Identificador estável deste aparelho (criado uma única vez). */
export async function getDeviceId(db: ArgoDatabase): Promise<string> {
  const cached = cache.get(db)
  if (cached) return cached
  const id = await db.transaction('rw', db.meta, async () => {
    const row = await db.meta.get('deviceId')
    if (typeof row?.value === 'string') return row.value
    const fresh = newId()
    await db.meta.put({ key: 'deviceId', value: fresh })
    return fresh
  })
  cache.set(db, id)
  return id
}

export async function getMeta<T>(db: ArgoDatabase, key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined
}

export async function setMeta(db: ArgoDatabase, key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value })
}
