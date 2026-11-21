/**
 * Listagem da aba Pastos: linhas, resumo, pesquisa e filtros. Só lê os saldos e serviços já calculados
 * (não muda nenhuma regra de contagem).
 */
import type { Pasture } from '../../db/types'
import { balanceOf, pastureTotal } from '../rebanho/herd'

export interface PastureRow {
  pasture: Pasture
  animals: number
  /** gado contado sem categoria: fêmeas, machos e bezerros sem sexo identificado */
  spec: { females: number; males: number; calves: number }
  /** texto curto do que precisa ser especificado ("" = nada) */
  specText: string
  tasks: number
  hasPending: boolean
}

export type PastureFilter = 'todos' | 'com-animais' | 'vazios' | 'pendencias'
export const FILTERS: { id: PastureFilter; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'com-animais', label: 'Com animais' },
  { id: 'vazios', label: 'Vazios' },
  { id: 'pendencias', label: 'Com pendências' },
]

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function specText(s: PastureRow['spec']): string {
  return [
    s.females > 0 && plural(s.females, 'fêmea sem categoria', 'fêmeas sem categoria'),
    s.males > 0 && plural(s.males, 'macho sem categoria', 'machos sem categoria'),
    s.calves > 0 && plural(s.calves, 'bezerro sem sexo', 'bezerros sem sexo'),
  ]
    .filter(Boolean)
    .join(', ')
}

export function buildPastureRows(pastures: readonly Pasture[], balances: Map<string, number>, pendingTasks: Map<string, number>): PastureRow[] {
  return pastures.map((p) => {
    const spec = {
      females: Math.max(0, balanceOf(balances, p.id, 'femea-a-especificar')),
      males: Math.max(0, balanceOf(balances, p.id, 'macho-a-especificar')),
      calves: Math.max(0, balanceOf(balances, p.id, 'bezerro-a-especificar')),
    }
    const text = specText(spec)
    const tasks = pendingTasks.get(p.id) ?? 0
    return { pasture: p, animals: pastureTotal(balances, p.id), spec, specText: text, tasks, hasPending: text !== '' || tasks > 0 }
  })
}

export interface PastureSummary {
  total: number
  /** soma das áreas informadas */
  hectares: number
  /** pastos sem área informada (não entram na soma) */
  withoutArea: number
  occupied: number
  empty: number
}

export function summarizePastures(rows: readonly PastureRow[]): PastureSummary {
  const occupied = rows.filter((r) => r.animals > 0).length
  return {
    total: rows.length,
    hectares: rows.reduce((a, r) => a + (r.pasture.areaHa ?? 0), 0),
    withoutArea: rows.filter((r) => r.pasture.areaHa === null).length,
    occupied,
    empty: rows.length - occupied,
  }
}

/** Sem acento e em minúsculas, para pesquisar "agua" e achar "Água Boa". */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').trim()

export function matchesFilter(r: PastureRow, f: PastureFilter): boolean {
  if (f === 'com-animais') return r.animals > 0
  if (f === 'vazios') return r.animals <= 0
  if (f === 'pendencias') return r.hasPending
  return true
}

export function filterPastures(rows: readonly PastureRow[], query: string, f: PastureFilter): PastureRow[] {
  const q = fold(query)
  return rows.filter((r) => matchesFilter(r, f) && (!q || fold(r.pasture.name).includes(q)))
}
