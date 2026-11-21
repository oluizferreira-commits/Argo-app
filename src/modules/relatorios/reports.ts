import { formatDecimal, formatMoney } from '../../core/money'
import type { Client, Equipment, FieldOperation, Farm, FuelMovement, Movement, Pasture, Payment, ReserveEntry, Responsible, Sale, Supply, SupplyMovement } from '../../db/types'
import { CATEGORIES, category, isUnspecified } from '../../domain/categories'
import { formatLiters, fuelLedger } from '../diesel/fuel'
import { formatQty } from '../insumos/supplies'
import { EMPTY_FILTER, grassLabel, manejoStats, type ManejoFilter } from '../manejo/manejoStats'
import { formatHa, formatHours, typeLabel } from '../manejo/operations'
import { computeBalances, formatDay, todayLocal } from '../rebanho/herd'
import { activePayments, METHOD_LABELS, saleBalance } from '../receber/receivables'
import { rateOn, reserveShare } from '../reserva/reserve'
import { formatSaleNumber } from '../vendas/sales'

// ------------------------------------------------------------------ período

export interface Period {
  kind: 'mes' | 'ano'
  year: number
  /** 1–12 (só para "mes") */
  month?: number
}

export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

const pad = (n: number) => String(n).padStart(2, '0')

export function periodRange(p: Period): { start: string; end: string } {
  if (p.kind === 'ano') return { start: `${p.year}-01-01`, end: `${p.year}-12-31` }
  const m = p.month ?? 1
  const last = new Date(Date.UTC(p.year, m, 0)).getUTCDate()
  return { start: `${p.year}-${pad(m)}-01`, end: `${p.year}-${pad(m)}-${pad(last)}` }
}

export function periodLabel(p: Period): string {
  return p.kind === 'ano' ? `Ano de ${p.year}` : `${MONTHS[(p.month ?? 1) - 1].replace(/^./, (c) => c.toUpperCase())} de ${p.year}`
}

/** Data de referência para posições (rebanho, inadimplência): fim do período ou hoje. */
export function referenceDate(p: Period, today = todayLocal()): string {
  const { end } = periodRange(p)
  return end < today ? end : today
}

const inPeriod = (date: string, p: Period) => {
  const { start, end } = periodRange(p)
  return date >= start && date <= end
}

// ------------------------------------------------------------------ modelo

export type Align = 'left' | 'right'

export interface ReportTable {
  title?: string
  columns: { label: string; align?: Align }[]
  rows: string[][]
  foot?: string[]
  /** tabela larga (PDF em paisagem) */
  wide?: boolean
}

export interface Report {
  id: ReportId
  title: string
  summary: { label: string; value: string }[]
  tables: ReportTable[]
  notes: string[]
  empty?: string
}

export const REPORTS = [
  { id: 'vendas', title: 'Vendas' },
  { id: 'arrobas', title: 'Arrobas vendidas' },
  { id: 'recebimentos', title: 'Recebimentos' },
  { id: 'inadimplencia', title: 'Inadimplência' },
  { id: 'reserva', title: 'Reserva financeira' },
  { id: 'nascimentos-mortes', title: 'Nascimentos e mortes' },
  { id: 'rebanho', title: 'Rebanho por pasto e categoria' },
  { id: 'diesel', title: 'Diesel' },
  { id: 'manejo', title: 'Manejo de pastagens' },
] as const

export type ReportId = (typeof REPORTS)[number]['id']

export interface ReportData {
  farm: Farm
  pastures: Pasture[]
  movements: Movement[]
  sales: Sale[]
  payments: Payment[]
  clients: Client[]
  reserveEntries: ReserveEntry[]
  fuelMovements?: FuelMovement[]
  equipments?: Equipment[]
  responsibles?: Responsible[]
  fieldOperations?: FieldOperation[]
  supplies?: Supply[]
  supplyMovements?: SupplyMovement[]
  today?: string
}

const R = 'right' as const
const n = (v: number) => v.toLocaleString('pt-BR')
const arr = (h: number) => `${formatDecimal(h, 2, 2)} @`
const monthName = (m: number) => MONTHS[m - 1].replace(/^./, (c) => c.toUpperCase())

function byMonth<T>(items: T[], date: (t: T) => string): Map<number, T[]> {
  const map = new Map<number, T[]>()
  for (const it of items) {
    const m = Number(date(it).slice(5, 7))
    map.set(m, [...(map.get(m) ?? []), it])
  }
  return map
}

function heads(s: Sale): number {
  return s.items.reduce((a, i) => a + i.quantity, 0)
}

// ------------------------------------------------------------------ relatórios

