/**
 * Cálculos do Painel (funções puras, sem acesso ao banco): indicadores, Central de Pendências,
 * Agenda Operacional e Atividades recentes. Tudo vem de dados reais já lançados nos módulos.
 */
import { formatMoney } from '../../core/money'
import { category, type CategoryId } from '../../domain/categories'
import type {
  AuditEntry,
  Client,
  Equipment,
  Farm,
  FuelMovement,
  Movement,
  Pasture,
  PastureTask,
  Payment,
  ReserveEntry,
  Responsible,
  Sale,
  Supply,
  SupplyMovement,
  Vaccination,
  VaccinationApplication,
  MaintenancePlan,
  MaintenanceRecord,
  MachineChecklist,
  MachineSession,
  MeterAdjustment,
  FieldOperation,
  WorkerPayment,
} from '../../db/types'
import { MOVEMENT_INFO } from '../../domain/movements'
import type { IconName } from '../../components/Icon'
import { formatLiters, fuelStock } from '../diesel/fuel'
import { formatQty, formatSacks, isLowStock, supplyStock, unitOf } from '../insumos/supplies'
import { computeBalances, pendingSpecification } from '../rebanho/herd'
import { saleBalance } from '../receber/receivables'
import { reserveSummary } from '../reserva/reserve'
import { formatSaleNumber } from '../vendas/sales'
import { coverage, lotLabel } from '../vacinacao/vaccination'
import { equipmentStatus, formatMeterH, meterAt, type MeterContext } from '../maquinas/machines'
import { planStatus } from '../maquinas/maintenance'
import { workerExpense } from '../diaristas/workers'

export interface DashboardData {
  farm: Farm
  pastures: Pasture[]
  movements: Movement[]
  sales: Sale[]
  payments: Payment[]
  clients: Client[]
  reserveEntries: ReserveEntry[]
  supplies: Supply[]
  supplyMovements: SupplyMovement[]
  fuelMovements: FuelMovement[]
  equipments: Equipment[]
  tasks: PastureTask[]
  audit: AuditEntry[]
  vaccinations?: Vaccination[]
  vaccinationApplications?: VaccinationApplication[]
  responsibles?: Responsible[]
  maintenancePlans?: MaintenancePlan[]
  maintenanceRecords?: MaintenanceRecord[]
  machineChecklists?: MachineChecklist[]
  machineSessions?: MachineSession[]
  meterAdjustments?: MeterAdjustment[]
  fieldOperations?: FieldOperation[]
  workerPayments?: WorkerPayment[]
}

function meterCtx(d: DashboardData): MeterContext {
  return { sessions: d.machineSessions ?? [], fuel: d.fuelMovements, operations: d.fieldOperations ?? [], adjustments: d.meterAdjustments ?? [] }
}

/** Custo de manutenção que é saída de dinheiro (peças compradas direto + serviço). Peças do estoque já foram despesa na compra. */
export function maintenanceExpense(records: readonly MaintenanceRecord[], month: string): number {
  return records.filter((r) => r.status === 'concluida' && r.deletedAt === null && r.date?.startsWith(month)).reduce((a, r) => a + r.directCents, 0)
}

const alive = <T extends { deletedAt: string | null }>(x: T) => x.deletedAt === null

