import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/ids'
import { createDatabase, type ArgoDatabase } from '../../db/database'
import { createFarm, getCurrentFarmId, setCurrentFarm, setFarmPin, verifyPin } from './farms'

let db: ArgoDatabase
afterEach(async () => db?.delete())

describe('fazendas', () => {
  it('cadastra com nome único e PIN opcional guardado só como hash', async () => {
    db = createDatabase(`test-${newId()}`)
    const f = await createFarm(db, { name: 'Fazenda Boa Vista', responsible: 'Luiz', city: '' }, '1234')
    expect(f.pinHash).toMatch(/^[0-9a-f]{64}$/)
    // Nenhum campo guarda o PIN em texto (o hash é aleatório e pode conter "1234" por acaso).
    expect(Object.values(f)).not.toContain('1234')
    expect(f.pinHash).not.toBe('1234')
    expect(await verifyPin(f, '1234')).toBe(true)
    expect(await verifyPin(f, '0000')).toBe(false)
    await expect(createFarm(db, { name: 'fazenda boa vista', responsible: '', city: '' }, '')).rejects.toThrow(/Já existe/)
    await expect(createFarm(db, { name: 'Outra', responsible: '', city: '' }, '12')).rejects.toThrow(/4 a 6/)
    const semPin = await setFarmPin(db, f.id, '')
    expect(await verifyPin(semPin, 'qualquer')).toBe(true)
  })

  it('fazenda atual fica salva no aparelho', async () => {
    db = createDatabase(`test-${newId()}`)
    const f = await createFarm(db, { name: 'A', responsible: '', city: '' }, '')
    expect(await getCurrentFarmId(db)).toBeNull()
    await setCurrentFarm(db, f.id)
    expect(await getCurrentFarmId(db)).toBe(f.id)
  })

  it('primeira fazenda adota pastos e movimentações lançados antes (sem farmId)', async () => {
    db = createDatabase(`test-${newId()}`)
    await db.open()
    const base = { createdAt: 'x', updatedAt: 'x', deletedAt: null, rev: 1, deviceId: 'd', syncStatus: 'pending' as const }
    await db.pastures.add({ ...base, id: 'p1', name: 'Antigo', areaHa: null, notes: '' } as never)
    await db.movements.add({ ...base, id: 'm1', type: 'compra', date: '2026-01-01', entries: [], pastureIds: ['p1'], notes: '', reversalOf: null, reversedBy: null } as never)
    const f = await createFarm(db, { name: 'Primeira', responsible: '', city: '' }, '')
    expect((await db.pastures.get('p1'))?.farmId).toBe(f.id)
    expect((await db.movements.get('m1'))?.farmId).toBe(f.id)
    const second = await createFarm(db, { name: 'Segunda', responsible: '', city: '' }, '')
    expect((await db.pastures.get('p1'))?.farmId).toBe(f.id)
    expect(second.id).not.toBe(f.id)
  })
})
