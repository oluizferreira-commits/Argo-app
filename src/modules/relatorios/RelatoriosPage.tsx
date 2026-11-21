import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { db } from '../../db/database'
import { Icon } from '../../components/Icon'
import { saveFile } from '../../platform/files'
import { useFarm } from '../fazendas/FarmContext'
import { todayLocal } from '../rebanho/herd'
import { buildReports, MONTHS, periodLabel, REPORTS, type Period, type Report, type ReportId } from './reports'

export function RelatoriosPage() {
  // ?r=diesel abre só aquele relatório (atalho de outras telas); trocar o filtro recria a tela
  const [params] = useSearchParams()
  const only = REPORTS.find((r) => r.id === params.get('r'))?.id
  return <Relatorios key={only ?? 'todos'} only={only} />
}

function Relatorios({ only }: { only: ReportId | undefined }) {
  const { farm } = useFarm()
  const today = todayLocal()
  const thisYear = Number(today.slice(0, 4))
  const [kind, setKind] = useState<'mes' | 'ano'>('mes')
  const [year, setYear] = useState(thisYear)
  const [month, setMonth] = useState(Number(today.slice(5, 7)))
  const [selected, setSelected] = useState<ReportId[]>(only ? [only] : REPORTS.map((r) => r.id))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const data = useLiveQuery(async () => {
    const [pastures, movements, sales, payments, clients, reserveEntries, fuelMovements, equipments, responsibles, fieldOperations, supplies, supplyMovements] = await Promise.all([
      db.pastures.where('farmId').equals(farm.id).toArray(),
      db.movements.where('farmId').equals(farm.id).toArray(),
      db.sales.where('farmId').equals(farm.id).toArray(),
      db.payments.where('farmId').equals(farm.id).toArray(),
      db.clients.where('farmId').equals(farm.id).toArray(),
      db.reserveEntries.where('farmId').equals(farm.id).toArray(),
      db.fuelMovements.where('farmId').equals(farm.id).toArray(),
      db.equipments.where('farmId').equals(farm.id).toArray(),
      db.responsibles.where('farmId').equals(farm.id).toArray(),
      db.fieldOperations.where('farmId').equals(farm.id).toArray(),
      db.supplies.where('farmId').equals(farm.id).toArray(),
      db.supplyMovements.where('farmId').equals(farm.id).toArray(),
    ])
    return { farm, pastures, movements, sales, payments, clients, reserveEntries, fuelMovements, equipments, responsibles, fieldOperations, supplies, supplyMovements }
  }, [farm])

  const period: Period = kind === 'ano' ? { kind, year } : { kind, year, month }
  const reports = useMemo(() => (data ? buildReports(selected, data, period) : []), [data, selected, kind, year, month]) // eslint-disable-line react-hooks/exhaustive-deps

  // anos disponíveis: do primeiro lançamento até o ano atual
  const firstYear = useMemo(() => {
    if (!data) return thisYear
    const dates = [...data.movements.map((m) => m.date), ...data.sales.map((s) => s.date), ...data.payments.map((p) => p.date), ...data.fuelMovements.map((f) => f.date), ...data.fieldOperations.map((o) => o.date)]
    return dates.length ? Math.min(thisYear, ...dates.map((d) => Number(d.slice(0, 4)))) : thisYear
  }, [data, thisYear])
  const years = Array.from({ length: thisYear - firstYear + 1 }, (_, i) => thisYear - i)

  async function exportPdf() {
    setBusy(true)
    setMsg(null)
    try {
      const { buildReportsPdf } = await import('./pdf')
      const blob = await buildReportsPdf(reports, { farmName: farm.name, periodLabel: periodLabel(period) })
      const tag = kind === 'ano' ? `${year}` : `${year}-${String(month).padStart(2, '0')}`
      await saveFile(`argo-relatorio-${tag}.pdf`, blob, 'application/pdf')
    } catch (e) {
      setMsg({ kind: 'error', text: `Não foi possível gerar o PDF: ${(e as Error).message}` })
    } finally {
      setBusy(false)
    }
  }

  if (!data) return null

  return (
    <>
      <div className="card stack">
        <div className="chips">
          <button type="button" className={`chip${kind === 'mes' ? ' active' : ''}`} onClick={() => setKind('mes')}>
            Mês
          </button>
          <button type="button" className={`chip${kind === 'ano' ? ' active' : ''}`} onClick={() => setKind('ano')}>
            Ano
          </button>
        </div>
        <div className="row">
          {kind === 'mes' && (
            <select className="input" aria-label="Mês" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </option>
              ))}
            </select>
          )}
          <select className="input" aria-label="Ano" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="label">Relatórios</div>
          {REPORTS.map((r) => (
            <label key={r.id} className="row" style={{ gap: 10, padding: '6px 0' }}>
              <input
                type="checkbox"
                checked={selected.includes(r.id)}
                onChange={(e) => setSelected(e.target.checked ? REPORTS.map((x) => x.id).filter((id) => id === r.id || selected.includes(id)) : selected.filter((id) => id !== r.id))}
                style={{ width: 22, height: 22, accentColor: 'var(--green-700)' }}
              />
              <span>{r.title}</span>
            </label>
          ))}
        </div>
        <button className="btn btn-gold btn-block" onClick={exportPdf} disabled={busy || selected.length === 0} data-testid="export-pdf">
          <Icon name="download" /> {busy ? 'Gerando PDF…' : `Gerar PDF · ${periodLabel(period)}`}
        </button>
        {msg && (
          <div className={`notice notice-${msg.kind}`} role="status">
            <Icon name="alert" />
            <div>{msg.text}</div>
          </div>
        )}
      </div>

      {reports.map((r) => (
        <ReportView key={r.id} report={r} />
      ))}
    </>
  )
}

function ReportView({ report: r }: { report: Report }) {
  return (
    <section className="stack" data-testid={`report-${r.id}`}>
      <h2 className="section-title">{r.title}</h2>
      <div className="card stack">
        <div className="report-summary">
          {r.summary.map((s) => (
            <div key={s.label}>
              <div className="status-detail">{s.label}</div>
              <div className="num" style={{ fontSize: 18, color: 'var(--green-900)' }}>
                {s.value}
              </div>
            </div>
          ))}
        </div>
        {r.empty ? (
          <p className="muted">{r.empty}</p>
        ) : (
          r.tables
            .filter((t) => t.rows.length > 0)
            .map((t, i) => (
              <div key={i}>
                {t.title && <div className="group-title">{t.title}</div>}
                <div className="report-table-wrap">
                  <table className="report-table">
                    <thead>
                      <tr>
                        {t.columns.map((c) => (
                          <th key={c.label} style={{ textAlign: c.align ?? 'left' }}>
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {t.rows.map((row, ri) => (
                        <tr key={ri}>
                          {row.map((cell, ci) => (
                            <td key={ci} style={{ textAlign: t.columns[ci]?.align ?? 'left' }}>
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    {t.foot && (
                      <tfoot>
                        <tr>
                          {t.foot.map((cell, ci) => (
                            <td key={ci} style={{ textAlign: t.columns[ci]?.align ?? 'left' }}>
                              {cell}
                            </td>
                          ))}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            ))
        )}
        {r.notes.map((n) => (
          <p key={n} className="muted" style={{ fontSize: 13 }}>
            {n}
          </p>
        ))}
      </div>
    </section>
  )
}
