import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/ids'
import { createDatabase, type ArgoDatabase } from '../../db/database'
import { archivePasture, createPasture, parseArea } from '../pastos/pastures'
import {
  balanceOf,
  computeBalances,
  entriesCategoryChange,
  entriesCount,
  entriesIn,
  entriesOut,
  entriesTransfer,
  HerdError,
  recordMovement,
  reverseMovement,
  todayLocal,
} from './herd'

let db: ArgoDatabase
afterEach(async () => db?.delete())

async function setup() {
  db = createDatabase(`test-${newId()}`)
  const a = await createPasture(db, { name: 'Pasto Grande', areaHa: 50, notes: '' })
  const b = await createPasture(db, { name: 'Piquete 2', areaHa: null, notes: '' })
  const today = todayLocal()
  const balances = async () => computeBalances(await db.movements.toArray())
  return { a, b, today, balances }
}

describe('rebanho por contagem', () => {
  it('contagem inicial lança o saldo de abertura', async () => {
    const { a, today, balances } = await setup()
    const bal = await balances()
    await recordMovement(db, {
      type: 'contagem',
      date: today,
      notes: '',
      entries: entriesCount(a.id, { vaca: 120, bezerro: 40 }, bal, { vaca: 'saldo-inicial', bezerro: 'saldo-inicial' }),
    })
    const after = await balances()
    expect(balanceOf(after, a.id, 'vaca')).toBe(120)
    expect(balanceOf(after, a.id, 'bezerro')).toBe(40)
  })

  it('20 bezerros viram desmama macho em um único lançamento', async () => {
    const { a, b, today, balances } = await setup()
    await recordMovement(db, { type: 'nascimento', date: today, notes: '', entries: entriesIn(a.id, { bezerro: 40 }) })
    await recordMovement(db, {
      type: 'mudanca-categoria',
      date: today,
      notes: '',
      entries: entriesCategoryChange(a.id, b.id, [{ from: 'bezerro', to: 'desmama-macho', quantity: 20 }]),
    })
    const bal = await balances()
    expect(balanceOf(bal, a.id, 'bezerro')).toBe(20)
    expect(balanceOf(bal, b.id, 'desmama-macho')).toBe(20)
  })

  it('não permite mudar para categoria de outro sexo ou anterior', async () => {
    const { a, today } = await setup()
    await recordMovement(db, { type: 'nascimento', date: today, notes: '', entries: entriesIn(a.id, { bezerro: 5 }) })
    const bad = (to: 'novilha' | 'bezerro') =>
      recordMovement(db, {
        type: 'mudanca-categoria',
        date: today,
        notes: '',
        entries: entriesCategoryChange(a.id, a.id, [{ from: 'bezerro', to, quantity: 1 }]),
      })
    await expect(bad('novilha')).rejects.toBeInstanceOf(HerdError)
    await expect(bad('bezerro')).rejects.toBeInstanceOf(HerdError)
  })

  it('recusa tirar mais animais do que o pasto tem', async () => {
    const { a, b, today } = await setup()
    await recordMovement(db, { type: 'compra', date: today, notes: '', entries: entriesIn(a.id, { vaca: 30 }) })
    await expect(
      recordMovement(db, { type: 'transferencia', date: today, notes: '', entries: entriesTransfer(a.id, b.id, { vaca: 50 }) }),
    ).rejects.toThrow(/Saldo insuficiente: Pasto Grande tem 30 vacas/)
    await expect(
      recordMovement(db, { type: 'venda', date: today, notes: '', entries: entriesOut(a.id, { boi: 1 }) }),
    ).rejects.toBeInstanceOf(HerdError)
  })

  it('nascimento só aceita bezerros/bezerras e data não pode ser futura', async () => {
    const { a, today } = await setup()
    await expect(
      recordMovement(db, { type: 'nascimento', date: today, notes: '', entries: entriesIn(a.id, { vaca: 1 }) }),
    ).rejects.toBeInstanceOf(HerdError)
    await expect(
      recordMovement(db, { type: 'nascimento', date: '2999-01-01', notes: '', entries: entriesIn(a.id, { bezerra: 1 }) }),
    ).rejects.toThrow(/futuro/)
  })

  it('conferência registra a diferença com o motivo', async () => {
    const { a, today, balances } = await setup()
    await recordMovement(db, { type: 'nascimento', date: today, notes: '', entries: entriesIn(a.id, { bezerro: 40 }) })
    const entries = entriesCount(a.id, { bezerro: 52 }, await balances(), { bezerro: 'nascimento-nao-registrado' })
    expect(entries).toEqual([{ pastureId: a.id, category: 'bezerro', delta: 12, reason: 'nascimento-nao-registrado' }])
    await recordMovement(db, { type: 'contagem', date: today, notes: '', entries })
    expect(balanceOf(await balances(), a.id, 'bezerro')).toBe(52)
  })

  it('lançamento repetido (toque duplo) não duplica', async () => {
    const { a, today, balances } = await setup()
    const key = newId()
    const input = { type: 'nascimento' as const, date: today, notes: '', entries: entriesIn(a.id, { bezerra: 3 }) }
    await Promise.all([recordMovement(db, input, key), recordMovement(db, input, key)])
    expect(await db.movements.count()).toBe(1)
    expect(balanceOf(await balances(), a.id, 'bezerra')).toBe(3)
  })

  it('estorno desfaz sem apagar e não pode ser repetido', async () => {
    const { a, today, balances } = await setup()
    const m = await recordMovement(db, { type: 'compra', date: today, notes: '', entries: entriesIn(a.id, { boi: 10 }) })
    await reverseMovement(db, m.id, 'lançado errado')
    expect(balanceOf(await balances(), a.id, 'boi')).toBe(0)
    expect(await db.movements.count()).toBe(2)
    expect((await db.movements.get(m.id))?.reversedBy).toBeTruthy()
    await expect(reverseMovement(db, m.id, '')).rejects.toThrow(/já foi estornada/)
  })

  it('estorno recusado se os animais já foram movimentados', async () => {
    const { a, b, today } = await setup()
    const m = await recordMovement(db, { type: 'compra', date: today, notes: '', entries: entriesIn(a.id, { boi: 10 }) })
    await recordMovement(db, { type: 'transferencia', date: today, notes: '', entries: entriesTransfer(a.id, b.id, { boi: 10 }) })
    await expect(reverseMovement(db, m.id, '')).rejects.toThrow(/Não é possível estornar/)
  })

  it('cada movimentação fica no histórico (auditoria)', async () => {
    const { a, today } = await setup()
    const m = await recordMovement(db, { type: 'compra', date: today, notes: 'feira', entries: entriesIn(a.id, { vaca: 2 }) })
    const h = await db.auditLog.where('[entity+entityId]').equals(['movements', m.id]).toArray()
    expect(h).toHaveLength(1)
    expect(h[0].action).toBe('create')
  })
})

describe('pastos', () => {
  it('nome único (sem diferenciar maiúsculas) e área em formato brasileiro', async () => {
    await setup()
    await expect(createPasture(db, { name: 'pasto grande', areaHa: null, notes: '' })).rejects.toThrow(/Já existe/)
    expect(parseArea('12,5')).toBe(12.5)
    expect(parseArea('1.234,5')).toBe(1234.5)
    expect(parseArea('12.5')).toBe(12.5)
    expect(parseArea('')).toBeNull()
    expect(() => parseArea('abc')).toThrow()
  })

  it('só arquiva pasto vazio', async () => {
    const { a, today } = await setup()
    await recordMovement(db, { type: 'compra', date: today, notes: '', entries: entriesIn(a.id, { vaca: 1 }) })
    await expect(archivePasture(db, a.id)).rejects.toThrow(/ainda tem 1/)
    await recordMovement(db, { type: 'venda', date: today, notes: '', entries: entriesOut(a.id, { vaca: 1 }) })
    await archivePasture(db, a.id)
    expect((await db.pastures.get(a.id))?.deletedAt).not.toBeNull()
  })
})
