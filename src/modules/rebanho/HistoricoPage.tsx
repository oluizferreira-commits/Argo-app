import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { MOVEMENT_INFO, MOVEMENT_TYPES, type MovementType } from '../../domain/movements'
import { sortMovements } from './describe'
import { MovementRow } from './MovementSummary'
import { useMovements, usePastureMap, usePastures } from './useHerd'

const PAGE = 50

export function HistoricoPage() {
  const [params] = useSearchParams()
  const movements = useMovements()
  const pastures = usePastures()
  const pastureMap = usePastureMap()
  const [pasture, setPasture] = useState(params.get('pasto') ?? '')
  const [type, setType] = useState<MovementType | ''>('')
  const [limit, setLimit] = useState(PAGE)
  if (!movements || !pastures) return null

  const list = sortMovements(movements).filter(
    (m) => (!pasture || m.pastureIds.includes(pasture)) && (!type || m.type === type),
  )

  return (
    <>
      <div className="card stack">
        <select className="input" value={pasture} onChange={(e) => setPasture(e.target.value)} aria-label="Filtrar por pasto">
          <option value="">Todos os pastos</option>
          {pastures.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select className="input" value={type} onChange={(e) => setType(e.target.value as MovementType | '')} aria-label="Filtrar por tipo">
          <option value="">Todos os tipos</option>
          {MOVEMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {MOVEMENT_INFO[t].label}
            </option>
          ))}
        </select>
      </div>
      <p className="muted" style={{ margin: '0 4px' }}>
        {list.length} movimentação(ões)
      </p>
      {list.length > 0 && (
        <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
          {list.slice(0, limit).map((m) => (
            <MovementRow key={m.id} m={m} pastures={pastureMap} />
          ))}
        </div>
      )}
      {list.length > limit && (
        <button className="btn btn-outline btn-block" onClick={() => setLimit(limit + PAGE)}>
          Mostrar mais
        </button>
      )}
    </>
  )
}
