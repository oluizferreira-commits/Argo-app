import { useState } from 'react'
import { Link } from 'react-router'
import { formatMoney } from '../../core/money'
import type { FieldOperationType } from '../../db/types'
import { Icon } from '../../components/Icon'
import { formatLiters } from '../diesel/fuel'
import { formatQty } from '../insumos/supplies'
import { formatDay, todayLocal } from '../rebanho/herd'
import { OperationList } from './ManejoPage'
import { EMPTY_FILTER, manejoStats } from './manejoStats'
import { currentGrass, formatHa, formatHours, isFormation, OPERATION_TYPES } from './operations'
import { useManejo } from './useManejo'

type Period = 'tudo' | '12m' | 'ano'

/** Seção do pasto: espécie plantada, histórico de operações e custo acumulado (formação e manutenção). */
export function PastureManejo({ pastureId }: { pastureId: string }) {
  const data = useManejo()
  const [type, setType] = useState<FieldOperationType | ''>('')
  const [period, setPeriod] = useState<Period>('tudo')
  if (!data) return null
  const today = todayLocal()
  const start = period === 'ano' ? `${today.slice(0, 4)}-01-01` : period === '12m' ? `${String(Number(today.slice(0, 4)) - 1)}${today.slice(4)}` : null
  const pasture = data.pastureById.get(pastureId)
  const st = manejoStats(data.operations, data.supplies, data.supplyMovements, data.pastures, today, { ...EMPTY_FILTER, pastureId, type, start })
  const c = st.pastures[0]
  const grass = currentGrass(data.operations, pastureId)
  const history = data.operations.filter((o) => o.pastureId === pastureId && (!type || o.type === type) && (!start || o.date >= start))
  const people = [...new Set(st.operations.flatMap((o) => [o.responsibleId, ...o.equipments.map((e) => e.responsibleId)]).filter((x): x is string => Boolean(x)))].map((id) => data.personById.get(id) ?? '—')
  const formation = st.operations.filter((o) => isFormation(o.type)).reduce((a, o) => a + o.totalCents, 0)

  return (
    <>
      <h2 className="section-title">Manejo, Formação e Custos</h2>
      <div className="card stack" data-testid="pasture-manejo">
        <div className="chips chips-wrap" role="group" aria-label="Período">
          {(
            [
              ['tudo', 'Todo o histórico'],
              ['12m', 'Últimos 12 meses'],
              ['ano', 'Este ano'],
            ] as const
          ).map(([k, t]) => (
            <button key={k} type="button" className={`chip${period === k ? ' active' : ''}`} onClick={() => setPeriod(k)}>
              {t}
            </button>
          ))}
        </div>
        <div className="chips chips-wrap" role="group" aria-label="Tipo de operação">
          <button type="button" className={`chip${type === '' ? ' active' : ''}`} onClick={() => setType('')}>
            Todas
          </button>
          {OPERATION_TYPES.map((t) => (
            <button key={t.id} type="button" className={`chip${type === t.id ? ' active' : ''}`} onClick={() => setType(t.id)}>
              {t.short}
            </button>
          ))}
        </div>
        {(type || period !== 'tudo') && (
          <p className="muted" style={{ margin: 0, fontSize: 14 }} data-testid="pasture-filter-note">
            Valores abaixo só do filtro selecionado.
          </p>
        )}
        <dl className="kv">
          <dt>Capim plantado</dt>
          <dd data-testid="pasture-grass">{grass ? `${grass.text} (${formatDay(grass.date)})` : 'Nenhum plantio registrado'}</dd>
          <dt>Custo acumulado</dt>
          <dd data-testid="pasture-total">{formatMoney(c?.totalCents ?? 0)}</dd>
          <dt>Formação (plantio e replantio)</dt>
          <dd>{formatMoney(formation)}</dd>
          <dt>Manutenção (herbicida, recuperação, outras)</dt>
          <dd>{formatMoney((c?.totalCents ?? 0) - formation)}</dd>
          <dt>Custo por hectare do pasto</dt>
          <dd data-testid="pasture-perha">{pasture?.areaHa ? formatMoney(Math.round((c?.totalCents ?? 0) / pasture.areaHa)) : 'informe a área do pasto'}</dd>
        </dl>
        {c && (
          <dl className="kv" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <dt>Herbicidas e produtos</dt>
            <dd>{formatMoney(c.herbicideCents)}</dd>
            <dt>Sementes</dt>
            <dd>{formatMoney(c.seedsCents)}</dd>
            <dt>Diesel</dt>
            <dd>
              {formatLiters(st.machines.dieselCl)} · {formatMoney(c.dieselCents)}
            </dd>
            <dt>Outros custos</dt>
            <dd>{formatMoney(c.otherCents)}</dd>
            <dt>Área trabalhada (soma)</dt>
            <dd>{formatHa(st.machines.workedCentiHa)}</dd>
            {st.herbicides.byProduct.length > 0 && (
              <>
                <dt>Produtos usados</dt>
                <dd>{st.herbicides.byProduct.map((x) => `${x.supply?.name} ${formatQty(x.qty, x.supply?.unit ?? 'L')}`).join(' · ')}</dd>
              </>
            )}
            {st.seeds.byGrass.length > 0 && (
              <>
                <dt>Sementes usadas</dt>
                <dd>{st.seeds.byGrass.map((x) => `${x.key.split('|').filter(Boolean).join(' ')} ${(x.qty / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`).join(' · ')}</dd>
              </>
            )}
            {st.machines.byEquipment.length > 0 && (
              <>
                <dt>Equipamentos</dt>
                <dd>{st.machines.byEquipment.map((e) => `${e.name}${e.hours ? ` ${formatHours(e.hours)}` : ''}`).join(' · ')}</dd>
              </>
            )}
            {people.length > 0 && (
              <>
                <dt>Responsáveis</dt>
                <dd>{[...new Set(people)].join(' · ')}</dd>
              </>
            )}
          </dl>
        )}
      </div>
      <OperationList ops={history} pastureName={() => pasture?.name ?? ''} showCanceled />
      <Link to={`/manejo/nova?pasto=${pastureId}`} className="btn btn-outline btn-block" data-testid="pasture-new-op">
        <Icon name="plus" /> Nova operação neste pasto
      </Link>
    </>
  )
}