/** dia local (AAAA-MM-DD) de um horário ISO */
function localDay(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// ------------------------------------------------------------------ indicadores

export interface Indicators {
  animals: number
  pastures: number
  occupiedPastures: number
  /** a receber (parcelas em aberto, já descontados os recebimentos parciais) */
  openCents: number
  overdueCents: number
  /** receitas do mês = dinheiro recebido no mês das vendas PARA A FAZENDA (recebimentos ativos) */
  receivedMonthCents: number
  /** recebido no mês de vendas para gastos pessoais (fora do caixa da fazenda) */
  personalMonthCents: number
  /** despesas do mês = compras de diesel e de insumos lançadas no mês */
  expensesMonthCents: number
  fuelExpenseCents: number
  supplyExpenseCents: number
  maintenanceExpenseCents: number
  /** pagamentos efetivos aos diaristas no mês */
  workerExpenseCents: number
  /** saldo da reserva (conta separada) */
  reserveCents: number
  reservePendingCents: number
  /** composição do rebanho (pastos ativos): machos, fêmeas e contagem a especificar */
  herdMales: number
  herdFemales: number
  herdUnspecified: number
  /** categorias com animais, da maior para a menor */
  herdCategories: { id: CategoryId; label: string; count: number }[]
}

export function computeIndicators(d: DashboardData, today: string): Indicators {
  const pastures = d.pastures.filter(alive)
  const balances = computeBalances(d.movements)
  const perPasture = new Map<string, number>()
  for (const [k, v] of balances) {
    const pid = k.split('|')[0]
    perPasture.set(pid, (perPasture.get(pid) ?? 0) + v)
  }
  const animals = pastures.reduce((a, p) => a + (perPasture.get(p.id) ?? 0), 0)
  const occupied = pastures.filter((p) => (perPasture.get(p.id) ?? 0) > 0).length
  const alivePastures = new Set(pastures.map((p) => p.id))
  const perCategory = new Map<CategoryId, number>()
  for (const [k, v] of balances) {
    const [pid, cat] = k.split('|') as [string, CategoryId]
    if (alivePastures.has(pid) && v > 0) perCategory.set(cat, (perCategory.get(cat) ?? 0) + v)
  }
  let herdMales = 0
  let herdFemales = 0
  let herdUnspecified = 0
  const herdCategories: Indicators['herdCategories'] = []
  for (const [id, count] of perCategory) {
    const c = category(id)
    if (c.unspecified) herdUnspecified += count
    else if (c.sex === 'M') herdMales += count
    else herdFemales += count
    herdCategories.push({ id, label: c.plural, count })
  }
  herdCategories.sort((a, b) => b.count - a.count)

  const paymentsBySale = new Map<string, Payment[]>()
  for (const p of d.payments) paymentsBySale.set(p.saleId, [...(paymentsBySale.get(p.saleId) ?? []), p])
  let openCents = 0
  let overdueCents = 0
  for (const s of d.sales) {
    if (s.status !== 'ativa' || s.deletedAt !== null) continue
    const b = saleBalance(s, paymentsBySale.get(s.id) ?? [], today)
    openCents += b.openCents
    overdueCents += b.overdueCents
  }
  const month = today.slice(0, 7)
  // recebimentos do mês, separados pelo destino da venda (fazenda × gastos pessoais)
  const personalSales = new Set(d.sales.filter((s) => s.purpose === 'pessoal').map((s) => s.id))
  const monthPayments = d.payments.filter((p) => p.status === 'ativo' && p.deletedAt === null && p.date.startsWith(month))
  const receivedMonthCents = monthPayments.filter((p) => !personalSales.has(p.saleId)).reduce((a, p) => a + p.amountCents, 0)
  const personalMonthCents = monthPayments.filter((p) => personalSales.has(p.saleId)).reduce((a, p) => a + p.amountCents, 0)
  const fuelExpenseCents = d.fuelMovements
    .filter((m) => m.type === 'compra' && m.status === 'ativo' && m.deletedAt === null && m.date.startsWith(month))
    .reduce((a, m) => a + (m.totalCents ?? 0), 0)
  const supplyExpenseCents = d.supplyMovements
    .filter((m) => m.type === 'compra' && m.status === 'ativo' && m.deletedAt === null && m.date.startsWith(month))
    .reduce((a, m) => a + (m.costCents ?? 0), 0)
  const maintenanceExpenseCents = maintenanceExpense(d.maintenanceRecords ?? [], month)
  const workerExpenseCents = workerExpense(d.workerPayments ?? [], month)
  const reserve = reserveSummary(d.sales, d.payments, d.reserveEntries, d.farm)
  return {
    animals,
    pastures: pastures.length,
    occupiedPastures: occupied,
    openCents,
    overdueCents,
    receivedMonthCents,
    personalMonthCents,
    expensesMonthCents: fuelExpenseCents + supplyExpenseCents + maintenanceExpenseCents + workerExpenseCents,
    fuelExpenseCents,
    supplyExpenseCents,
    maintenanceExpenseCents,
    workerExpenseCents,
    reserveCents: reserve.balanceCents,
    reservePendingCents: reserve.pendingCents,
    herdMales,
    herdFemales,
    herdUnspecified,
    herdCategories,
  }
}

// ------------------------------------------------------------------ Central de Pendências

export type Priority = 1 | 2 | 3
export const PRIORITY_LABEL: Record<Priority, string> = { 1: 'Alta', 2: 'Média', 3: 'Baixa' }

export interface Pendency {
  /** chave estável: a mesma situação nunca aparece duas vezes */
  id: string
  priority: Priority
  icon: IconName
  title: string
  detail: string
  to: string
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

export function computePendencies(d: DashboardData, today: string, ind = computeIndicators(d, today)): Pendency[] {
  const out: Pendency[] = []
  const pastures = d.pastures.filter(alive)
  const pastureName = new Map(pastures.map((p) => [p.id, p.name]))

  // contas vencidas (uma pendência por venda com parcela vencida)
  const paymentsBySale = new Map<string, Payment[]>()
  for (const p of d.payments) paymentsBySale.set(p.saleId, [...(paymentsBySale.get(p.saleId) ?? []), p])
  const clients = new Map(d.clients.map((c) => [c.id, c.name]))
  for (const s of d.sales) {
    if (s.status !== 'ativa' || s.deletedAt !== null) continue
    const b = saleBalance(s, paymentsBySale.get(s.id) ?? [], today)
    if (b.overdueCents <= 0) continue
    const late = b.installments.filter((i) => i.status === 'vencida')
    const oldest = late.map((i) => i.due).sort()[0]
    out.push({
      id: `vencida:${s.id}`,
      priority: 1,
      icon: 'receipt',
      title: `Conta vencida · ${clients.get(s.clientId) ?? 'cliente'}`,
      detail: `${formatMoney(b.overdueCents)} em ${plural(late.length, 'parcela', 'parcelas')} · venda nº ${formatSaleNumber(s.number)} · desde ${oldest.split('-').reverse().join('/')}`,
      to: `/vendas/${s.id}`,
    })
  }

  // estoques negativos (saída lançada com autorização: falta lançar a entrada)
  const supplyMovs = d.supplyMovements.filter(alive)
  for (const s of d.supplies.filter(alive)) {
    const st = supplyStock(supplyMovs, s.id)
    if (st < 0) out.push({ id: `estoque:${s.id}`, priority: 1, icon: 'sack', title: `Estoque negativo · ${s.name}`, detail: `${formatQty(st, unitOf(s))}: lance a compra ou a mistura que falta`, to: `/insumos/${s.id}` })
    else if (s.active && isLowStock(s, st))
      out.push({ id: `estoque-baixo:${s.id}`, priority: 2, icon: 'sack', title: `Estoque baixo · ${s.name}`, detail: `Há ${formatQty(st, unitOf(s))}; mínimo ${formatQty(s.minQty ?? 0, unitOf(s))}`, to: `/insumos/${s.id}` })
  }
  const fuel = fuelStock(d.fuelMovements.filter(alive))
  if (fuel < 0) out.push({ id: 'estoque:diesel', priority: 1, icon: 'fuel', title: 'Estoque negativo · Diesel', detail: `${formatLiters(fuel)}: lance a compra que falta`, to: '/diesel' })

  // animais sem categoria / bezerros sem sexo (uma pendência por pasto)
  const balances = computeBalances(d.movements)
  for (const p of pendingSpecification(balances, pastures.map((x) => x.id))) {
    const parts = [
      p.females && plural(p.females, 'fêmea sem categoria', 'fêmeas sem categoria'),
      p.males && plural(p.males, 'macho sem categoria', 'machos sem categoria'),
      p.calves && plural(p.calves, 'bezerro sem sexo identificado', 'bezerros sem sexo identificado'),
    ].filter(Boolean)
    out.push({
      id: `especificar:${p.pastureId}`,
      priority: 2,
      icon: 'list',
      title: `Contagem a especificar · ${pastureName.get(p.pastureId) ?? 'pasto'}`,
      detail: parts.join(', '),
      to: `/rebanho/movimentar/especificacao?pasto=${p.pastureId}`,
    })
  }

  // vacinação incompleta (animais previstos ainda sem vacina; uma pendência por campanha)
  const apps = d.vaccinationApplications ?? []
  for (const v of (d.vaccinations ?? []).filter(alive)) {
    const c = coverage(v, apps)
    if (c.pending <= 0) continue
    out.push({
      id: `vacina:${v.id}`,
      priority: 2,
      icon: 'syringe',
      title: `Vacinação incompleta · ${v.vaccine}`,
      detail: `${lotLabel(pastureName.get(v.pastureId) ?? 'pasto', v.lot)}: ${plural(c.pending, 'animal pendente', 'animais pendentes')} (${c.percent}% vacinado)`,
      to: `/vacinacao/${v.id}`,
    })
  }

  // máquinas: manutenção próxima/vencida, solicitações abertas, inspeção do dia
  const equipments = d.equipments.filter((e) => e.deletedAt === null && equipmentStatus(e) !== 'inativo')
  const records = d.maintenanceRecords ?? []
  const ctx = meterCtx(d)
  const people = new Map((d.responsibles ?? []).map((r) => [r.id, r.name]))
  for (const p of (d.maintenancePlans ?? []).filter((x) => x.active && x.deletedAt === null)) {
    const eq = equipments.find((e) => e.id === p.equipmentId)
    if (!eq) continue
    const cur = meterAt(eq, ctx)
    const st = planStatus(p, records, cur, today)
    if (st.state !== 'proximo' && st.state !== 'vencido') continue
    const parts = [
      cur !== null && `horímetro ${formatMeterH(cur)}`,
      st.nextMeter !== null && `previsto ${formatMeterH(st.nextMeter)}`,
      st.nextDate && `vence ${st.nextDate.split('-').reverse().join('/')}`,
      eq.responsibleId && people.get(eq.responsibleId),
    ].filter(Boolean)
    out.push({
      id: `manut:${p.id}`,
      priority: st.state === 'vencido' ? 1 : 2,
      icon: 'gear',
      title: `${st.state === 'vencido' ? 'Manutenção vencida' : 'Manutenção próxima'} · ${p.name} · ${eq.name}`,
      detail: parts.join(' · '),
      to: `/maquinas/${eq.id}`,
    })
  }
  for (const r of records.filter((x) => x.status === 'solicitada' && x.deletedAt === null)) {
    const eq = equipments.find((e) => e.id === r.equipmentId)
    if (!eq) continue
    out.push({ id: `solic:${r.id}`, priority: 1, icon: 'alert', title: `Manutenção solicitada · ${eq.name}`, detail: r.problem || r.kind, to: `/maquinas/${eq.id}` })
  }
  const checklists = d.machineChecklists ?? []
  for (const eq of equipments) {
    const workedToday = (d.machineSessions ?? []).some((s) => s.equipmentId === eq.id && s.deletedAt === null && s.status !== 'cancelada' && localDay(s.startedAt) === today)
    if (!workedToday) continue
    if (checklists.some((c) => c.equipmentId === eq.id && c.deletedAt === null && localDay(c.at) === today)) continue
    out.push({ id: `inspecao:${eq.id}:${today}`, priority: 2, icon: 'clipboard', title: `Inspeção diária não feita · ${eq.name}`, detail: 'A máquina trabalhou hoje e ainda não tem checklist', to: `/maquinas/${eq.id}/checklist` })
  }

  // tarefas atrasadas (prazo vencido e não concluídas)
  for (const t of d.tasks.filter(alive)) {
    if (t.done || !t.dueDate || t.dueDate >= today) continue
    if (t.pastureId && !pastureName.get(t.pastureId)) continue
    out.push({
      id: `tarefa:${t.id}`,
      priority: t.priority === 'alta' ? 1 : 2,
      icon: 'clipboard',
      title: `Tarefa atrasada · ${t.description}`,
      detail: [`prazo ${t.dueDate.split('-').reverse().join('/')}`, t.pastureId ? pastureName.get(t.pastureId) : '', t.responsibleId ? people.get(t.responsibleId) : ''].filter(Boolean).join(' · '),
      to: '/tarefas',
    })
  }

  // reserva a separar
  if (ind.reservePendingCents > 0)
    out.push({ id: 'reserva', priority: 2, icon: 'vault', title: 'Reserva financeira a separar', detail: `Separe ${formatMoney(ind.reservePendingCents)} do que já foi recebido`, to: '/reserva' })

  return out.sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title, 'pt-BR'))
}

