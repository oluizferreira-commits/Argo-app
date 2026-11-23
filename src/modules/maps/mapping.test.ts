import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/ids'
import { createDatabase, type ArgoDatabase } from '../../db/database'
import { createBackup, importBackup } from '../../backup/backup'
import { createFarm } from '../fazendas/farms'
import { createPasture } from '../pastos/pastures'
import { entriesIn, recordMovement, todayLocal } from '../rebanho/herd'
import type { Ring } from './geo'
import { confirmMapping, loadMapData, removeShape, reviewMapping, saveShape, saveView, applyMapArea } from './mapping'

let db: ArgoDatabase
afterEach(async () => db?.delete())

const LAT = -10
const LNG = -48
const D = 0.01
const rect = (x0: number, y0: number, x1: number, y1: number): Ring => [
  [LNG + x0 * D, LAT + y0 * D],
  [LNG + x1 * D, LAT + y0 * D],
  [LNG + x1 * D, LAT + y1 * D],
  [LNG + x0 * D, LAT + y1 * D],
]

async function setup() {
  db = createDatabase(`test-${newId()}`)
  const farm = await createFarm(db, { name: 'Fazenda', responsible: '', city: '' }, '')
  const a = await createPasture(db, farm.id, { name: 'Pasto A', areaHa: 120, notes: '' })
  const b = await createPasture(db, farm.id, { name: 'Pasto B', areaHa: null, notes: '' })
  return { farm, a, b }
}

