import { useState, type FormEvent } from 'react'
import { newId } from '../../core/ids'
import { parseDecimal } from '../../core/money'
import { db } from '../../db/database'
import type { Equipment, EquipmentStatus } from '../../db/types'
import { Icon } from '../../components/Icon'
import { createEquipment, FuelError, METER_LABEL, updateEquipment } from '../diesel/fuel'
import { useFarm } from '../fazendas/FarmContext'
import { useResponsibles } from '../responsaveis/useResponsibles'
import { STATUS_LABEL } from './machines'

const dec2 = (h: number | null | undefined) => (h == null ? '' : (h / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 }).replace(/\./g, ''))

/** Cadastro completo da máquina (o mesmo equipamento usado no Diesel e nas operações). */
export function MaquinaForm({ current, onDone, onCancel }: { current: Equipment | null; onDone: (e: Equipment) => void; onCancel: () => void }) {
  const { farm } = useFarm()
  const responsibles = (useResponsibles() ?? []).filter((r) => r.active || r.id === current?.responsibleId)
  const [key] = useState(newId)
  const [name, setName] = useState(current?.name ?? '')
  const [type, setType] = useState(current?.type ?? '')
  const [brand, setBrand] = useState(current?.brand ?? '')
  const [model, setModel] = useState(current?.model ?? '')
  const [year, setYear] = useState(current?.year ? String(current.year) : '')
  const [identification, setIdentification] = useState(current?.identification ?? '')
  const [acquiredAt, setAcquiredAt] = useState(current?.acquiredAt ?? '')
  const [responsibleId, setResponsibleId] = useState(current?.responsibleId ?? '')
  const [meter, setMeter] = useState<Equipment['meter']>(current?.meter ?? 'horimetro')
  const [meterInitial, setMeterInitial] = useState(dec2(current?.meterInitial))
  const [status, setStatus] = useState<EquipmentStatus>(current?.status ?? (current && !current.active ? 'inativo' : 'ativo'))
  const [notes, setNotes] = useState(current?.notes ?? '')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const mi = meter === 'horimetro' && meterInitial.trim() ? parseDecimal(meterInitial, 2) : null
      if (meter === 'horimetro' && meterInitial.trim() && mi === null) throw new FuelError('Horímetro inicial inválido (ex.: 1248,5).')
      const input = {
        name,
        type,
        identification,
        responsibleId: responsibleId || null,
        meter,
        brand,
        model,
        year: year.trim() ? Number(year) : null,
        acquiredAt: acquiredAt || null,
        notes,
        status,
        meterInitial: mi,
      }
      const saved = current ? await updateEquipment(db, current, input) : await createEquipment(db, farm.id, input, key)
      onDone(saved)
    } catch (err) {
      setError(err instanceof FuelError ? err.message : (err as Error).message)
    }
  }

  const field = (id: string, label: string, value: string, set: (v: string) => void, extra: Record<string, string | number> = {}) => (
    <div className="field" style={{ margin: 0, flex: 1 }}>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input id={id} className="input" value={value} onChange={(e) => set(e.target.value)} {...extra} />
    </div>
  )

  return (
    <form onSubmit={submit} className="card stack" data-testid="equipment-form">
      <div className="status-label">{current ? 'Editar máquina' : 'Nova máquina ou equipamento'}</div>
      {field('eq-name', 'Nome', name, setName, { maxLength: 60, placeholder: 'Ex.: John Deere 7230J' })}
      <div className="row" style={{ alignItems: 'flex-start' }}>
        {field('eq-brand', 'Marca', brand, setBrand, { maxLength: 40 })}
        {field('eq-model', 'Modelo', model, setModel, { maxLength: 40 })}
      </div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        {field('eq-type', 'Tipo', type, setType, { maxLength: 40, placeholder: 'Trator, pulverizador…' })}
        {field('eq-year', 'Ano', year, (v) => setYear(v.replace(/\D/g, '').slice(0, 4)), { inputMode: 'numeric' })}
      </div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        {field('eq-id', 'Nº de série / placa', identification, setIdentification, { maxLength: 40 })}
        <div className="field" style={{ margin: 0, flex: 1 }}>
          <label className="label" htmlFor="eq-acq">
            Aquisição (opcional)
          </label>
          <input id="eq-acq" type="date" className="input" value={acquiredAt} onChange={(e) => setAcquiredAt(e.target.value)} />
        </div>
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label className="label" htmlFor="eq-resp">
          Responsável principal
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
      <div className="field" style={{ margin: 0 }}>
        <div className="label">Medidor</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {(['horimetro', 'km', 'nenhum'] as const).map((m) => (
            <button type="button" key={m} className={`chip${meter === m ? ' active' : ''}`} onClick={() => setMeter(m)}>
              {METER_LABEL[m]}
            </button>
          ))}
        </div>
      </div>
      {meter === 'horimetro' &&
        field('eq-meter0', current?.meterInitial != null ? 'Horímetro inicial (só antes do primeiro uso)' : 'Horímetro atual da máquina (horas)', meterInitial, setMeterInitial, {
          inputMode: 'decimal',
          placeholder: 'Ex.: 1248,5',
        })}
      <div className="field" style={{ margin: 0 }}>
        <div className="label">Situação</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {(['ativo', 'parado', 'manutencao', 'inativo'] as const).map((s) => (
            <button type="button" key={s} className={`chip${status === s ? ' active' : ''}`} onClick={() => setStatus(s)}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label className="label" htmlFor="eq-notes">
          Observações
        </label>
        <textarea id="eq-notes" className="input" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {error && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" />
          <div>{error}</div>
        </div>
      )}
      <div className="row">
        <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={!name.trim()}>
          <Icon name="check" /> Salvar
        </button>
      </div>
    </form>
  )
}