// ------------------------------------------------------------------ Agenda Operacional

export type AgendaStatus = 'atrasada' | 'pendente' | 'concluida'
export type AgendaGroup = 'atrasadas' | 'hoje' | 'proximos' | 'sem-data' | 'concluidas'
export const AGENDA_GROUPS: { id: AgendaGroup; title: string }[] = [
  { id: 'atrasadas', title: 'Atrasadas' },
  { id: 'hoje', title: 'Hoje' },
  { id: 'proximos', title: 'Próximos dias' },
  { id: 'sem-data', title: 'Tarefas sem data' },
  { id: 'concluidas', title: 'Concluídas hoje' },
]

export interface AgendaItem {
  id: string
  kind: 'parcela' | 'tarefa' | 'vacina' | 'manutencao'
  title: string
  detail: string
  date: string | null
  responsible: string | null
  status: AgendaStatus
  group: AgendaGroup
  to: string
  /** tarefa do pasto: pode ser concluída direto no Painel */
  taskId?: string
}

/** Dias à frente que a agenda mostra (parcelas a vencer). */
export const AGENDA_DAYS = 15

export function computeAgenda(d: DashboardData, today: string): AgendaItem[] {
  const out: AgendaItem[] = []
  const limit = addDays(today, AGENDA_DAYS)
  const paymentsBySale = new Map<string, Payment[]>()
  for (const p of d.payments) paymentsBySale.set(p.saleId, [...(paymentsBySale.get(p.saleId) ?? []), p])
  const clients = new Map(d.clients.map((c) => [c.id, c.name]))
  for (const s of d.sales) {
    if (s.status !== 'ativa' || s.deletedAt !== null) continue
    const b = saleBalance(s, paymentsBySale.get(s.id) ?? [], today)
    for (const i of b.installments) {
      if (i.openCents <= 0 || i.due > limit) continue
      const late = i.due < today
      out.push({
        id: `parcela:${s.id}:${i.index}`,
        kind: 'parcela',
        title: `Receber ${formatMoney(i.openCents)} · ${clients.get(s.clientId) ?? 'cliente'}`,
        detail: `Parcela ${i.index + 1}/${b.installments.length} · venda nº ${formatSaleNumber(s.number)}${i.paidCents > 0 ? ` · já recebido ${formatMoney(i.paidCents)}` : ''}`,
        date: i.due,
        responsible: null,
        status: late ? 'atrasada' : 'pendente',
        group: late ? 'atrasadas' : i.due === today ? 'hoje' : 'proximos',
        to: `/vendas/${s.id}`,
      })
    }
  }
  const pastureName = new Map(d.pastures.filter(alive).map((p) => [p.id, p.name]))
  // próxima vacinação programada (enquanto a próxima não for registrada)
  const people = new Map((d.responsibles ?? []).map((r) => [r.id, r.name]))
  for (const v of (d.vaccinations ?? []).filter(alive)) {
    if (!v.nextDate || v.followUpId || v.nextDate > limit) continue
    const late = v.nextDate < today
    out.push({
      id: `vacina:${v.id}`,
      kind: 'vacina',
      title: `Vacinação: ${v.vaccine}`,
      detail: `${lotLabel(pastureName.get(v.pastureId) ?? 'pasto', v.lot)} · próxima dose`,
      date: v.nextDate,
      responsible: v.responsibleId ? (people.get(v.responsibleId) ?? null) : null,
      status: late ? 'atrasada' : 'pendente',
      group: late ? 'atrasadas' : v.nextDate === today ? 'hoje' : 'proximos',
      to: `/vacinacao/${v.id}`,
    })
  }
  // manutenção programada por data
  for (const p of (d.maintenancePlans ?? []).filter((x) => x.active && x.deletedAt === null)) {
    const eq = d.equipments.find((e) => e.id === p.equipmentId && e.deletedAt === null)
    if (!eq) continue
    const st = planStatus(p, d.maintenanceRecords ?? [], null, today)
    if (!st.nextDate || st.nextDate > limit) continue
    const late = st.nextDate < today
    out.push({
      id: `manut:${p.id}`,
      kind: 'manutencao',
      title: `Manutenção: ${p.name}`,
      detail: eq.name,
      date: st.nextDate,
      responsible: eq.responsibleId ? (people.get(eq.responsibleId) ?? null) : null,
      status: late ? 'atrasada' : 'pendente',
      group: late ? 'atrasadas' : st.nextDate === today ? 'hoje' : 'proximos',
      to: `/maquinas/${eq.id}`,
    })
  }
  for (const t of d.tasks.filter(alive)) {
    const pasture = t.pastureId ? pastureName.get(t.pastureId) : null
    if (t.pastureId && !pasture) continue // pasto arquivado
    const doneToday = t.done && t.doneAt !== null && t.doneAt.slice(0, 10) === today
    if (t.done && !doneToday) continue
    if (!t.done && t.dueDate && t.dueDate > limit) continue // prazo longe: fica só na aba Tarefas
    const late = !t.done && !!t.dueDate && t.dueDate < today
    out.push({
      id: `tarefa:${t.id}`,
      kind: 'tarefa',
      title: `${t.priority === 'alta' ? '⚑ ' : ''}${t.description}`,
      detail: `${pasture ? `Serviço no ${pasture}` : 'Tarefa'}${t.notes ? ` · ${t.notes}` : ''}`,
      date: t.dueDate ?? null,
      responsible: t.responsibleId ? (people.get(t.responsibleId) ?? null) : null,
      status: t.done ? 'concluida' : late ? 'atrasada' : 'pendente',
      group: t.done ? 'concluidas' : !t.dueDate ? 'sem-data' : late ? 'atrasadas' : t.dueDate === today ? 'hoje' : 'proximos',
      to: '/tarefas',
      taskId: t.id,
    })
  }
  const order: Record<AgendaGroup, number> = { atrasadas: 0, hoje: 1, proximos: 2, 'sem-data': 3, concluidas: 4 }
  return out.sort((a, b) => order[a.group] - order[b.group] || (a.date ?? '').localeCompare(b.date ?? '') || a.title.localeCompare(b.title, 'pt-BR'))
}

