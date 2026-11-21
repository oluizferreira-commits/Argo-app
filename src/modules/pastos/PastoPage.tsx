import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { db } from '../../db/database'
import { CATEGORY_GROUPS } from '../../domain/categories'
import { Icon } from '../../components/Icon'
import { balanceOf, pastureTotal } from '../rebanho/herd'
import { PastureSpecificationNotice } from '../rebanho/SpecificationAlerts'
import { useFarm } from '../fazendas/FarmContext'
import { useBalances } from '../rebanho/useHerd'
import { archivePasture, formatArea, PastureError } from './pastures'
import { PastureTasks } from './PastureTasks'

export function PastoPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { farm } = useFarm()
  const pasture = useLiveQuery(() => db.pastures.get(id), [id])
  const tasks = useLiveQuery(
    async () => (await db.pastureTasks.where('pastureId').equals(id).toArray()).filter((t) => t.deletedAt === null),
    [id],
  )
  const { balances } = useBalances()
  const [error, setError] = useState<string | null>(null)

  if (pasture === undefined || tasks === undefined) return null
  if (!pasture || pasture.deletedAt !== null || pasture.farmId !== farm.id) return <div className="card empty">Pasto não encontrado ou arquivado.</div>

  const total = pastureTotal(balances, id)

  async function archive() {
    if (!window.confirm(`Arquivar o pasto "${pasture!.name}"? O histórico será mantido.`)) return
    setError(null)
    try {
      await archivePasture(db, id)
      navigate('/pastos', { replace: true })
    } catch (err) {
      setError(err instanceof PastureError ? err.message : (err as Error).message)
    }
  }

  return (
    <>
      <section className="hero">
        <div className="gold-rule" />
        <h1 style={{ fontSize: 24 }}>{pasture.name}</h1>
        <div className="row" style={{ marginTop: 14, alignItems: 'flex-end', gap: 24 }}>
          <div>
            <div className="big-number">{total.toLocaleString('pt-BR')}</div>
            <p>cabeças</p>
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{formatArea(pasture.areaHa)}</div>
            <p>
              {pasture.areaHa
                ? `${(total / pasture.areaHa).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} cab./ha`
                : 'área não informada'}
            </p>
          </div>
        </div>
      </section>

      <PastureSpecificationNotice
        pastureId={id}
        females={balanceOf(balances, id, 'femea-a-especificar')}
        males={balanceOf(balances, id, 'macho-a-especificar')}
        calves={balanceOf(balances, id, 'bezerro-a-especificar')}
      />

      <div className="row">
        <Link to={`/rebanho/movimentar/contagem?pasto=${id}`} className="btn btn-gold" style={{ flex: 1 }}>
          <Icon name="clipboard" /> Contagem
        </Link>
        <Link to="/rebanho/movimentar" className="btn btn-primary" style={{ flex: 1 }}>
          <Icon name="plus" /> Movimentar
        </Link>
      </div>

      <h2 className="section-title">Animais</h2>
      <div className="card">
        {total === 0 ? (
          <p className="muted">Nenhum animal neste pasto.</p>
        ) : (
          <div className="cat-grid">
            {CATEGORY_GROUPS.filter((g) => g.title !== 'A especificar' || g.list.some((c) => balanceOf(balances, id, c.id) > 0)).map((g) => (
              <div key={g.title}>
                <div className="group-title">{g.title}</div>
                {g.list.filter((c) => !c.unspecified || balanceOf(balances, id, c.id) > 0).map((c) => (
                  <div className="cat-line" key={c.id}>
                    <span>{c.label}</span>
                    <span className="num">{balanceOf(balances, id, c.id)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <h2 className="section-title">Serviços</h2>
      <PastureTasks pastureId={id} tasks={tasks} />

      {pasture.notes && (
        <>
          <h2 className="section-title">Observações</h2>
          <div className="card" style={{ whiteSpace: 'pre-wrap' }}>
            {pasture.notes}
          </div>
        </>
      )}

      {error && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" />
          <div>{error}</div>
        </div>
      )}

      <Link to={`/rebanho/historico?pasto=${id}`} className="btn btn-outline btn-block">
        <Icon name="list" /> Histórico deste pasto
      </Link>
      <Link to={`/pastos/${id}/editar`} className="btn btn-outline btn-block">
        <Icon name="edit" /> Editar pasto
      </Link>
      <button className="btn btn-danger btn-block" onClick={archive}>
        <Icon name="archive" /> Arquivar pasto
      </button>
    </>
  )
}
