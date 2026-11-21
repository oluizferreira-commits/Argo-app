import { describe, expect, it } from 'vitest'
import type { Pasture } from '../../db/types'
import { buildPastureRows, filterPastures, summarizePastures } from './pastureList'

const p = (id: string, name: string, areaHa: number | null): Pasture =>
  ({ id, name, areaHa, notes: '', farmId: 'f', createdAt: '', updatedAt: '', deletedAt: null, rev: 1, deviceId: 'd', syncStatus: 'pending' }) as Pasture

const pastures = [p('a', 'Pasto Água Boa', 12.5), p('b', 'Pasto do Fundo com um nome bem comprido perto do córrego', 30), p('c', 'Piquete', null), p('d', 'Reserva', 8)]
const balances = new Map<string, number>([
  ['a|boi', 10],
  ['b|femea-a-especificar', 20],
  ['b|bezerro-a-especificar', 3],
  ['d|vaca', 0],
])
const tasks = new Map([['c', 2]])

describe('listagem de pastos', () => {
  const rows = buildPastureRows(pastures, balances, tasks)

  it('animais, especificação e serviços por pasto', () => {
    expect(rows.map((r) => r.animals)).toEqual([10, 23, 0, 0])
    expect(rows[1].specText).toBe('20 fêmeas sem categoria, 3 bezerros sem sexo')
    expect(rows[0].specText).toBe('')
    expect(rows.map((r) => r.hasPending)).toEqual([false, true, true, false])
  })

  it('resumo com dados reais (área não informada fica fora da soma)', () => {
    expect(summarizePastures(rows)).toEqual({ total: 4, hectares: 50.5, withoutArea: 1, occupied: 2, empty: 2 })
  })

  it('filtros e pesquisa sem acento', () => {
    const ids = (q: string, f: Parameters<typeof filterPastures>[2]) => filterPastures(rows, q, f).map((r) => r.pasture.id)
    expect(ids('', 'todos')).toEqual(['a', 'b', 'c', 'd'])
    expect(ids('', 'com-animais')).toEqual(['a', 'b'])
    expect(ids('', 'vazios')).toEqual(['c', 'd'])
    expect(ids('', 'pendencias')).toEqual(['b', 'c'])
    expect(ids('agua', 'todos')).toEqual(['a'])
    expect(ids('PASTO', 'pendencias')).toEqual(['b'])
    expect(ids('xyz', 'todos')).toEqual([])
  })
})