describe('ARGO Maps — gravação', () => {
  it('perímetro + dois pastos vizinhos + área não produtiva; revisão e confirmação de versão', async () => {
    const { farm, a, b } = await setup()
    await saveView(db, farm.id, { lat: LAT, lng: LNG }, 15)
    await saveShape(db, farm.id, { kind: 'perimetro', pastureId: null, name: '', ring: rect(0, 0, 3, 1) })
    await saveShape(db, farm.id, { kind: 'pasto', pastureId: a.id, name: '', ring: rect(0, 0, 1, 1) })
    await saveShape(db, farm.id, { kind: 'pasto', pastureId: b.id, name: '', ring: rect(1, 0, 2, 1) }) // divide a cerca com A
    await saveShape(db, farm.id, { kind: 'nao-produtiva', pastureId: null, name: 'Reserva legal', ring: rect(2, 0, 2.5, 1) })

    const data = await loadMapData(db, farm.id)
    expect(data.shapes).toHaveLength(4)
    expect(data.farmMap?.status).toBe('rascunho')
    expect(data.farmMap?.zoom).toBe(15)
    const per = data.shapes.find((s) => s.kind === 'perimetro')!
    expect(per.areaCentiHa).toBeGreaterThan(36000) // ~366 ha
    expect(per.geometry.coordinates[0][0]).toEqual(per.geometry.coordinates[0].at(-1))

    const pastures = await db.pastures.toArray()
    const r = reviewMapping(data.shapes, pastures)
    expect(r.pastures).toHaveLength(2)
    expect(r.unassignedCentiHa).toBeGreaterThan(5500) // meio quadrado sem pasto (~61 ha)
    expect(r.unassignedCentiHa).toBeLessThan(6300)
    expect(r.notDrawn).toHaveLength(0)
    expect(r.canConfirm).toBe(true)
    expect(r.warnings).toEqual([]) // Pasto A: 120 ha cadastrados ≈ 121,8 ha no mapa (dentro de 10%)

    const v = await confirmMapping(db, farm.id, pastures)
    expect(v.version).toBe(1)
    expect(v.shapes).toHaveLength(4)
    let after = await loadMapData(db, farm.id)
    expect(after.farmMap).toMatchObject({ status: 'confirmado', version: 1 })

    // qualquer edição volta para rascunho; a versão confirmada continua guardada
    const sa = after.shapes.find((s) => s.pastureId === a.id)!
    const edited = await saveShape(db, farm.id, { id: sa.id, kind: 'pasto', pastureId: a.id, name: '', ring: rect(0, 0, 1, 0.9), expectedRev: sa.rev })
    expect(edited.geometryVersion).toBe(2)
    after = await loadMapData(db, farm.id)
    expect(after.farmMap?.status).toBe('rascunho')
    expect(after.versions).toHaveLength(1)
    expect(after.versions[0].shapes.find((s) => s.pastureId === a.id)!.areaCentiHa).toBe(sa.areaCentiHa)

    // histórico (auditoria) do desenho
    const hist = await db.auditLog.where('[entity+entityId]').equals(['mapShapes', sa.id]).toArray()
    expect(hist.length).toBeGreaterThanOrEqual(2)
  })

  it('recusa: contorno em 8, sobreposição, pasto desenhado duas vezes, dois perímetros, edição em conflito', async () => {
    const { farm, a, b } = await setup()
    await expect(
      saveShape(db, farm.id, {
        kind: 'pasto',
        pastureId: a.id,
        name: '',
        ring: [
          [LNG, LAT],
          [LNG + D, LAT + D],
          [LNG + D, LAT],
          [LNG, LAT + D],
        ],
      }),
    ).rejects.toThrow('cruzando')
    const sa = await saveShape(db, farm.id, { kind: 'pasto', pastureId: a.id, name: '', ring: rect(0, 0, 1, 1) })
    await expect(saveShape(db, farm.id, { kind: 'pasto', pastureId: b.id, name: '', ring: rect(0.5, 0, 1.5, 1) })).rejects.toThrow('por cima de "Pasto A"')
    await expect(saveShape(db, farm.id, { kind: 'pasto', pastureId: a.id, name: '', ring: rect(5, 5, 6, 6) })).rejects.toThrow('já está desenhado')
    await saveShape(db, farm.id, { kind: 'perimetro', pastureId: null, name: '', ring: rect(0, 0, 3, 3) })
    await expect(saveShape(db, farm.id, { kind: 'perimetro', pastureId: null, name: '', ring: rect(0, 0, 4, 4) })).rejects.toThrow('já tem perímetro')
    await expect(saveShape(db, farm.id, { kind: 'nao-produtiva', pastureId: null, name: '', ring: rect(2, 2, 3, 3) })).rejects.toThrow('nome')
    // conflito: a tela tinha a revisão 1, mas o desenho já está na 2
    await saveShape(db, farm.id, { id: sa.id, kind: 'pasto', pastureId: a.id, name: '', ring: rect(0, 0, 1, 0.8), expectedRev: sa.rev })
    await expect(saveShape(db, farm.id, { id: sa.id, kind: 'pasto', pastureId: a.id, name: '', ring: rect(0, 0, 1, 0.7), expectedRev: sa.rev })).rejects.toThrow('outra tela')
  })

  it('alertas da revisão: fora do perímetro, área diferente do cadastro, pastos sem desenho; sem perímetro não confirma', async () => {
    const { farm, a } = await setup()
    await saveShape(db, farm.id, { kind: 'pasto', pastureId: a.id, name: '', ring: rect(0, 0, 2, 1) }) // ~243 ha vs 120 ha cadastrados
    const pastures = await db.pastures.toArray()
    let r = reviewMapping((await loadMapData(db, farm.id)).shapes, pastures)
    expect(r.canConfirm).toBe(false)
    expect(r.warnings[0]).toContain('perímetro')
    expect(r.warnings.some((w) => w.includes('"Pasto A": área do cadastro 120,00 ha'))).toBe(true)
    expect(r.notDrawn.map((p) => p.name)).toEqual(['Pasto B'])
    await expect(confirmMapping(db, farm.id, pastures)).rejects.toThrow('perímetro')
    await saveShape(db, farm.id, { kind: 'perimetro', pastureId: null, name: '', ring: rect(0, 0, 1.5, 1) })
    r = reviewMapping((await loadMapData(db, farm.id)).shapes, pastures)
    expect(r.warnings.some((w) => w.includes('fora do perímetro'))).toBe(true)
  })

  it('remover desenho não mexe no pasto nem nos animais; "usar área do mapa" só quando pedido', async () => {
    const { farm, a } = await setup()
    await recordMovement(db, { type: 'compra', date: todayLocal(), notes: '', entries: entriesIn(a.id, { boi: 7 }) })
    const s = await saveShape(db, farm.id, { kind: 'pasto', pastureId: a.id, name: '', ring: rect(0, 0, 1, 1) })
    expect((await db.pastures.get(a.id))!.areaHa).toBe(120) // nada muda sozinho
    await applyMapArea(db, a.id, s.areaCentiHa)
    expect((await db.pastures.get(a.id))!.areaHa).toBe(s.areaCentiHa / 100)
    await removeShape(db, s.id)
    expect((await loadMapData(db, farm.id)).shapes).toHaveLength(0)
    expect((await db.mapShapes.get(s.id))!.deletedAt).not.toBeNull() // exclusão lógica
    expect((await db.pastures.get(a.id))!.deletedAt).toBeNull()
    expect((await db.movements.toArray()).length).toBe(1)
  })

  it('backup leva e traz o mapeamento', async () => {
    const { farm, a } = await setup()
    await saveShape(db, farm.id, { kind: 'pasto', pastureId: a.id, name: '', ring: rect(0, 0, 1, 1) })
    await confirmMapping(db, farm.id, await db.pastures.toArray()).catch(() => null)
    const file = await createBackup(db, 'teste')
    const other = createDatabase(`test-${newId()}`)
    try {
      await importBackup(other, file)
      expect(await other.mapShapes.count()).toBe(1)
      expect(await other.farmMaps.count()).toBe(1)
    } finally {
      await other.delete()
    }
  })
})
