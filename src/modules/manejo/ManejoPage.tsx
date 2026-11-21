import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import type { FieldOperation } from '../../db/types'
import { formatMoney } from '../../core/money'
import { Icon } from '../../components/Icon'
import { formatLiters } from '../diesel/fuel'
import { useFarm } from '../fazendas/FarmContext'
import { formatQty } from '../insumos/supplies'
import { formatDay, todayLocal } from '../rebanho/herd'
import { manejoReport } from '../relatorios/reports'
import { saveFile } from '../../platform/files'
import { EMPTY_FILTER, grassKey, grassLabel, manejoStats, type ManejoFilter } from './manejoStats'
import { costPerHa, formatHa, formatHours, OPERATION_TYPES, productsText, typeLabel } from './operations'
import { useManejo } from './useManejo'

type PeriodKind = 'tudo' | 'mes' | 'ano' | 'datas'

function Kpi({ label, value, detail, testId }: { label: string; value: string; detail?: string; testId?: string }) {
  return (
    <div className="kpi" data-testid={testId}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {detail && <span className="kpi-detail">{detail}</span>}
    </div>
  )
}

const kg = (g: number) => `${(g / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`

export function ManejoPage() {
  const data = useManejo()
  const { farm } = useFarm()
  const today = todayLocal()
  const [period, setPeriod] = useState<PeriodKind>('tudo')
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`)
  const [to, setTo] = useState(today)
  const [f, setF] = useState<Omit<ManejoFilter, 'start' | 'end'>>({ pastureId: '', type: '', equipmentId: '', supplyId: '', grass: '' })
  const [busy, setBusy] = useState(false)
  const range = period === 'mes' ? { start: `${today.slice(0, 7)}-01`, end: today } : period === 'ano' ? { start: `${today.slice(0, 4)}-01-01`, end: today } : period === 'datas' ? { start: from, end: to } : { start: null, end: null }
  const filter: ManejoFilter = { ...EMPTY_FILTER, ...f, ...range }
  const fkey = JSON.stringify(filter)
  const st = useMemo(() => (data ? manejoStats(data.operations, data.supplies, data.supplyMovements, data.pastures, today, JSON.parse(fkey) as ManejoFilter) : null), [data, today, fkey])
  if (!data || !st) return null

  const grasses = [...new Set(data.operations.flatMap((o) => o.products.filter((p) => p.category === 'semente').map((p) => grassKey(p.species, p.cultivar))))]
  const usedSupplies = [...new Set(data.operations.flatMap((o) => o.products.map((p) => p.supplyId)))].map((id) => data.supplyById.get(id)).filter((s) => s !== undefined)
  const pastures = data.pastures.filter((p) => p.deletedAt === null).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))
  const anyFilter = period !== 'tudo' || Object.values(f).some(Boolean)

  const filterText = [
    period === 'mes' ? 'mês atual' : period === 'ano' ? 'ano atual' : period === 'datas' ? `${formatDay(from)} a ${formatDay(to)}` : 'todo o período',
    f.pastureId && `pasto ${data.pastureById.get(f.pastureId)?.name}`,
    f.type && typeLabel(f.type),
    f.equipmentId && `equipamento ${data.equipmentById.get(f.equipmentId)?.name}`,
    f.supplyId && `produto ${data.supplyById.get(f.supplyId)?.name}`,
    f.grass && grassLabel(f.grass),
  ]
    .filter(Boolean)
    .join(' · ')

  async function exportPdf() {
    setBusy(true)
    try {
      const { buildReportsPdf } = await import('../relatorios/pdf')
      const report = manejoReport(
        { farm, pastures: data!.pastures, movements: [], sales: [], payments: [], clients: [], reserveEntries: [], fieldOperations: data!.operations, supplies: data!.supplies, supplyMovements: data!.supplyMovements, responsibles: data!.responsibles, today },
        null,
        filter,
        filterText,
      )
      const blob = await buildReportsPdf([report], { farmName: farm.name, periodLabel: filterText })
      await saveFile(`argo-manejo-${today}.pdf`, blob, 'application/pdf')
    } finally {
      setBusy(false)
    }
  }

  const sel = (id: string, label: string, value: string, onChange: (v: string) => void, options: { v: string; t: string }[]) => (
    <div className="field" style={{ margin: 0, flex: 1, minWidth: 140 }}>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Todos</option>
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.t}
          </option>
        ))}
      </select>
    </div>
  )

  return (
    <>
      <h2 className="section-title" style={{ marginTop: 0 }}>
        Nova operação de campo
      </h2>
      <div className="quick-ops">
        {OPERATION_TYPES.map((t) => (
          <Link key={t.id} to={`/manejo/nova?tipo=${t.id}`} className="btn btn-outline" data-testid={`new-op-${t.id}`}>
            <Icon name={t.id === 'herbicida' ? 'syringe' : t.id === 'outra' ? 'gear' : 'pasture'} size={20} /> {t.short}
          </Link>
        ))}
      </div>
      <div className="row">
        <Link to="/insumos?cat=herbicida" className="btn btn-outline" style={{ flex: 1 }}>
          Herbicidas
        </Link>
        <Link to="/insumos?cat=semente" className="btn btn-outline" style={{ flex: 1 }}>
          Sementes
        </Link>
      </div>

      <h2 className="section-title">Filtros</h2>
      <div className="card stack" data-testid="manejo-filters">
        <div className="chips chips-wrap" role="group" aria-label="Período">
          {(
            [
              ['tudo', 'Tudo'],
              ['mes', 'Este mês'],
              ['ano', 'Este ano'],
              ['datas', 'Entre datas'],
            ] as const
          ).map(([k, t]) => (
            <button key={k} type="button" className={`chip${period === k ? ' active' : ''}`} onClick={() => setPeriod(k)}>
              {t}
            </button>
          ))}
        </div>
        {period === 'datas' && (
          <div className="row">
            <input type="date" className="input" aria-label="De" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" className="input" aria-label="Até" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        )}
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {sel('mf-pasto', 'Pasto', f.pastureId, (v) => setF({ ...f, pastureId: v }), pastures.map((p) => ({ v: p.id, t: p.name })))}
          {sel('mf-tipo', 'Tipo', f.type, (v) => setF({ ...f, type: v as ManejoFilter['type'] }), OPERATION_TYPES.map((t) => ({ v: t.id, t: t.short })))}
          {sel('mf-eq', 'Equipamento', f.equipmentId, (v) => setF({ ...f, equipmentId: v }), data.equipments.filter((e) => e.deletedAt === null).map((e) => ({ v: e.id, t: e.name })))}
          {sel('mf-prod', 'Produto', f.supplyId, (v) => setF({ ...f, supplyId: v }), usedSupplies.map((s) => ({ v: s.id, t: s.name })))}
          {sel('mf-grass', 'Espécie / cultivar', f.grass, (v) => setF({ ...f, grass: v }), grasses.map((g) => ({ v: g, t: grassLabel(g) })))}
        </div>
        {anyFilter && (
          <button
            type="button"
            className="btn btn-outline btn-block"
            onClick={() => {
              setPeriod('tudo')
              setF({ pastureId: '', type: '', equipmentId: '', supplyId: '', grass: '' })
            }}
          >
            Limpar filtros
          </button>
        )}
        <button type="button" className="btn btn-gold btn-block" onClick={() => void exportPdf()} disabled={busy} data-testid="manejo-pdf">
          <Icon name="download" /> {busy ? 'Gerando PDF…' : 'Relatório em PDF (com estes filtros)'}
        </button>
      </div>

      <h2 className="section-title">Herbicidas</h2>
      <div className="kpi-grid" data-testid="kpi-herb">
        <Kpi label="Gasto total" value={formatMoney(st.herbicides.totalCents)} detail="consumido nas operações" />
        <Kpi label="Gasto no mês" value={formatMoney(st.herbicides.monthCents)} />
        <Kpi label="Estoque disponível" value={formatMoney(st.herbicides.stockValueCents)} detail={st.herbicides.stock.map((x) => `${x.supply.name} ${formatQty(x.qty, x.supply.unit ?? 'L')}`).join(' · ') || 'nenhum produto'} />
        <Kpi label="Consumo por produto" value={String(st.herbicides.byProduct.length)} detail={st.herbicides.byProduct.map((x) => `${x.supply?.name} ${formatQty(x.qty, x.supply?.unit ?? 'L')} · ${formatMoney(x.cents)}`).join(' · ') || '—'} />
      </div>

      <h2 className="section-title">Sementes</h2>
      <div className="kpi-grid" data-testid="kpi-seeds">
        <Kpi label="Valor em estoque" value={formatMoney(st.seeds.stockValueCents)} detail={st.seeds.stock.map((x) => `${x.supply.name} ${kg(x.qty)}`).join(' · ') || 'nenhuma semente'} />
        <Kpi label="Compradas" value={kg(st.seeds.kgBought)} detail={formatMoney(st.seeds.boughtCents)} />
        <Kpi label="Utilizadas" value={kg(st.seeds.kgUsed)} detail={st.seeds.byGrass.map((x) => `${grassLabel(x.key)} · ${formatMoney(x.cents)}`).join(' · ') || '—'} />
        <Kpi label="Hectares plantados" value={formatHa(st.seeds.plantedCentiHa)} detail="plantio e replantio" />
      </div>

      <h2 className="section-title">Operações e máquinas</h2>
      <div className="kpi-grid" data-testid="kpi-machines">
        <Kpi label="Operações" value={String(st.machines.operations)} detail={`${formatHa(st.machines.workedCentiHa)} trabalhados`} />
        <Kpi label="Diesel" value={formatLiters(st.machines.dieselCl)} detail={formatMoney(st.machines.dieselCents)} />
        <Kpi label="Horas de máquina" value={formatHours(st.machines.hoursTenths)} detail={st.machines.byEquipment.map((e) => `${e.name} ${formatHours(e.hours)}`).join(' · ') || '—'} />
        <Kpi label="Custo total" value={formatMoney(st.totalCents)} detail="produtos + sementes + diesel + outros" testId="kpi-manejo-total" />
      </div>

      <h2 className="section-title">Custo por pasto</h2>
      {st.pastures.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            Nenhuma operação {anyFilter ? 'com estes filtros' : 'registrada'}.
          </p>
        </div>
      ) : (
        <div className="card pasture-list" data-testid="pasture-costs">
          {st.pastures.map((c) => (
            <Link key={c.pastureId} to={`/pastos/${c.pastureId}`} className="vacc-item">
              <span className="vacc-head">
                <span className="pasture-name">{c.name}</span>
                <strong>{formatMoney(c.totalCents)}</strong>
              </span>
              <span className="pasture-area">
                {[
                  c.herbicideCents && `herbicidas ${formatMoney(c.herbicideCents)}`,
                  c.seedsCents && `sementes ${formatMoney(c.seedsCents)}`,
                  c.dieselCents && `diesel ${formatMoney(c.dieselCents)}`,
                  c.otherCents && `outros ${formatMoney(c.otherCents)}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <span className="vacc-next">
                {c.formationCents ? `Formação ${formatMoney(c.formationCents)} · ` : ''}
                {c.perHaCents !== null ? `${formatMoney(c.perHaCents)}/ha do pasto` : 'área do pasto não informada'}
              </span>
            </Link>
          ))}
        </div>
      )}

      <h2 className="section-title">Operações ({st.operations.length})</h2>
      <OperationList ops={st.operations} pastureName={(id) => data.pastureById.get(id)?.name ?? 'pasto removido'} />
      {data.operations.some((o) => o.status === 'cancelada') && (
        <p className="muted" style={{ margin: '0 4px', fontSize: 13 }}>
          Operações canceladas ficam no histórico do pasto e não entram nos custos.
        </p>
      )}
    </>
  )
}

export function OperationList({ ops, pastureName, showCanceled }: { ops: FieldOperation[]; pastureName: (id: string) => string; showCanceled?: boolean }) {
  if (ops.length === 0)
    return (
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          Nenhuma operação.
        </p>
      </div>
    )
  return (
    <div className="card pasture-list" data-testid="operation-list">
      {ops.map((o) => (
        <Link key={o.id} to={`/manejo/${o.id}`} className={`vacc-item${o.status === 'cancelada' ? ' reversed' : ''}`} data-testid="operation-item">
          <span className="vacc-head">
            <span className="pasture-name">
              {typeLabel(o.type)} · {pastureName(o.pastureId)}
            </span>
            <strong>{formatMoney(o.totalCents)}</strong>
          </span>
          <span className="pasture-area">
            {formatDay(o.date)} · nº {String(o.number).padStart(4, '0')} · {formatHa(o.workedAreaCentiHa)} · {formatMoney(costPerHa(o))}/ha
            {showCanceled && o.status === 'cancelada' ? ' · cancelada' : ''}
          </span>
          {o.products.length > 0 && <span className="vacc-next">{productsText(o)}</span>}
        </Link>
      ))}
    </div>
  )
}
