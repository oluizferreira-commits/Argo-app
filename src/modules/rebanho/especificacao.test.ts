import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/ids'
import { createDatabase, type ArgoDatabase } from '../../db/database'
import { CATEGORY_GROUPS, laterCategories, nextCategory } from '../../domain/categories'
import { createFarm } from '../fazendas/farms'
import { createPasture } from '../pastos/pastures'
import {
  balanceOf,
  computeBalances,
  entriesCategoryChange,
  entriesCount,
  entriesIn,
  entriesSpecify,
  HerdError,
  pendingSpecification,
  recordMovement,
  reverseMovement,
  todayLocal,
} from './herd'

let db: ArgoDatabase
afterEach(async () => db?.delete())

async function setup() {
  db = createDatabase(`test-${newId()}`)
  const farm = await createFarm(db, { name: 'Fazenda Teste', responsible: '', city: '' }, '')
  const p = await createPasture(db, farm.id, { name: 'Pasto Teste', areaHa: null, notes: '' })
  const bal = async () => computeBalances(await db.movements.toArray())
  // contagem feita só com o total de fêmeas
  await recordMovement(db, {
    type: 'contagem',
    date: todayLocal(),
    notes: 'contei só as fêmeas',
    entries: entriesCount(p.id, { 'femea-a-especificar': 140 }, await bal(), { 'femea-a-especificar': 'saldo-inicial' }),
  })
  return { p, bal }
}

describe('fêmeas/machos a especificar', () => {
  it('contagem registra 140 fêmeas a especificar e gera pendência', async () => {
    const { p, bal } = await setup()
    const b = await bal()
    expect(balanceOf(b, p.id, 'femea-a-especificar')).toBe(140)
    expect(pendingSpecification(b, [p.id])).toEqual([{ pastureId: p.id, females: 140, males: 0, calves: 0 }])
  })

  it('especificar 40 novilhas + 100 vacas zera a pendência e mantém o total', async () => {
    const { p, bal } = await setup()
    const { entries, difference } = entriesSpecify(p.id, 'F', { novilha: 40, vaca: 100 }, await bal())
    expect(difference).toBe(0)
    const m = await recordMovement(db, { type: 'especificacao', date: todayLocal(), notes: '', entries })
    expect(m.difference).toBe(0)
    const b = await bal()
    expect(balanceOf(b, p.id, 'femea-a-especificar')).toBe(0)
    expect(balanceOf(b, p.id, 'novilha')).toBe(40)
    expect(balanceOf(b, p.id, 'vaca')).toBe(100)
    expect(pendingSpecification(b, [p.id])).toEqual([])
  })

  it('total diferente exige motivo e registra a diferença', async () => {
    const { p, bal } = await setup()
    const { entries, difference } = entriesSpecify(p.id, 'F', { novilha: 45, vaca: 100 }, await bal())
    expect(difference).toBe(5)
    await expect(recordMovement(db, { type: 'especificacao', date: todayLocal(), notes: '', entries })).rejects.toThrow(/motivo da diferença/)
    await expect(
      recordMovement(db, { type: 'especificacao', date: todayLocal(), notes: '', entries, differenceReason: 'morte-nao-registrada' }),
    ).rejects.toThrow(/diminuiu/)
    const m = await recordMovement(db, { type: 'especificacao', date: todayLocal(), notes: '', entries, differenceReason: 'erro-contagem' })
    expect(m).toMatchObject({ difference: 5, differenceReason: 'erro-contagem' })
    const b = await bal()
    expect(balanceOf(b, p.id, 'novilha') + balanceOf(b, p.id, 'vaca')).toBe(145)
  })

  it('categoria em branco não muda (bezerras já lançadas continuam)', async () => {
    const { p, bal } = await setup()
    await recordMovement(db, { type: 'nascimento', date: todayLocal(), notes: '', entries: entriesIn(p.id, { bezerra: 12 }) })
    const { entries } = entriesSpecify(p.id, 'F', { novilha: 40, vaca: 100 }, await bal())
    await recordMovement(db, { type: 'especificacao', date: todayLocal(), notes: '', entries })
    expect(balanceOf(await bal(), p.id, 'bezerra')).toBe(12)
  })

  it('a especificar não muda de categoria pela "mudança de categoria"', async () => {
    const { p } = await setup()
    expect(laterCategories('femea-a-especificar')).toEqual([])
    expect(nextCategory('femea-a-especificar')).toBeNull()
    expect(laterCategories('garrote').map((c) => c.id)).not.toContain('macho-a-especificar')
    await expect(
      recordMovement(db, {
        type: 'mudanca-categoria',
        date: todayLocal(),
        notes: '',
        entries: entriesCategoryChange(p.id, p.id, [{ from: 'femea-a-especificar', to: 'vaca', quantity: 1 }]),
      }),
    ).rejects.toBeInstanceOf(HerdError)
  })

  it('não mistura sexos e exige pendência', async () => {
    const { p } = await setup()
    await expect(
      recordMovement(db, {
        type: 'especificacao',
        date: todayLocal(),
        notes: '',
        entries: [
          { pastureId: p.id, category: 'femea-a-especificar', delta: -140, reason: 'especificacao' },
          { pastureId: p.id, category: 'boi', delta: 140, reason: 'especificacao' },
        ],
      }),
    ).rejects.toThrow(/separadamente/)
    await expect(
      recordMovement(db, {
        type: 'especificacao',
        date: todayLocal(),
        notes: '',
        entries: [{ pastureId: p.id, category: 'vaca', delta: 10, reason: 'especificacao' }],
      }),
    ).rejects.toThrow(/Não há gado a especificar/)
  })

  it('estorno da especificação devolve as 140 a especificar', async () => {
    const { p, bal } = await setup()
    const { entries } = entriesSpecify(p.id, 'F', { novilha: 40, vaca: 100 }, await bal())
    const m = await recordMovement(db, { type: 'especificacao', date: todayLocal(), notes: '', entries })
    await reverseMovement(db, m.id, 'errei')
    const b = await bal()
    expect(balanceOf(b, p.id, 'femea-a-especificar')).toBe(140)
    expect(balanceOf(b, p.id, 'vaca')).toBe(0)
  })

  it('grupos: Machos, Fêmeas e A especificar (fêmeas, machos e bezerros)', () => {
    expect(CATEGORY_GROUPS.map((g) => g.title)).toEqual(['Machos', 'Fêmeas', 'A especificar'])
    expect(CATEGORY_GROUPS[2].list.map((c) => c.id)).toEqual(['macho-a-especificar', 'femea-a-especificar', 'bezerro-a-especificar'])
    expect(CATEGORY_GROUPS[0].list.some((c) => c.unspecified)).toBe(false)
  })
})

