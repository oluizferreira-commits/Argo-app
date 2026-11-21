import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../core/ids'
import { createDatabase, type ArgoDatabase } from './database'
import { ConflictError, Repository } from './repository'

let db: ArgoDatabase
const open = () => {
  db = createDatabase(`test-${newId()}`)
  return new Repository(db, 'diagnostics')
}
afterEach(async () => db?.delete())

describe('Repository', () => {
  it('cria registro com campos de controle, histórico e fila de sincronização', async () => {
    const repo = open()
    const r = await repo.create({ note: 'teste' })
    expect(r).toMatchObject({ note: 'teste', rev: 1, deletedAt: null, syncStatus: 'pending' })
    expect(await repo.history(r.id)).toHaveLength(1)
    expect(await db.outbox.get(`diagnostics:${r.id}`)).toMatchObject({ rev: 1 })
  })

  it('não duplica quando o mesmo formulário é enviado duas vezes', async () => {
    const repo = open()
    const key = newId()
    const [a, b] = await Promise.all([repo.create({ note: 'x' }, key), repo.create({ note: 'x' }, key)])
    expect(a.id).toBe(b.id)
    expect(await db.diagnostics.count()).toBe(1)
    expect(await repo.history(key)).toHaveLength(1)
  })

  it('alteração incrementa revisão, guarda antes/depois e não altera campos de controle', async () => {
    const repo = open()
    const r = await repo.create({ note: 'a' })
    const u = await repo.update(r.id, { note: 'b', id: 'hack', rev: 99 } as never)
    expect(u).toMatchObject({ id: r.id, note: 'b', rev: 2 })
    const h = await repo.history(r.id)
    expect(h.map((e) => e.action)).toEqual(['create', 'update'])
    expect(h[1].before).toMatchObject({ note: 'a' })
    expect(await db.outbox.count()).toBe(1)
  })

  it('recusa alteração com revisão desatualizada', async () => {
    const repo = open()
    const r = await repo.create({ note: 'a' })
    await repo.update(r.id, { note: 'b' })
    await expect(repo.update(r.id, { note: 'c' }, 1)).rejects.toBeInstanceOf(ConflictError)
  })

  it('exclusão é lógica e reversível', async () => {
    const repo = open()
    const r = await repo.create({ note: 'a' })
    await repo.softDelete(r.id)
    expect(await repo.listActive()).toHaveLength(0)
    expect(await db.diagnostics.count()).toBe(1)
    await repo.restore(r.id)
    expect(await repo.listActive()).toHaveLength(1)
    expect((await repo.history(r.id)).map((e) => e.action)).toEqual(['create', 'delete', 'restore'])
  })

  it('dados persistem após fechar e reabrir o banco', async () => {
    const name = `test-${newId()}`
    const first = createDatabase(name)
    const r = await new Repository(first, 'diagnostics').create({ note: 'persistente' })
    first.close()
    db = createDatabase(name)
    expect(await db.diagnostics.get(r.id)).toMatchObject({ note: 'persistente' })
  })
})

describe('migração de esquema', () => {
  it('banco v1 existente é atualizado para a versão atual preservando os dados', async () => {
    const { default: Dexie } = await import('dexie')
    const name = `test-${newId()}`
    const v1 = new Dexie(name)
    v1.version(1).stores({ meta: 'key', auditLog: 'id, [entity+entityId], at', outbox: 'id, queuedAt', diagnostics: 'id, createdAt, updatedAt' })
    await v1.table('diagnostics').add({ id: 'antigo', note: 'registro da v1', createdAt: 'x', updatedAt: 'x', deletedAt: null, rev: 1, deviceId: 'd', syncStatus: 'pending' })
    v1.close()
    db = createDatabase(name)
    await db.open()
    expect(db.verno).toBe(12)
    expect(await db.diagnostics.get('antigo')).toMatchObject({ note: 'registro da v1' })
    expect(await db.pastures.count()).toBe(0)
  })
})
