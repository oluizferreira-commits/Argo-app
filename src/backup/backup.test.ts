import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../core/ids'
import { createDatabase, type ArgoDatabase } from '../db/database'
import { Repository } from '../db/repository'
import { BackupError, createBackup, importBackup, parseBackup } from './backup'

const dbs: ArgoDatabase[] = []
const fresh = () => {
  const d = createDatabase(`test-${newId()}`)
  dbs.push(d)
  return d
}
afterEach(async () => {
  await Promise.all(dbs.map((d) => d.delete()))
  dbs.length = 0
})

describe('backup', () => {
  it('restaura em banco vazio e importar de novo não duplica', async () => {
    const src = fresh()
    const repo = new Repository(src, 'diagnostics')
    await repo.create({ note: 'a' })
    const b = await repo.create({ note: 'b' })
    await repo.softDelete(b.id)
    const text = JSON.stringify(await createBackup(src, 'test'))

    const dst = fresh()
    const s1 = await importBackup(dst, await parseBackup(text, dst))
    expect(s1).toMatchObject({ added: 2, updated: 0, skipped: 0, auditAdded: 3 })
    const s2 = await importBackup(dst, await parseBackup(text, dst))
    expect(s2).toMatchObject({ added: 0, updated: 0, skipped: 2, auditAdded: 0 })
    expect(await dst.diagnostics.count()).toBe(2)
    expect((await dst.diagnostics.get(b.id))?.deletedAt).not.toBeNull()
  })

  it('não sobrescreve dado local mais novo com backup antigo', async () => {
    const d = fresh()
    const repo = new Repository(d, 'diagnostics')
    const r = await repo.create({ note: 'v1' })
    const text = JSON.stringify(await createBackup(d, 'test'))
    await repo.update(r.id, { note: 'v2' })
    await importBackup(d, await parseBackup(text, d))
    expect((await repo.get(r.id))?.note).toBe('v2')
  })

  it('rejeita arquivo inválido ou adulterado', async () => {
    const d = fresh()
    await new Repository(d, 'diagnostics').create({ note: 'a' })
    await expect(parseBackup('nada', d)).rejects.toBeInstanceOf(BackupError)
    await expect(parseBackup('{"format":"outro"}', d)).rejects.toBeInstanceOf(BackupError)
    const b = await createBackup(d, 'test')
    b.data.entities.diagnostics![0] = { ...b.data.entities.diagnostics![0], note: 'adulterado' }
    await expect(parseBackup(JSON.stringify(b), d)).rejects.toThrow(/integridade/)
  })
})
