import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../core/ids'
import { createDatabase, type ArgoDatabase } from '../db/database'
import { Repository } from '../db/repository'
import { runSync } from './engine'
import { localOnlyAdapter } from './localOnlyAdapter'
import type { PushItem, SyncAdapter } from './types'

let db: ArgoDatabase
afterEach(async () => db?.delete())

function fakeServer(): SyncAdapter & { store: Map<string, PushItem> } {
  const store = new Map<string, PushItem>()
  return {
    name: 'fake',
    store,
    isConfigured: () => true,
    async push(items) {
      for (const it of items) store.set(`${it.entity}:${it.record.id}`, structuredClone(it))
      return { accepted: items.map((i) => `${i.entity}:${i.record.id}`), rejected: [] }
    },
    async pull() {
      return { changes: [...store.values()], cursor: 'c1' }
    },
  }
}

describe('runSync', () => {
  it('sem servidor configurado não faz nada', async () => {
    db = createDatabase(`test-${newId()}`)
    expect(await runSync(db, localOnlyAdapter)).toEqual({ status: 'not-configured' })
  })

  it('envia pendências, marca como sincronizado e esvazia a fila', async () => {
    db = createDatabase(`test-${newId()}`)
    const repo = new Repository(db, 'diagnostics')
    const r = await repo.create({ note: 'a' })
    const server = fakeServer()
    const out = await runSync(db, server)
    expect(out).toMatchObject({ status: 'done', pushed: 1, failed: 0 })
    expect(await db.outbox.count()).toBe(0)
    expect((await repo.get(r.id))?.syncStatus).toBe('synced')
  })

  it('versão remota mais nova substitui a local; mais antiga é ignorada', async () => {
    db = createDatabase(`test-${newId()}`)
    const repo = new Repository(db, 'diagnostics')
    const r = await repo.create({ note: 'local' })
    const server = fakeServer()
    server.store.set(`diagnostics:${r.id}`, { entity: 'diagnostics', record: { ...r, note: 'remoto', rev: 5 } })
    server.push = async () => ({ accepted: [], rejected: [] })
    await runSync(db, server)
    expect((await repo.get(r.id))?.note).toBe('remoto')

    server.store.set(`diagnostics:${r.id}`, { entity: 'diagnostics', record: { ...r, note: 'velho', rev: 1 } })
    await runSync(db, server)
    expect((await repo.get(r.id))?.note).toBe('remoto')
  })
})
