import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { formatDateTime } from '../../core/format'
import { db } from '../../db/database'
import { category } from '../../domain/categories'
import { COUNT_REASONS, MOVEMENT_INFO } from '../../domain/movements'
import { Icon } from '../../components/Icon'
import { formatDay, HerdError, reverseMovement } from './herd'
import { useFarm } from '../fazendas/FarmContext'
import { usePastureMap } from './useHerd'

export function MovimentacaoPage() {
  const { id = '' } = useParams()
  const location = useLocation()
  const justSaved = (location.state as { saved?: boolean } | null)?.saved === true
  const { farm } = useFarm()
  const m = useLiveQuery(() => db.movements.get(id), [id])
  const pastures = usePastureMap()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (m === undefined) return null
  if (!m || m.farmId !== farm.id) return <div className="card empty">Movimentação não encontrada.</div>

  const info = MOVEMENT_INFO[m.type]
  const name = (pid: string) => pastures.get(pid)?.name ?? 'pasto removido'

  async function reverse() {
    const reason = window.prompt('Estornar esta movimentação?\n\nInforme o motivo (ex.: lançado errado):')
    if (reason === null) return
    setBusy(true)
    setError(null)
    try {
      await reverseMovement(db, id, reason)
    } catch (e) {
      setError(e instanceof HerdError ? e.message : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {justSaved && (
        <div className="notice notice-ok" role="status">
          <Icon name="check" />
          <div>Movimentação registrada. Os saldos já foram atualizados.</div>
        </div>
      )}

      <div className="card stack">
        <div className="row">
          <div className="status-icon">
            <Icon name={info.icon} />
          </div>
          <div className="status-body">
            <div className="status-label" style={{ fontSize: 19 }}>
              {info.label}
            </div>
            <div className="status-detail">{formatDay(m.date)}</div>
          </div>
          {m.reversedBy && <span className="badge badge-warn">Estornada</span>}
        </div>

        <div>
          {m.entries.map((e, i) => (
            <div className="cat-line" key={i}>
              <span>
                {category(e.category).label} · {name(e.pastureId)}
                {e.reason && <span className="status-detail" style={{ display: 'block' }}>{COUNT_REASONS[e.reason]}</span>}
              </span>
              <span className={`num ${e.delta > 0 ? 'delta-plus' : 'delta-minus'}`}>
                {e.delta > 0 ? '+' : '−'}
                {Math.abs(e.delta)}
              </span>
            </div>
          ))}
        </div>

        {m.type === 'especificacao' && (m.difference ?? 0) !== 0 && (
          <p>
            <span className="muted">Diferença no total: </span>
            <strong>
              {(m.difference ?? 0) > 0 ? '+' : '−'}
              {Math.abs(m.difference ?? 0)}
            </strong>
            {m.differenceReason && <span className="muted"> · {COUNT_REASONS[m.differenceReason]}</span>}
          </p>
        )}
        {m.notes && (
          <p>
            <span className="muted">Observação: </span>
            {m.notes}
          </p>
        )}
        <p className="muted" style={{ fontSize: 13 }}>
          Lançado em {formatDateTime(m.createdAt)}
        </p>
        {m.reversalOf && (
          <Link to={`/rebanho/movimentacao/${m.reversalOf}`} className="btn btn-outline btn-block">
            Ver movimentação estornada
          </Link>
        )}
        {m.reversedBy && (
          <Link to={`/rebanho/movimentacao/${m.reversedBy}`} className="btn btn-outline btn-block">
            Ver estorno
          </Link>
        )}
      </div>

      {error && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" />
          <div>{error}</div>
        </div>
      )}

      {m.saleId && (
        <Link to={`/vendas/${m.saleId}`} className="btn btn-outline btn-block">
          <Icon name="receipt" /> Ver venda
        </Link>
      )}
      {m.type !== 'estorno' && !m.reversedBy && !m.saleId && (
        <button className="btn btn-danger btn-block" onClick={reverse} disabled={busy}>
          <Icon name="undo" /> Estornar (corrigir lançamento)
        </button>
      )}
      <Link to="/rebanho" className="btn btn-outline btn-block">
        Voltar ao rebanho
      </Link>
    </>
  )
}
