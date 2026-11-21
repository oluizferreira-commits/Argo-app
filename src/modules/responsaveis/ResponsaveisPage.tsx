import { useState, type FormEvent } from 'react'
import { newId } from '../../core/ids'
import { db } from '../../db/database'
import type { Responsible } from '../../db/types'
import { Icon } from '../../components/Icon'
import { useFarm } from '../fazendas/FarmContext'
import { createResponsible, ResponsibleError, setResponsibleActive, updateResponsible } from './responsibles'
import { useResponsibles } from './useResponsibles'

export function ResponsaveisPage() {
  const list = useResponsibles()
  const [editing, setEditing] = useState<Responsible | 'novo' | null>(null)
  if (!list) return null
  return (
    <>
      <p className="muted" style={{ margin: '0 4px' }}>
        Pessoas que operam máquinas, aplicam vacinas ou cuidam dos serviços. Quem sai da fazenda é desativado (o histórico continua com o nome).
      </p>
      {editing ? (
        <ResponsibleForm key={editing === 'novo' ? 'novo' : editing.id} current={editing === 'novo' ? null : editing} onClose={() => setEditing(null)} />
      ) : (
        <button className="btn btn-primary btn-block" onClick={() => setEditing('novo')}>
          <Icon name="plus" /> Novo responsável
        </button>
      )}
      <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }} data-testid="responsibles">
        {list.length === 0 ? (
          <p className="muted" style={{ padding: '14px 0' }}>
            Nenhum responsável cadastrado.
          </p>
        ) : (
          list.map((r) => (
            <div className={`task${r.active ? '' : ' reversed'}`} key={r.id}>
              <div className="status-icon">
                <Icon name="user" />
              </div>
              <div className="status-body">
                <div className="status-label">
                  {r.name}
                  {!r.active && <span className="badge badge-neutral" style={{ marginLeft: 8 }}>Inativo</span>}
                </div>
                {r.role && <div className="status-detail">{r.role}</div>}
              </div>
              <button className="btn btn-outline btn-icon" aria-label={`Editar ${r.name}`} onClick={() => setEditing(r)}>
                <Icon name="edit" size={20} />
              </button>
            </div>
          ))
        )}
      </div>
    </>
  )
}

function ResponsibleForm({ current, onClose }: { current: Responsible | null; onClose: () => void }) {
  const { farm } = useFarm()
  const [key] = useState(newId)
  const [name, setName] = useState(current?.name ?? '')
  const [role, setRole] = useState(current?.role ?? '')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      if (current) await updateResponsible(db, current, name, role)
      else await createResponsible(db, farm.id, name, role, key)
      onClose()
    } catch (err) {
      setError(err instanceof ResponsibleError ? err.message : (err as Error).message)
    }
  }

  async function toggle() {
    if (!current) return
    await setResponsibleActive(db, current.id, !current.active)
    onClose()
  }

  return (
    <form onSubmit={submit} className="card stack">
      <div className="status-label">{current ? 'Editar responsável' : 'Novo responsável'}</div>
      <div className="field">
        <label className="label" htmlFor="resp-name">
          Nome
        </label>
        <input id="resp-name" className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label className="label" htmlFor="resp-role">
          Função (opcional)
        </label>
        <input id="resp-role" className="input" maxLength={40} placeholder="Ex.: tratorista, vaqueiro" value={role} onChange={(e) => setRole(e.target.value)} />
      </div>
      {error && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" />
          <div>{error}</div>
        </div>
      )}
      <div className="row">
        <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={!name.trim()}>
          <Icon name="check" /> Salvar
        </button>
      </div>
      {current && (
        <button type="button" className="btn btn-outline btn-block" onClick={toggle}>
          {current.active ? 'Desativar responsável' : 'Reativar responsável'}
        </button>
      )}
    </form>
  )
}