// ------------------------------------------------------------------ Atividades recentes

export interface Activity {
  id: string
  at: string
  icon: IconName
  text: string
  to: string | null
}

type Rec = Record<string, unknown> & { id: string; farmId?: string }

/** Descreve registros criados (e serviços concluídos) a partir do histórico de alterações. */
export function recentActivities(audit: readonly AuditEntry[], d: Pick<DashboardData, 'farm' | 'pastures' | 'clients' | 'supplies' | 'equipments'>, max = 6): Activity[] {
  const pastures = new Map(d.pastures.map((p) => [p.id, p.name]))
  const clients = new Map(d.clients.map((c) => [c.id, c.name]))
  const supplies = new Map(d.supplies.map((s) => [s.id, s.name]))
  const units = new Map(d.supplies.map((s) => [s.id, unitOf(s)]))
  const equipments = new Map(d.equipments.map((e) => [e.id, e.name]))
  const seen = new Set<string>()
  const out: Activity[] = []
  for (const a of [...audit].sort((x, y) => y.at.localeCompare(x.at))) {
    if (out.length >= max) break
    const r = (a.after ?? null) as Rec | null
    if (!r || r.farmId !== d.farm.id) continue
    let act: Omit<Activity, 'id' | 'at'> | null = null
    if (a.action === 'create') {
      switch (a.entity) {
        case 'movements': {
          const type = r.type as keyof typeof MOVEMENT_INFO
          const info = MOVEMENT_INFO[type]
          if (info && type !== 'venda') act = { icon: info.icon, text: `Rebanho: ${info.label.toLowerCase()}`, to: `/rebanho/movimentacao/${r.id}` }
          break
        }
        case 'sales':
          act = { icon: 'tag', text: `Venda nº ${formatSaleNumber(r.number as number)} · ${clients.get(r.clientId as string) ?? 'cliente'} · ${formatMoney(r.totalCents as number)}`, to: `/vendas/${r.id}` }
          break
        case 'payments':
          act = { icon: 'cash', text: `Recebimento de ${formatMoney(r.amountCents as number)} · ${clients.get(r.clientId as string) ?? 'cliente'}`, to: `/vendas/${r.saleId}` }
          break
        case 'reserveEntries':
          act = { icon: 'vault', text: `Reserva: ${r.type === 'deposito' ? 'depósito' : 'retirada'} de ${formatMoney(r.amountCents as number)}`, to: '/reserva' }
          break
        case 'supplyMovements': {
          if (r.operationId) break
          const key = (r.batchId as string | null) ?? r.id
          if (seen.has(key)) break
          seen.add(key)
          const amount = Math.abs(((r.qty as number | null) ?? (r.halfSacks as number)) || 0)
          const unit = units.get(r.supplyId as string) ?? 'saco'
          const halves = amount
          const label = r.type === 'compra' ? 'compra' : r.type === 'consumo' ? `cocho · ${pastures.get(r.pastureId as string) ?? 'pasto'}` : r.type === 'mistura' ? 'mistura feita' : 'ajuste'
          act = { icon: 'sack', text: `${supplies.get(r.supplyId as string) ?? 'Insumo'}: ${label} · ${formatQty(amount, unit)}`, to: `/insumos/${r.supplyId}` }
          if (r.type === 'mistura') act.text = `Mistura feita · ${formatSacks(halves)}`
          break
        }
        case 'fuelMovements': {
          if (r.operationId) break
          const l = formatLiters(Math.abs(r.centiliters as number))
          act = { icon: 'fuel', text: r.type === 'compra' ? `Diesel: compra de ${l}` : r.type === 'consumo' ? `Diesel: ${l} · ${equipments.get(r.equipmentId as string) ?? 'equipamento'}` : `Diesel: ajuste de ${l}`, to: '/diesel' }
          break
        }
        case 'pastureTasks':
          act = { icon: 'clipboard', text: `Serviço anotado · ${r.description as string}`, to: `/pastos/${r.pastureId}` }
          break
        case 'vaccinations':
          act = { icon: 'syringe', text: `Vacinação: ${r.vaccine as string} · ${pastures.get(r.pastureId as string) ?? 'pasto'}`, to: `/vacinacao/${r.id}` }
          break
        case 'vaccinationApplications':
          act = { icon: 'syringe', text: `Vacinados: ${r.quantity as number} animal(is)`, to: `/vacinacao/${r.vaccinationId}` }
          break
        case 'fieldOperations':
          act = { icon: 'pasture', text: `Operação de campo nº ${String(r.number).padStart(4, '0')} · ${pastures.get(r.pastureId as string) ?? 'pasto'} · ${formatMoney(r.totalCents as number)}`, to: `/manejo/${r.id}` }
          break
        case 'pastures':
          act = { icon: 'pasture', text: `Pasto cadastrado · ${r.name as string}`, to: `/pastos/${r.id}` }
          break
        case 'clients':
          act = { icon: 'people', text: `Cliente cadastrado · ${r.name as string}`, to: `/clientes/${r.id}` }
          break
      }
    } else if (a.action === 'update' && a.entity === 'pastureTasks' && r.done === true && (a.before as Rec | null)?.done === false) {
      act = { icon: 'check', text: `Serviço concluído · ${r.description as string}`, to: `/pastos/${r.pastureId}` }
    }
    if (act) out.push({ id: a.id, at: a.at, ...act })
  }
  return out
}