describe('bezerros a especificar (sem separar macho e fêmea)', () => {
  async function withCalves() {
    const ctx = await setup()
    await recordMovement(db, {
      type: 'contagem',
      date: todayLocal(),
      notes: '',
      entries: entriesCount(ctx.p.id, { 'bezerro-a-especificar': 30 }, await ctx.bal(), { 'bezerro-a-especificar': 'nascimento-nao-registrado' }),
    })
    return ctx
  }

  it('contagem de 30 bezerros a especificar gera pendência', async () => {
    const { p, bal } = await withCalves()
    expect(pendingSpecification(await bal(), [p.id])).toEqual([{ pastureId: p.id, females: 140, males: 0, calves: 30 }])
  })

  it('especificar em 12 bezerros + 18 bezerras', async () => {
    const { p, bal } = await withCalves()
    const { entries, difference } = entriesSpecify(p.id, 'B', { bezerro: 12, bezerra: 18 }, await bal())
    expect(difference).toBe(0)
    await recordMovement(db, { type: 'especificacao', date: todayLocal(), notes: '', entries })
    const b = await bal()
    expect([balanceOf(b, p.id, 'bezerro'), balanceOf(b, p.id, 'bezerra'), balanceOf(b, p.id, 'bezerro-a-especificar')]).toEqual([12, 18, 0])
    // as fêmeas a especificar continuam pendentes (são outra coisa)
    expect(pendingSpecification(b, [p.id])).toEqual([{ pastureId: p.id, females: 140, males: 0, calves: 0 }])
  })

  it('bezerros só viram bezerro ou bezerra', async () => {
    const { p } = await withCalves()
    await expect(
      recordMovement(db, {
        type: 'especificacao',
        date: todayLocal(),
        notes: '',
        entries: [
          { pastureId: p.id, category: 'bezerro-a-especificar', delta: -30, reason: 'especificacao' },
          { pastureId: p.id, category: 'desmama-macho', delta: 30, reason: 'especificacao' },
        ],
      }),
    ).rejects.toThrow(/bezerros e bezerras/)
  })

  it('diferença no total com motivo "nascimentos não registrados"', async () => {
    const { p, bal } = await withCalves()
    const { entries, difference } = entriesSpecify(p.id, 'B', { bezerro: 15, bezerra: 18 }, await bal())
    expect(difference).toBe(3)
    const m = await recordMovement(db, { type: 'especificacao', date: todayLocal(), notes: '', entries, differenceReason: 'nascimento-nao-registrado' })
    expect(m.difference).toBe(3)
  })

  it('não muda de categoria pela "mudança de categoria"', async () => {
    expect(laterCategories('bezerro-a-especificar')).toEqual([])
  })
})

