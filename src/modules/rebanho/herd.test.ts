import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/ids'
import { createDatabase, type ArgoDatabase } from '../../db/database'
import { createFarm } from '../fazendas/farms'
import { addTask, archivePasture, createPasture, parseArea, updateTask } from '../pastos/pastures'
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
  const farm = await createFarm(db, { name: 'Fazenda Teste', responsible: '', city: '' }, '')
  const a = await createPasture(db, farm.id, { name: 'Pasto Grande', areaHa: 50, notes: '' })
  const b = await createPasture(db, farm.id, { name: 'Piquete 2', areaHa: null, notes: '' })
  const today = todayLocal()
  const balances = async () => computeBalances(await db.movements.toArray())
  return { farm, a, b, today, balances }
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

  it('garrote pode virar boi (sugestão) ou reprodutor; reprodutor é adulto', async () => {
    const { nextCategory, laterCategories } = await import('../../domain/categories')
    expect(nextCategory('garrote')).toBe('boi')
    expect(laterCategories('garrote').map((c) => c.id)).toEqual(['boi', 'reprodutor'])
    expect(nextCategory('reprodutor')).toBeNull()
    const { a, today, balances } = await setup()
    await recordMovement(db, { type: 'compra', date: today, notes: '', entries: entriesIn(a.id, { garrote: 3 }) })
    await recordMovement(db, {
      type: 'mudanca-categoria',
      date: today,
      notes: '',
      entries: entriesCategoryChange(a.id, a.id, [{ from: 'garrote', to: 'reprodutor', quantity: 1 }]),
    })
    expect(balanceOf(await balances(), a.id, 'reprodutor')).toBe(1)
  })

  it('perna quebrada tira machos e fêmeas do pasto; não aceita somar nem passar do saldo', async () => {
    const { a, today, balances } = await setup()
    await recordMovement(db, { type: 'compra', date: today, notes: '', entries: entriesIn(a.id, { boi: 5, vaca: 4 }) })
    await recordMovement(db, { type: 'perna-quebrada', date: today, notes: 'Abatido para consumo', entries: entriesOut(a.id, { boi: 1, vaca: 2 }) })
    const bal = await balances()
    expect(balanceOf(bal, a.id, 'boi')).toBe(4)
    expect(balanceOf(bal, a.id, 'vaca')).toBe(2)
    await expect(recordMovement(db, { type: 'perna-quebrada', date: today, notes: '', entries: entriesIn(a.id, { boi: 1 }) })).rejects.toThrow(HerdError)
    await expect(recordMovement(db, { type: 'perna-quebrada', date: today, notes: '', entries: entriesOut(a.id, { vaca: 3 }) })).rejects.toThrow(/Saldo insuficiente/)
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

  it('movimentação herda a fazenda e não mistura fazendas', async () => {
    const { farm, a, today } = await setup()
    const m = await recordMovement(db, { type: 'compra', date: today, notes: '', entries: entriesIn(a.id, { vaca: 1 }) })
    expect(m.farmId).toBe(farm.id)
    const other = await createFarm(db, { name: 'Outra', responsible: '', city: '' }, '')
    const x = await createPasture(db, other.id, { name: 'X', areaHa: null, notes: '' })
    await expect(
      recordMovement(db, { type: 'transferencia', date: today, notes: '', entries: entriesTransfer(a.id, x.id, { vaca: 1 }) }),
    ).rejects.toThrow(/fazendas diferentes/)
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
    const { farm } = await setup()
    await expect(createPasture(db, farm.id, { name: 'pasto grande', areaHa: null, notes: '' })).rejects.toThrow(/Já existe/)
    // O mesmo nome é permitido em outra fazenda.
    const other = await createFarm(db, { name: 'Fazenda do Irmão', responsible: '', city: '' }, '')
    await expect(createPasture(db, other.id, { name: 'Pasto Grande', areaHa: null, notes: '' })).resolves.toBeTruthy()
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

  it('serviço com observação: na hora de anotar ou depois, com histórico', async () => {
    const { a } = await setup()
    const t = await addTask(db, a.id, 'Arrumar cerca da divisa', undefined, 'Trocar 6 estacas perto da porteira')
    expect(t.notes).toBe('Trocar 6 estacas perto da porteira')
    const sem = await addTask(db, a.id, 'Limpar bebedouro')
    expect(sem.notes).toBe('')
    const u = await updateTask(db, t.id, 'Arrumar cerca da divisa', 'Trocar 6 estacas\nEsticar o arame de baixo')
    expect(u.notes).toBe('Trocar 6 estacas\nEsticar o arame de baixo')
    const hist = await db.auditLog.where('[entity+entityId]').equals(['pastureTasks', t.id]).toArray()
    expect(hist.map((h) => h.action).sort()).toEqual(['create', 'update'])
    await expect(updateTask(db, t.id, '  ', '')).rejects.toThrow(/Descreva/)
  })
})

