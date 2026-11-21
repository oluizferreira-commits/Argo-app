import { useState, type FormEvent } from 'react'
import { newId } from '../../core/ids'
import { db } from '../../db/database'
import type { Equipment } from '../../db/types'
import { Icon } from '../../components/Icon'
import { useFarm } from '../fazendas/FarmContext'
import { useResponsibles } from '../responsaveis/useResponsibles'
import { createEquipment, FuelError, METER_LABEL, setEquipmentActive, updateEquipment } from './fuel'
import { useEquipments } from './useFuel'

export function EquipamentosPage() {
  const list = useEquipments()
  const responsibles = useResponsibles()
  const [editing, setEditing] = useState<Equipment | 'novo' | null>(null)
  if (!list || !responsibles) return null
  const respName = new Map(responsibles.map((r) => [r.id, r.name]))
  return (
    <>
      <p className="muted" style={{ margin: '0 4px' }}>
        Máquinas e veículos que usam diesel. Equipamento vendido ou parado é desativado (o histórico continua).
      </p>
      {editing ? (
        <EquipmentForm key={editing === 'novo' ? 'novo' : editing.id} current={editing === 'novo' ? null : editing} onClose={() => setEditing(null)} />
      ) : (
        <button className="btn btn-primary btn-block" onClick={() => setEditing('novo')}>
          <Icon name="plus" /> Novo equipamento
        </button>
      )}
      <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }} data-testid="equipments">
        {list.length === 0 ? (
          <p className="muted" style={{ padding: '14px 0' }}>
            Nenhum equipamento cadastrado.
          </p>
        ) : (
          list.map((e) => (
            <div className={`task${e.active ? '' : ' reversed'}`} key={e.id}>
              <div className="status-icon">
                <Icon name="fuel" />
              </div>
              <div className="status-body">
                <div className="status-label">
                  {e.name}
                  {!e.active && <span className="badge badge-neutral" style={{ marginLeft: 8 }}>Inativo</span>}
                </div>
                <div className="status-detail">
                  {[e.type, e.identification, METER_LABEL[e.meter], e.responsibleId ? respName.get(e.responsibleId) : ''].filter(Boolean).join(' · ')}
                </div>
              </div>
              <button className="btn btn-outline btn-icon" aria-label={`Editar ${e.name}`} onClick={() => setEditing(e)}>
                <Icon name="edit" size={20} />
              </button>
            </div>
          ))
        )}
      </div>
    </>
  )
}

function EquipmentForm({ current, onClose }: { current: Equipment | null; onClose: () => void }) {
  const { farm } = useFarm()
  const responsibles = (useResponsibles() ?? []).filter((r) => r.active || r.id === current?.responsibleId)
  const [key] = useState(newId)
  const [name, setName] = useState(current?.name ?? '')
  const [type, setType] = useState(current?.type ?? '')
  const [identification, setIdentification] = useState(current?.identification ?? '')
  const [responsibleId, setResponsibleId] = useState(current?.responsibleId ?? '')
  const [meter, setMeter] = useState<Equipment['meter']>(current?.meter ?? 'horimetro')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const input = { name, type, identification, responsibleId: responsibleId || null, meter }
    try {
      if (current) await updateEquipment(db, current, input)
      else await createEquipment(db, farm.id, input, key)
      onClose()
    } catch (err) {
      setError(err instanceof FuelError ? err.message : (err as Error).message)
    }
  }

  return (
    <form onSubmit={submit} className="card stack" data-testid="equipment-form">
      <div className="status-label">{current ? 'Editar equipamento' : 'Novo equipamento'}</div>
      <div className="field">
        <label className="label" htmlFor="eq-name">
          Nome
        </label>
        <input id="eq-name" className="input" maxLength={60} placeholder="Ex.: Trator MF 275" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label className="label" htmlFor="eq-type">
          Tipo
        </label>
        <input id="eq-type" className="input" maxLength={40} placeholder="Ex.: trator, caminhonete, roçadeira" value={type} onChange={(e) => setType(e.target.value)} />
      </div>
      <div className="field">
        <label className="label" htmlFor="eq-id">
          Identificação (placa, nº de série…)
        </label>
        <input id="eq-id" className="input" maxLength={40} value={identification} onChange={(e) => setIdentification(e.target.value)} />
      </div>
      <div className="field">
        <label className="label" htmlFor="eq-resp">
          Responsável
        </label>
        <select id="eq-resp" className="input" value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)}>
          <option value="">{responsibles.length ? 'Nenhum' : 'Nenhum cadastrado'}</option>
          {responsibles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <div className="label">Medidor</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {(['horimetro', 'km', 'nenhum'] as const).map((m) => (
            <button type="button" key={m} className={`chip${meter === m ? ' active' : ''}`} onClick={() => setMeter(m)}>
              {METER_LABEL[m]}
            </button>
          ))}
        </div>
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
        <button type="button" className="btn btn-outline btn-block" onClick={() => setEquipmentActive(db, current.id, !current.active).then(onClose)}>
          {current.active ? 'Desativar equipamento' : 'Reativar equipamento'}
        </button>
      )}
    </form>
  )
}