function vendas(d: ReportData, p: Period): Report {
  const clients = new Map(d.clients.map((c) => [c.id, c.name]))
  const all = d.sales.filter((s) => inPeriod(s.date, p))
  const list = all.filter((s) => s.status === 'ativa').sort((a, b) => a.date.localeCompare(b.date) || a.number - b.number)
  const canceled = all.length - list.length
  const total = list.reduce((a, s) => a + s.totalCents, 0)
  const tables: ReportTable[] = [
    {
      columns: [{ label: 'Data' }, { label: 'Nº' }, { label: 'Cliente' }, { label: 'Tipo' }, { label: 'Cab.', align: R }, { label: 'Arrobas', align: R }, { label: 'Valor', align: R }],
      rows: list.map((s) => [
        formatDay(s.date),
        formatSaleNumber(s.number),
        clients.get(s.clientId) ?? '-',
        s.mode === 'arroba' ? 'Por arroba' : 'Por cabeça',
        n(heads(s)),
        s.mode === 'arroba' ? arr(s.arrobasHundredths) : '-',
        formatMoney(s.totalCents),
      ]),
      foot: ['Total', '', '', '', n(list.reduce((a, s) => a + heads(s), 0)), '', formatMoney(total)],
    },
  ]
  // por cliente (mês ou ano)
  if (list.length) {
    const byClient = new Map<string, Sale[]>()
    for (const sl of list) byClient.set(sl.clientId, [...(byClient.get(sl.clientId) ?? []), sl])
    tables.unshift({
      title: 'Por cliente',
      columns: [{ label: 'Cliente' }, { label: 'Vendas', align: R }, { label: 'Cabeças', align: R }, { label: 'Valor', align: R }, { label: '% do total', align: R }],
      rows: [...byClient.entries()]
        .map(([cid, ss]) => ({ name: clients.get(cid) ?? '-', ss, v: ss.reduce((a, x) => a + x.totalCents, 0) }))
        .sort((a, b) => b.v - a.v)
        .map(({ name, ss, v }) => [name, n(ss.length), n(ss.reduce((a, x) => a + heads(x), 0)), formatMoney(v), total ? `${((v * 100) / total).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '-']),
    })
  }
  if (p.kind === 'ano' && list.length) {
    const bm = byMonth(list, (s) => s.date)
    tables.unshift({
      title: 'Por mês',
      columns: [{ label: 'Mês' }, { label: 'Vendas', align: R }, { label: 'Cabeças', align: R }, { label: 'Valor', align: R }],
      rows: [...bm.entries()].sort((a, b) => a[0] - b[0]).map(([m, ss]) => [monthName(m), n(ss.length), n(ss.reduce((a, s) => a + heads(s), 0)), formatMoney(ss.reduce((a, s) => a + s.totalCents, 0))]),
    })
  }
  return {
    id: 'vendas',
    title: 'Vendas',
    summary: [
      { label: 'Vendas', value: n(list.length) },
      { label: 'Cabeças vendidas', value: n(list.reduce((a, s) => a + heads(s), 0)) },
      { label: 'Valor total', value: formatMoney(total) },
    ],
    tables,
    notes: canceled ? [`${canceled} venda(s) cancelada(s) no período não entram nos totais.`] : [],
    empty: list.length ? undefined : 'Nenhuma venda no período.',
  }
}

function arrobas(d: ReportData, p: Period): Report {
  const clients = new Map(d.clients.map((c) => [c.id, c.name]))
  const list = d.sales.filter((s) => s.status === 'ativa' && s.mode === 'arroba' && inPeriod(s.date, p)).sort((a, b) => a.date.localeCompare(b.date))
  const totalH = list.reduce((a, s) => a + s.arrobasHundredths, 0)
  const totalCents = list.reduce((a, s) => a + s.totalCents, 0)
  const kgTenths = list.filter((s) => s.weighing === 'vivo').reduce((a, s) => a + s.animals.reduce((x, an) => x + an.amount, 0), 0)
  const avg = totalH ? Math.round((totalCents * 100) / totalH) : 0
  const tables: ReportTable[] = [
    {
      columns: [
        { label: 'Data' },
        { label: 'Nº' },
        { label: 'Cliente' },
        { label: 'Pesagem' },
        { label: 'Animais', align: R },
        { label: 'Peso vivo', align: R },
        { label: 'Arrobas', align: R },
        { label: 'R$/@', align: R },
        { label: 'Valor', align: R },
      ],
      rows: list.map((s) => [
        formatDay(s.date),
        formatSaleNumber(s.number),
        clients.get(s.clientId) ?? '-',
        s.weighing === 'vivo' ? 'Vivo (kg / 30)' : 'Abate',
        n(s.animals.length),
        s.weighing === 'vivo' ? `${formatDecimal(s.animals.reduce((a, an) => a + an.amount, 0), 1)} kg` : '-',
        arr(s.arrobasHundredths),
        formatMoney(s.pricePerArrobaCents ?? 0),
        formatMoney(s.totalCents),
      ]),
      foot: ['Total', '', '', '', n(list.reduce((a, s) => a + s.animals.length, 0)), kgTenths ? `${formatDecimal(kgTenths, 1)} kg` : '-', arr(totalH), formatMoney(avg), formatMoney(totalCents)],
      wide: true,
    },
  ]
  if (p.kind === 'ano' && list.length) {
    const bm = byMonth(list, (s) => s.date)
    tables.unshift({
      title: 'Por mês',
      columns: [{ label: 'Mês' }, { label: 'Arrobas', align: R }, { label: 'Valor', align: R }, { label: 'Preço médio R$/@', align: R }],
      rows: [...bm.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([m, ss]) => {
          const h = ss.reduce((a, s) => a + s.arrobasHundredths, 0)
          const v = ss.reduce((a, s) => a + s.totalCents, 0)
          return [monthName(m), arr(h), formatMoney(v), formatMoney(h ? Math.round((v * 100) / h) : 0)]
        }),
    })
  }
  return {
    id: 'arrobas',
    title: 'Arrobas vendidas',
    summary: [
      { label: 'Arrobas vendidas', value: arr(totalH) },
      { label: 'Preço médio', value: `${formatMoney(avg)}/@` },
      { label: 'Valor total', value: formatMoney(totalCents) },
    ],
    tables,
    notes: ['Peso vivo: arrobas = kg / 30. Abate: arrobas lançadas direto.'],
    empty: list.length ? undefined : 'Nenhuma venda por arroba no período.',
  }
}

function recebimentos(d: ReportData, p: Period): Report {
  const clients = new Map(d.clients.map((c) => [c.id, c.name]))
  const sales = new Map(d.sales.map((s) => [s.id, s]))
  const all = d.payments.filter((x) => inPeriod(x.date, p))
  const list = activePayments(all)
  const total = list.reduce((a, x) => a + x.amountCents, 0)
  const byMethod = new Map<string, number>()
  for (const x of list) byMethod.set(x.method, (byMethod.get(x.method) ?? 0) + x.amountCents)
  return {
    id: 'recebimentos',
    title: 'Recebimentos',
    summary: [
      { label: 'Recebimentos', value: n(list.length) },
      { label: 'Total recebido', value: formatMoney(total) },
      { label: 'Parte da reserva', value: formatMoney(list.reduce((a, x) => a + reserveShare(x.amountCents, rateOn(d.farm, x.date)), 0)) },
    ],
    tables: [
      {
        title: 'Por forma de pagamento',
        columns: [{ label: 'Forma' }, { label: 'Valor', align: R }],
        rows: [...byMethod.entries()].map(([m, v]) => [METHOD_LABELS[m as keyof typeof METHOD_LABELS], formatMoney(v)]),
      },
      {
        columns: [{ label: 'Data' }, { label: 'Cliente' }, { label: 'Venda' }, { label: 'Forma' }, { label: 'Valor', align: R }],
        rows: list.map((x) => [formatDay(x.date), clients.get(x.clientId) ?? '-', sales.get(x.saleId) ? formatSaleNumber(sales.get(x.saleId)!.number) : '-', METHOD_LABELS[x.method], formatMoney(x.amountCents)]),
        foot: ['Total', '', '', '', formatMoney(total)],
      },
    ],
    notes: all.length > list.length ? [`${all.length - list.length} recebimento(s) estornado(s) não entram nos totais.`] : [],
    empty: list.length ? undefined : 'Nenhum recebimento no período.',
  }
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)

function inadimplencia(d: ReportData, p: Period): Report {
  const ref = referenceDate(p, d.today)
  const clients = new Map(d.clients.map((c) => [c.id, c.name]))
  const rows: { client: string; sale: Sale; idx: number; due: string; open: number }[] = []
  for (const s of d.sales) {
    if (s.status !== 'ativa' || s.date > ref) continue
    const pays = d.payments.filter((x) => x.saleId === s.id && x.date <= ref)
    const b = saleBalance(s, pays, ref)
    for (const i of b.installments) if (i.status === 'vencida' && i.openCents > 0) rows.push({ client: clients.get(s.clientId) ?? '-', sale: s, idx: i.index, due: i.due, open: i.openCents })
  }
  rows.sort((a, b) => a.due.localeCompare(b.due))
  const total = rows.reduce((a, r) => a + r.open, 0)
  const byClient = new Map<string, { n: number; v: number }>()
  for (const r of rows) {
    const c = byClient.get(r.client) ?? { n: 0, v: 0 }
    byClient.set(r.client, { n: c.n + 1, v: c.v + r.open })
  }
  return {
    id: 'inadimplencia',
    title: 'Inadimplência',
    summary: [
      { label: 'Posição em', value: formatDay(ref) },
      { label: 'Clientes devendo', value: n(byClient.size) },
      { label: 'Total vencido', value: formatMoney(total) },
    ],
    tables: [
      {
        title: 'Por cliente',
        columns: [{ label: 'Cliente' }, { label: 'Parcelas vencidas', align: R }, { label: 'Valor', align: R }],
        rows: [...byClient.entries()].sort((a, b) => b[1].v - a[1].v).map(([c, x]) => [c, n(x.n), formatMoney(x.v)]),
      },
      {
        columns: [{ label: 'Cliente' }, { label: 'Venda' }, { label: 'Parcela' }, { label: 'Vencimento' }, { label: 'Dias de atraso', align: R }, { label: 'Em aberto', align: R }],
        rows: rows.map((r) => [
          r.client,
          formatSaleNumber(r.sale.number),
          r.sale.installments.length > 1 ? `${r.idx + 1}/${r.sale.installments.length}` : 'Única',
          formatDay(r.due),
          n(daysBetween(r.due, ref)),
          formatMoney(r.open),
        ]),
        foot: ['Total', '', '', '', '', formatMoney(total)],
      },
    ],
    notes: ['Parcelas vencidas e não pagas até a data da posição.'],
    empty: rows.length ? undefined : `Nenhuma parcela vencida em ${formatDay(ref)}.`,
  }
}

function reserva(d: ReportData, p: Period): Report {
  const { start } = periodRange(p)
  const active = d.reserveEntries.filter((e) => e.status === 'ativo' && e.deletedAt === null)
  const signed = (e: ReserveEntry) => (e.type === 'deposito' ? e.amountCents : -e.amountCents)
  const opening = active.filter((e) => e.date < start).reduce((a, e) => a + signed(e), 0)
  const list = active.filter((e) => inPeriod(e.date, p)).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
  const dep = list.filter((e) => e.type === 'deposito').reduce((a, e) => a + e.amountCents, 0)
  const ret = list.filter((e) => e.type === 'retirada').reduce((a, e) => a + e.amountCents, 0)
  const due = activePayments(d.payments.filter((x) => inPeriod(x.date, p))).reduce((a, x) => a + reserveShare(x.amountCents, rateOn(d.farm, x.date)), 0)
  let running = opening
  return {
    id: 'reserva',
    title: 'Reserva financeira',
    summary: [
      { label: 'Saldo inicial', value: formatMoney(opening) },
      { label: 'Depósitos', value: formatMoney(dep) },
      { label: 'Retiradas', value: formatMoney(ret) },
      { label: 'Saldo final', value: formatMoney(opening + dep - ret) },
      { label: 'Reserva sobre os recebimentos do período', value: formatMoney(due) },
    ],
    tables: [
      {
        columns: [{ label: 'Data' }, { label: 'Tipo' }, { label: 'Descrição' }, { label: 'Valor', align: R }, { label: 'Saldo', align: R }],
        rows: list.map((e) => {
          running += signed(e)
          return [formatDay(e.date), e.type === 'deposito' ? 'Depósito' : 'Retirada', e.notes || '-', `${e.type === 'deposito' ? '+' : '-'}${formatMoney(e.amountCents)}`, formatMoney(running)]
        }),
      },
    ],
    notes: [],
    empty: list.length ? undefined : 'Nenhum movimento da reserva no período.',
  }
}

function nascimentosMortes(d: ReportData, p: Period): Report {
  const pastures = new Map(d.pastures.map((x) => [x.id, x.name]))
  type Row = { date: string; kind: 'Nascimento' | 'Morte'; pasture: string; cat: string; qty: number; origin: string; notes: string }
  const rows: Row[] = []
  for (const m of d.movements) {
    if (m.deletedAt !== null || !inPeriod(m.date, p) || m.reversedBy || m.type === 'estorno') continue
    if (m.type === 'nascimento' || m.type === 'morte') {
      for (const e of m.entries)
        rows.push({ date: m.date, kind: m.type === 'nascimento' ? 'Nascimento' : 'Morte', pasture: pastures.get(e.pastureId) ?? '-', cat: category(e.category).label, qty: Math.abs(e.delta), origin: 'Lançamento', notes: m.notes })
    } else if (m.type === 'contagem') {
      for (const e of m.entries) {
        if (e.reason === 'nascimento-nao-registrado' || e.reason === 'morte-nao-registrada')
          rows.push({ date: m.date, kind: e.reason === 'nascimento-nao-registrado' ? 'Nascimento' : 'Morte', pasture: pastures.get(e.pastureId) ?? '-', cat: category(e.category).label, qty: Math.abs(e.delta), origin: 'Encontrado na contagem', notes: m.notes })
      }
    } else if (m.type === 'especificacao' && m.difference && (m.differenceReason === 'nascimento-nao-registrado' || m.differenceReason === 'morte-nao-registrada')) {
      rows.push({ date: m.date, kind: m.differenceReason === 'nascimento-nao-registrado' ? 'Nascimento' : 'Morte', pasture: pastures.get(m.pastureIds[0]) ?? '-', cat: '-', qty: Math.abs(m.difference), origin: 'Encontrado na especificação', notes: m.notes })
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date))
  const births = rows.filter((r) => r.kind === 'Nascimento').reduce((a, r) => a + r.qty, 0)
  const deaths = rows.filter((r) => r.kind === 'Morte').reduce((a, r) => a + r.qty, 0)
  const byPasture = new Map<string, { b: number; d: number }>()
  for (const r of rows) {
    const x = byPasture.get(r.pasture) ?? { b: 0, d: 0 }
    if (r.kind === 'Nascimento') x.b += r.qty
    else x.d += r.qty
    byPasture.set(r.pasture, x)
  }
  return {
    id: 'nascimentos-mortes',
    title: 'Nascimentos e mortes',
    summary: [
      { label: 'Nascimentos', value: n(births) },
      { label: 'Mortes', value: n(deaths) },
    ],
    tables: [
      {
        title: 'Por pasto',
        columns: [{ label: 'Pasto' }, { label: 'Nascimentos', align: R }, { label: 'Mortes', align: R }],
        rows: [...byPasture.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR')).map(([k, x]) => [k, n(x.b), n(x.d)]),
      },
      {
        columns: [{ label: 'Data' }, { label: 'Tipo' }, { label: 'Pasto' }, { label: 'Categoria' }, { label: 'Qtde', align: R }, { label: 'Origem' }, { label: 'Obs.' }],
        rows: rows.map((r) => [formatDay(r.date), r.kind, r.pasture, r.cat, n(r.qty), r.origin, r.notes || '-']),
        wide: true,
      },
    ],
    notes: ['Lançamentos estornados não entram. "Encontrado na contagem" = diferença registrada como nascimento/morte não registrado.'],
    empty: rows.length ? undefined : 'Nenhum nascimento ou morte no período.',
  }
}

function rebanho(d: ReportData, p: Period): Report {
  const ref = referenceDate(p, d.today)
  // Lançamento estornado e o próprio estorno são uma correção: ficam fora da posição (em qualquer data).
  const balances = computeBalances(d.movements.filter((m) => m.date <= ref && !m.reversedBy && m.type !== 'estorno'))
  const pastures = d.pastures.filter((x) => x.deletedAt === null).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))
  const cats = CATEGORIES.filter((c) => pastures.some((ps) => (balances.get(`${ps.id}|${c.id}`) ?? 0) !== 0))
  const totalOf = (pid: string) => cats.reduce((a, c) => a + (balances.get(`${pid}|${c.id}`) ?? 0), 0)
  const grand = pastures.reduce((a, ps) => a + totalOf(ps.id), 0)
  const unspecified = cats.filter((c) => isUnspecified(c.id)).reduce((a, c) => a + pastures.reduce((x, ps) => x + (balances.get(`${ps.id}|${c.id}`) ?? 0), 0), 0)
  return {
    id: 'rebanho',
    title: 'Rebanho por pasto e categoria',
    summary: [
      { label: 'Posição em', value: formatDay(ref) },
      { label: 'Total de cabeças', value: n(grand) },
      { label: 'Pastos', value: n(pastures.length) },
    ],
    tables: [
      {
        title: 'Por categoria',
        columns: [{ label: 'Categoria' }, { label: 'Cabeças', align: R }],
        rows: cats.map((c) => [c.label, n(pastures.reduce((a, ps) => a + (balances.get(`${ps.id}|${c.id}`) ?? 0), 0))]),
        foot: ['Total', n(grand)],
      },
      {
        title: 'Por pasto',
        columns: [{ label: 'Pasto' }, ...cats.map((c) => ({ label: c.label, align: R })), { label: 'Total', align: R }, { label: 'Cab./ha', align: R }],
        rows: pastures.map((ps) => {
          const t = totalOf(ps.id)
          return [
            ps.name,
            ...cats.map((c) => n(balances.get(`${ps.id}|${c.id}`) ?? 0)),
            n(t),
            ps.areaHa ? (t / ps.areaHa).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '-',
          ]
        }),
        foot: ['Total', ...cats.map((c) => n(pastures.reduce((a, ps) => a + (balances.get(`${ps.id}|${c.id}`) ?? 0), 0))), n(grand), ''],
        wide: true,
      },
    ],
    notes: unspecified ? [`${n(unspecified)} cabeça(s) ainda "a especificar": separar por categoria na próxima vez que o gado for ao curral.`] : [],
    empty: grand ? undefined : `Nenhum animal em ${formatDay(ref)}.`,
  }
}


// ------------------------------------------------------------------ diesel

/** Segunda-feira da semana (AAAA-MM-DD). */
export function weekStart(date: string): string {
  const d = new Date(`${date}T12:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7 // segunda = 0
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}

function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const shortDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const lit = (cl: number) => formatLiters(cl)
const dec = (v: number, max = 1) => v.toLocaleString('pt-BR', { minimumFractionDigits: max, maximumFractionDigits: max })

/**
 * Consumo por intervalo de medidor: cada abastecimento com leitura, que tenha uma leitura anterior do mesmo
 * equipamento, conta os litros abastecidos agora sobre as horas (ou km) desde o abastecimento anterior.
 */
export function meterIntervals(movements: readonly FuelMovement[], equipmentId: string): { date: string; liters: number; delta: number }[] {
  const list = movements
    .filter((m) => m.status === 'ativo' && m.deletedAt === null && m.type === 'consumo' && m.equipmentId === equipmentId && m.meterReading !== null)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
  const out: { date: string; liters: number; delta: number }[] = []
  for (let i = 1; i < list.length; i++) {
    const delta = list[i].meterReading! - list[i - 1].meterReading!
    if (delta > 0) out.push({ date: list[i].date, liters: Math.abs(list[i].centiliters), delta })
  }
  return out
}

function diesel(d: ReportData, p: Period): Report {
  const all = d.fuelMovements ?? []
  const equipments = new Map((d.equipments ?? []).map((e) => [e.id, e]))
  const people = new Map((d.responsibles ?? []).map((r) => [r.id, r.name]))
  const ledger = fuelLedger(all)
  const { end } = periodRange(p)
  const lines = ledger.lines.filter((l) => inPeriod(l.movement.date, p))
  const upTo = ledger.lines.filter((l) => l.movement.date <= end).at(-1)
  const buys = lines.filter((l) => l.movement.type === 'compra')
  const uses = lines.filter((l) => l.movement.type === 'consumo')
  const sum = (ls: typeof lines, f: (l: (typeof lines)[number]) => number) => ls.reduce((a, l) => a + f(l), 0)
  const boughtCl = sum(buys, (l) => l.movement.centiliters)
  const boughtCents = sum(buys, (l) => l.costCents)
  const usedCl = sum(uses, (l) => -l.movement.centiliters)
  const usedCents = sum(uses, (l) => l.costCents)

  // por semana (mês) ou por mês (ano)
  const groups = new Map<string, { cl: number; cents: number; n: number }>()
  for (const l of uses) {
    const k = p.kind === 'mes' ? weekStart(l.movement.date) : l.movement.date.slice(5, 7)
    const g = groups.get(k) ?? { cl: 0, cents: 0, n: 0 }
    g.cl += -l.movement.centiliters
    g.cents += l.costCents
    g.n++
    groups.set(k, g)
  }
  const timeTable: ReportTable =
    p.kind === 'mes'
      ? {
          title: 'Por semana',
          columns: [{ label: 'Semana' }, { label: 'Abastec.', align: R }, { label: 'Litros', align: R }, { label: 'Custo', align: R }],
          rows: [...groups.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([k, g]) => [`${shortDay(k)} a ${shortDay(addDaysIso(k, 6))}`, n(g.n), lit(g.cl), formatMoney(g.cents)]),
          foot: ['Total', n(uses.length), lit(usedCl), formatMoney(usedCents)],
        }
      : {
          title: 'Por mês',
          columns: [{ label: 'Mês' }, { label: 'Abastec.', align: R }, { label: 'Litros', align: R }, { label: 'Custo', align: R }],
          rows: [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, g]) => [monthName(Number(k)), n(g.n), lit(g.cl), formatMoney(g.cents)]),
          foot: ['Total', n(uses.length), lit(usedCl), formatMoney(usedCents)],
        }

  // por equipamento (com média L/h pelo horímetro ou km/L pelo hodômetro)
  const byEq = new Map<string, { cl: number; cents: number; n: number }>()
  for (const l of uses) {
    const k = l.movement.equipmentId ?? '-'
    const g = byEq.get(k) ?? { cl: 0, cents: 0, n: 0 }
    g.cl += -l.movement.centiliters
    g.cents += l.costCents
    g.n++
    byEq.set(k, g)
  }
  const eqRows = [...byEq.entries()]
    .map(([id, g]) => {
      const eq = equipments.get(id)
      const iv = eq && eq.meter !== 'nenhum' ? meterIntervals(all, id).filter((x) => inPeriod(x.date, p)) : []
      const liters = iv.reduce((a, x) => a + x.liters, 0) / 100
      const delta = iv.reduce((a, x) => a + x.delta, 0) / 10
      let worked = '-'
      let avg = '-'
      if (eq && delta > 0) {
        if (eq.meter === 'horimetro') {
          worked = `${dec(delta)} h`
          avg = `${dec(liters / delta, 2)} L/h`
        } else {
          worked = `${dec(delta)} km`
          avg = `${dec(delta / liters, 2)} km/L`
        }
      }
      return { name: eq?.name ?? '-', row: [eq?.name ?? '-', n(g.n), lit(g.cl), formatMoney(g.cents), worked, avg] }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))

  const byResp = new Map<string, { cl: number; cents: number; n: number }>()
  for (const l of uses) {
    const k = l.movement.responsibleId ? (people.get(l.movement.responsibleId) ?? '-') : 'Sem responsável'
    const g = byResp.get(k) ?? { cl: 0, cents: 0, n: 0 }
    g.cl += -l.movement.centiliters
    g.cents += l.costCents
    g.n++
    byResp.set(k, g)
  }

  const fmtMeter = (m: FuelMovement) => {
    const eq = m.equipmentId ? equipments.get(m.equipmentId) : undefined
    if (!eq || m.meterReading === null) return '-'
    return `${dec(m.meterReading / 10)} ${eq.meter === 'km' ? 'km' : 'h'}`
  }
  const empty = !buys.length && !uses.length
  return {
    id: 'diesel',
    title: 'Diesel',
    summary: [
      { label: 'Comprado', value: `${lit(boughtCl)} · ${formatMoney(boughtCents)}` },
      { label: 'Consumido', value: lit(usedCl) },
      { label: 'Custo do consumo', value: formatMoney(usedCents) },
      { label: 'Custo médio no fim', value: upTo?.avgCents ? `${formatMoney(upTo.avgCents)}/L` : '-' },
      { label: 'Estoque no fim', value: lit(upTo?.balanceCl ?? 0) },
    ],
    tables: [
      timeTable,
      {
        title: 'Por equipamento',
        columns: [{ label: 'Equipamento' }, { label: 'Abastec.', align: R }, { label: 'Litros', align: R }, { label: 'Custo', align: R }, { label: 'Trabalhado', align: R }, { label: 'Média', align: R }],
        rows: eqRows.map((x) => x.row),
        foot: ['Total', n(uses.length), lit(usedCl), formatMoney(usedCents), '', ''],
      },
      {
        title: 'Por responsável',
        columns: [{ label: 'Responsável' }, { label: 'Abastec.', align: R }, { label: 'Litros', align: R }, { label: 'Custo', align: R }],
        rows: [...byResp.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR')).map(([k, g]) => [k, n(g.n), lit(g.cl), formatMoney(g.cents)]),
      },
      {
        title: 'Compras',
        columns: [{ label: 'Data' }, { label: 'Posto' }, { label: 'Litros', align: R }, { label: 'Valor', align: R }, { label: 'R$/L', align: R }],
        rows: buys.map((l) => [
          formatDay(l.movement.date),
          l.movement.station || '-',
          lit(l.movement.centiliters),
          formatMoney(l.costCents),
          formatMoney(Math.round((l.costCents * 100) / l.movement.centiliters)),
        ]),
        foot: ['Total', '', lit(boughtCl), formatMoney(boughtCents), boughtCl ? formatMoney(Math.round((boughtCents * 100) / boughtCl)) : ''],
      },
      {
        title: 'Abastecimentos',
        columns: [{ label: 'Data' }, { label: 'Equipamento' }, { label: 'Responsável' }, { label: 'Litros', align: R }, { label: 'Medidor', align: R }, { label: 'Custo', align: R }, { label: 'Obs.' }],
        rows: uses.map((l) => [
          formatDay(l.movement.date),
          (l.movement.equipmentId && equipments.get(l.movement.equipmentId)?.name) || '-',
          (l.movement.responsibleId && people.get(l.movement.responsibleId)) || '-',
          lit(-l.movement.centiliters),
          fmtMeter(l.movement),
          formatMoney(l.costCents),
          l.movement.notes || '-',
        ]),
        wide: true,
      },
    ],
    notes: [
      'Custo de cada abastecimento = litros × custo médio ponderado do diesel no dia. Lançamentos estornados não entram.',
      'Média L/h (horímetro) ou km/L (hodômetro): litros de cada abastecimento sobre as horas/km desde o abastecimento anterior do mesmo equipamento; só entram abastecimentos com leitura.',
    ],
    empty: empty ? 'Nenhuma compra ou abastecimento de diesel no período.' : undefined,
  }
}

// ------------------------------------------------------------------ manejo de pastagens

/** Relatório de manejo (operações de campo) com filtros opcionais além do período. */
export function manejoReport(d: ReportData, p: Period | null, extra: Partial<ManejoFilter> = {}, filterText = ''): Report {
  const range = p ? periodRange(p) : null
  const people = new Map((d.responsibles ?? []).map((r) => [r.id, r.name]))
  const st = manejoStats(d.fieldOperations ?? [], d.supplies ?? [], d.supplyMovements ?? [], d.pastures, d.today ?? todayLocal(), {
    ...EMPTY_FILTER,
    ...extra,
    start: range?.start ?? extra.start ?? null,
    end: range?.end ?? extra.end ?? null,
  })
  const pastures = new Map(d.pastures.map((x) => [x.id, x.name]))
  const ops = [...st.operations].sort((a, b) => a.date.localeCompare(b.date) || a.number - b.number)
  return {
    id: 'manejo',
    title: 'Manejo de pastagens',
    summary: [
      { label: 'Operações', value: n(st.machines.operations) },
      { label: 'Hectares trabalhados', value: formatHa(st.machines.workedCentiHa) },
      { label: 'Custo total', value: formatMoney(st.totalCents) },
      { label: 'Herbicidas', value: formatMoney(st.herbicides.totalCents) },
      { label: 'Diesel', value: `${lit(st.machines.dieselCl)} · ${formatMoney(st.machines.dieselCents)}` },
    ],
    tables: [
      {
        title: 'Custo por pasto',
        columns: [{ label: 'Pasto' }, { label: 'Oper.', align: R }, { label: 'Herbicidas/produtos', align: R }, { label: 'Sementes', align: R }, { label: 'Diesel', align: R }, { label: 'Outros', align: R }, { label: 'Total', align: R }, { label: 'Formação', align: R }, { label: 'R$/ha do pasto', align: R }],
        rows: st.pastures.map((c) => [c.name, n(c.operations), formatMoney(c.herbicideCents), formatMoney(c.seedsCents), formatMoney(c.dieselCents), formatMoney(c.otherCents), formatMoney(c.totalCents), formatMoney(c.formationCents), c.perHaCents === null ? '-' : formatMoney(c.perHaCents)]),
        foot: ['Total', n(st.machines.operations), '', '', '', '', formatMoney(st.totalCents), '', ''],
        wide: true,
      },
      {
        title: 'Operações',
        columns: [{ label: 'Data' }, { label: 'Nº' }, { label: 'Tipo' }, { label: 'Pasto' }, { label: 'Área', align: R }, { label: 'Responsável' }, { label: 'Produtos' }, { label: 'Diesel', align: R }, { label: 'Total', align: R }, { label: 'R$/ha', align: R }],
        rows: ops.map((o) => [
          formatDay(o.date),
          String(o.number).padStart(4, '0'),
          typeLabel(o.type, o.customType),
          (o.pastureId ? pastures.get(o.pastureId) : o.location) || '-',
          formatHa(o.workedAreaCentiHa),
          (o.responsibleId && people.get(o.responsibleId)) || '-',
          o.products.map((x) => `${x.name} ${formatQty(x.qty, x.unit)}`).join(' + ') || '-',
          lit(o.equipments.reduce((a, e) => a + e.dieselCl, 0)),
          formatMoney(o.totalCents),
          formatMoney(o.workedAreaCentiHa ? Math.round((o.totalCents * 100) / o.workedAreaCentiHa) : 0),
        ]),
        wide: true,
      },
      {
        title: 'Herbicidas e produtos consumidos',
        columns: [{ label: 'Produto' }, { label: 'Quantidade', align: R }, { label: 'Custo', align: R }],
        rows: st.herbicides.byProduct.map((x) => [x.supply?.name ?? '-', x.supply ? formatQty(x.qty, x.supply.unit ?? 'saco') : '-', formatMoney(x.cents)]),
      },
      {
        title: 'Sementes por variedade',
        columns: [{ label: 'Espécie / cultivar' }, { label: 'Quantidade', align: R }, { label: 'Custo', align: R }],
        rows: st.seeds.byGrass.map((x) => [grassLabel(x.key), `${(x.qty / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} kg`, formatMoney(x.cents)]),
      },
      {
        title: 'Tratores e equipamentos',
        columns: [{ label: 'Equipamento' }, { label: 'Operações', align: R }, { label: 'Horas', align: R }, { label: 'Diesel', align: R }, { label: 'Custo diesel', align: R }],
        rows: st.machines.byEquipment.map((x) => [x.name, n(x.ops), formatHours(x.hours), lit(x.cl), formatMoney(x.cents)]),
      },
    ],
    notes: [
      ...(filterText ? [`Filtros: ${filterText}.`] : []),
      `Estoque atual: herbicidas ${formatMoney(st.herbicides.stockValueCents)}; sementes ${formatMoney(st.seeds.stockValueCents)}. Sementes compradas no período: ${(st.seeds.kgBought / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} kg (${formatMoney(st.seeds.boughtCents)}); usadas: ${(st.seeds.kgUsed / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} kg em ${formatHa(st.seeds.plantedCentiHa)} plantados.`,
      'Custos guardados em cada operação no dia do lançamento (custo médio ponderado de cada estoque). Operações canceladas não entram. Formação = plantio e replantio. R$/ha do pasto = custo total ÷ área do pasto.',
    ],
    empty: ops.length ? undefined : 'Nenhuma operação de campo no período.',
  }
}

const BUILDERS: Record<ReportId, (d: ReportData, p: Period) => Report> = {
  vendas,
  arrobas,
  recebimentos,
  inadimplencia,
  reserva,
  'nascimentos-mortes': nascimentosMortes,
  rebanho,
  diesel,
  manejo: (d, p) => manejoReport(d, p),
}

export function buildReports(ids: readonly ReportId[], d: ReportData, p: Period): Report[] {
  return ids.map((id) => BUILDERS[id](d, p))
}
