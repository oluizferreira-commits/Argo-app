import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { newId } from '../../core/ids'
import { db } from '../../db/database'
import type { Vaccination } from '../../db/types'
import { Icon } from '../../components/Icon'
import { useFarm } from '../fazendas/FarmContext'
import { pastureTotal, todayLocal } from '../rebanho/herd'
import { useBalances, usePastures } from '../rebanho/useHerd'
import { useResponsibles } from '../responsaveis/useResponsibles'
import { CoverageBar } from './CoverageBar'
import { useVaccinations } from './useVaccinations'
import { coverageOf, createVaccination, VaccinationError } from './vaccination'

/** Nomes comuns, só como sugestão ao digitar (o usuário escreve o que quiser). */
const SUGGESTIONS = ['Aftosa', 'Brucelose', 'Raiva', 'Clostridiose', 'Carbúnculo', 'Leptospirose', 'IBR/BVD']

const toInt = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN)

export function NovaVacinacaoPage() {
  const { farm } = useFarm()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const pastures = usePastures()
  const { balances } = useBalances()
  const responsibles = (useResponsibles() ?? []).filter((r) => r.active)
  const data = useVaccinations()
  if (!pastures || !data) return null
  // ?de=<id>: próxima vacinação (reforço) a partir de uma campanha anterior
  const from = data.rows.find((r) => r.v.id === params.get('de'))?.v
  return <Form key={from?.id ?? 'nova'} farmId={farm.id} pastures={pastures} balances={balances} responsibles={responsibles} from={from} onDone={(id) => navigate(`/vacinacao/${id}`, { replace: true })} />
}

