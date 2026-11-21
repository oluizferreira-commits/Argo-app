import { newId, nowIso } from '../core/ids'
import { entityTable, type ArgoDatabase } from '../db/database'
import { getMeta, setMeta } from '../db/device'
import { ENTITY_NAMES, type EntityName } from '../db/types'
import type { AnyRecord, PushItem, SyncAdapter } from './types'

export type SyncOutcome =
  | { status: 'not-configured' }
  | { status: 'offline' }
  | { status: 'done'; pushed: number; failed: number; pulled: number }

const BATCH = 100

/**
 * Executa um ciclo de sincronização:
 *  1. PUSH: envia o estado atual de cada registro da fila (outbox).
 *  2. PULL: recebe alterações remotas e aplica com a regra
 *     "vence a revisão maior; empate → vence o updatedAt mais recente".
 * Alterações locais ainda pendentes nunca são sobrescritas por versões remotas mais antigas.
 */
export async function runSync(db: ArgoDatabase, adapter: SyncAdapter): Promise<SyncOutcome> {
  if (!adapter.isConfigured()) return { status: 'not-configured' }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { status: 'offline' }

  let pushed = 0
  let failed = 0
  const queue = await db.outbox.orderBy('queuedAt').toArray()

  for (let i = 0; i < queue.length; i += BATCH) {
    const slice = queue.slice(i, i + BATCH)
    const items: PushItem[] = []
    for (const q of slice) {
      const record = await table(db, q.entity as EntityName).get(q.entityId)
      if (record) items.push({ entity: q.entity as EntityName, record })
    }
    const result = await adapter.push(items)
    await db.transaction('rw', [db.outbox, ...ENTITY_NAMES.map((e) => table(db, e))], async () => {
      for (const key of result.accepted) {
        const q = slice.find((s) => s.id === key)
        if (!q) continue
        const current = await table(db, q.entity as EntityName).get(q.entityId)
        // Só marca como sincronizado se não houve nova alteração durante o envio.
        if (current && current.rev === items.find((it) => it.record.id === q.entityId)?.record.rev) {
          await table(db, q.entity as EntityName).put({ ...current, syncStatus: 'synced' })
          await db.outbox.delete(key)
        }
        pushed++
      }
      for (const r of result.rejected) {
        const q = await db.outbox.get(r.key)
        if (q) await db.outbox.put({ ...q, attempts: q.attempts + 1, lastError: r.error })
        failed++
      }
    })
  }

  const cursor = (await getMeta<string>(db, 'syncCursor')) ?? null
  const remote = await adapter.pull(cursor)
  let pulled = 0
  await db.transaction('rw', [db.auditLog, db.meta, db.outbox, ...ENTITY_NAMES.map((e) => table(db, e))], async () => {
    for (const change of remote.changes) {
      const t = table(db, change.entity)
      const local = await t.get(change.record.id)
      if (local && !remoteWins(local, change.record)) continue
      const incoming = { ...change.record, syncStatus: 'synced' as const }
      await t.put(incoming)
      await db.outbox.delete(`${change.entity}:${incoming.id}`)
      await db.auditLog.add({
        id: newId(),
        entity: change.entity,
        entityId: incoming.id,
        action: 'remote',
        at: nowIso(),
        deviceId: incoming.deviceId,
        rev: incoming.rev,
        before: local ?? null,
        after: incoming,
      })
      pulled++
    }
    await setMeta(db, 'syncCursor', remote.cursor)
    await setMeta(db, 'lastSyncAt', nowIso())
  })

  return { status: 'done', pushed, failed, pulled }
}

export function remoteWins(local: AnyRecord, remote: AnyRecord): boolean {
  if (remote.rev !== local.rev) return remote.rev > local.rev
  return remote.updatedAt > local.updatedAt
}

function table(db: ArgoDatabase, entity: EntityName) {
  return entityTable(db, entity)
}
