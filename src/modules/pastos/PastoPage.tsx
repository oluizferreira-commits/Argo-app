import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { newId } from '../../core/ids'
import { db } from '../../db/database'
import { CATEGORIES } from '../../domain/categories'
import { Icon } from '../../components/Icon'
import { balanceOf, pastureTotal } from '../rebanho/herd'
import { useBalances } from '../rebanho/useHerd'
import { addTask, archivePasture, formatArea, PastureError, removeTask, setTaskDone } from './pastures'

export function PastoPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const pasture = useLiveQuery(() => db.pastures.get(id), [id])
  const tasks = useLiveQuery(
    async () => (await db.pastureTasks.where('pastureId').equals(id).toArray()).filter((t) => t.deletedAt === null),
    [id],
  )
  const { balances } = useBalances()
  const [taskText, setTaskText] = useState('')
  const [taskKey, setTaskKey] = useState(newId)
  const [error, setError] = useState<string | null>(null)

  if (pasture === undefined || tasks === undefined) return null
  if (!pasture || pasture.deletedAt !== null) return <div className="card empty">Pasto não encontrado ou arquivado.</div>

  const total = pastureTotal(balances, id)
  const sorted = [...tasks].sort((a, b) => Number(a.done) - Number(b.done) || b.createdAt.localeCompare(a.createdAt))

  async function submitTask(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await addTask(db, id, taskText, taskKey)
      setTaskText('')
      setTaskKey(newId())
    } catch (err) {
      setError((err as Error).message)
    }
  }

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
            {(['M', 'F'] as const).map((sex) => (
              <div key={sex}>
                <div className="group-title">{sex === 'M' ? 'Machos' : 'Fêmeas'}</div>
                {CATEGORIES.filter((c) => c.sex === sex).map((c) => (
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
      <div className="card stack">
        <form onSubmit={submitTask} className="row">
          <input
            className="input"
            value={taskText}
            maxLength={200}
            placeholder="Ex.: cerca a ser feita"
            aria-label="Novo serviço"
            onChange={(e) => setTaskText(e.target.value)}
          />
          <button type="submit" className="btn btn-primary btn-icon" style={{ minHeight: 56, width: 56 }} disabled={!taskText.trim()} aria-label="Adicionar serviço">
            <Icon name="plus" />
          </button>
        </form>
        {sorted.length === 0 ? (
          <p className="muted">Nenhum serviço anotado.</p>
        ) : (
          <div>
            {sorted.map((t) => (
              <div key={t.id} className={`task${t.done ? ' done' : ''}`}>
                <button
                  className={`task-check${t.done ? ' done' : ''}`}
                  onClick={() => setTaskDone(db, t.id, !t.done)}
                  aria-label={t.done ? 'Marcar como não feito' : 'Marcar como feito'}
                  aria-pressed={t.done}
                >
                  {t.done && <Icon name="check" size={22} />}
                </button>
                <div className="status-body">
                  <div className="task-text" style={{ overflowWrap: 'anywhere' }}>{t.description}</div>
                  <div className="status-detail">{t.done ? 'Feito' : 'A fazer'}</div>
                </div>
                <button
                  className="btn btn-danger btn-icon"
                  onClick={() => window.confirm('Remover este serviço da lista?') && removeTask(db, t.id)}
                  aria-label="Remover serviço"
                >
                  <Icon name="trash" size={20} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

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