function Form({
  farmId,
  pastures,
  balances,
  responsibles,
  from,
  onDone,
}: {
  farmId: string
  pastures: NonNullable<ReturnType<typeof usePastures>>
  balances: Map<string, number>
  responsibles: { id: string; name: string }[]
  from: Vaccination | undefined
  onDone: (id: string) => void
}) {
  const [key] = useState(newId)
  const [pastureId, setPastureId] = useState(from?.pastureId ?? '')
  const [lot, setLot] = useState(from?.lot ?? '')
  const [vaccine, setVaccine] = useState(from?.vaccine ?? '')
  const [product, setProduct] = useState(from?.product ?? '')
  const [planned, setPlanned] = useState(from ? String(from.plannedQty) : '')
  const [plannedTouched, setPlannedTouched] = useState(Boolean(from))
  const [responsibleId, setResponsibleId] = useState(from?.responsibleId ?? '')
  const [applyNow, setApplyNow] = useState(true)
  const [date, setDate] = useState(todayLocal)
  const [qty, setQty] = useState('')
  const [hasNext, setHasNext] = useState(false)
  const [nextDate, setNextDate] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function choosePasture(id: string) {
    setPastureId(id)
    // sugere a quantidade de animais do pasto (pode ser corrigida: o lote pode ser parte do pasto)
    if (!plannedTouched && id) setPlanned(String(Math.max(0, pastureTotal(balances, id))))
  }

  const plannedN = toInt(planned)
  const qtyN = applyNow ? toInt(qty) : 0
  const preview = plannedN > 0 ? coverageOf(plannedN, applyNow && qtyN > 0 ? qtyN : 0) : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!(plannedN > 0)) return setError('Informe a quantidade prevista de animais.')
    if (applyNow && !(qtyN > 0)) return setError('Informe quantos animais foram vacinados (ou desmarque "Registrar a aplicação agora").')
    if (hasNext && !nextDate) return setError('Informe a data da próxima vacinação ou desmarque a opção.')
    setSaving(true)
    try {
      const v = await createVaccination(
        db,
        farmId,
        { pastureId, lot, vaccine, product, plannedQty: plannedN, responsibleId: responsibleId || null, nextDate: hasNext ? nextDate : null, notes },
        applyNow ? { date, quantity: qtyN, responsibleId: responsibleId || null, notes: '' } : null,
        key,
        from?.id,
      )
      onDone(v.id)
    } catch (err) {
      setSaving(false)
      setError(err instanceof VaccinationError ? err.message : (err as Error).message)
    }
  }

  return (
    <form onSubmit={submit} className="stack" data-testid="vaccination-form">
      {from && (
        <div className="notice notice-ok">
          <Icon name="syringe" />
          <div>
            Próxima vacinação de <strong>{from.vaccine}</strong> do mesmo lote. Os dados vieram da vacinação anterior.
          </div>
        </div>
      )}
      <div className="card stack">
        <div className="field">
          <label className="label" htmlFor="vc-pasture">
            Pasto
          </label>
          <select id="vc-pasture" className="input" value={pastureId} onChange={(e) => choosePasture(e.target.value)}>
            <option value="">Escolha o pasto</option>
            {pastures.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({pastureTotal(balances, p.id)} cab.)
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="vc-lot">
            Lote (opcional)
          </label>
          <input id="vc-lot" className="input" maxLength={60} placeholder="Ex.: Bezerras desmama — vazio = todo o pasto" value={lot} onChange={(e) => setLot(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="vc-vaccine">
            Vacina
          </label>
          <input id="vc-vaccine" className="input" list="vc-suggestions" maxLength={60} placeholder="Ex.: Aftosa" value={vaccine} onChange={(e) => setVaccine(e.target.value)} />
          <datalist id="vc-suggestions">
            {SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <div className="field">
          <label className="label" htmlFor="vc-product">
            Produto (marca / laboratório)
          </label>
          <input id="vc-product" className="input" maxLength={80} value={product} onChange={(e) => setProduct(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="vc-planned">
            Quantidade prevista (animais do lote)
          </label>
          <input
            id="vc-planned"
            className="input"
            inputMode="numeric"
            value={planned}
            onChange={(e) => {
              setPlanned(e.target.value.replace(/\D/g, ''))
              setPlannedTouched(true)
            }}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="vc-resp">
            Responsável
          </label>
          <select id="vc-resp" className="input" value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)}>
            <option value="">{responsibles.length ? 'Escolha (opcional)' : 'Nenhum cadastrado'}</option>
            {responsibles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card stack">
        <label className="row" style={{ gap: 10 }}>
          <input type="checkbox" checked={applyNow} onChange={(e) => setApplyNow(e.target.checked)} style={{ width: 22, height: 22 }} />
          <strong>Registrar a aplicação agora</strong>
        </label>
        {applyNow && (
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="field" style={{ flex: 1, margin: 0 }}>
              <label className="label" htmlFor="vc-date">
                Data da aplicação
              </label>
              <input id="vc-date" type="date" className="input" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, margin: 0 }}>
              <label className="label" htmlFor="vc-qty">
                Vacinados
              </label>
              <input id="vc-qty" className="input" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} />
            </div>
          </div>
        )}
        {preview && <CoverageBar cov={preview} />}
      </div>

      <div className="card stack">
        <label className="row" style={{ gap: 10 }}>
          <input type="checkbox" checked={hasNext} onChange={(e) => setHasNext(e.target.checked)} style={{ width: 22, height: 22 }} />
          <strong>Tem próxima vacinação (reforço)</strong>
        </label>
        {hasNext && (
          <div className="field" style={{ margin: 0 }}>
            <label className="label" htmlFor="vc-next">
              Data da próxima vacinação
            </label>
            <input id="vc-next" type="date" className="input" value={nextDate} min={todayLocal()} onChange={(e) => setNextDate(e.target.value)} />
          </div>
        )}
        <div className="field" style={{ margin: 0 }}>
          <label className="label" htmlFor="vc-notes">
            Observações
          </label>
          <textarea id="vc-notes" className="input" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      {error && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" />
          <div>{error}</div>
        </div>
      )}
      <button type="submit" className="btn btn-primary btn-block" disabled={saving || !pastureId || !vaccine.trim()}>
        <Icon name="check" /> Registrar vacinação
      </button>
    </form>
  )
}
