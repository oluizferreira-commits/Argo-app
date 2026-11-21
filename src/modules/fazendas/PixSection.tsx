import { useState } from 'react'
import { db } from '../../db/database'
import { Icon } from '../../components/Icon'
import { maskPixKey, PIX_KEY_LABELS, type PixKeyType } from '../../domain/pix'
import { useFarm } from './FarmContext'
import { FarmError, removeFarmPix, updateFarmPix } from './farms'

type Msg = { kind: 'ok' | 'error'; text: string } | null

function Notice({ msg }: { msg: Msg }) {
  if (!msg) return null
  return (
    <div className={`notice notice-${msg.kind}`} role="status">
      <Icon name={msg.kind === 'ok' ? 'check' : 'alert'} />
      <div>{msg.text}</div>
    </div>
  )
}

/** Chave Pix da fazenda (usada no QR Code das vendas). */
export function PixSection() {
  const { farm } = useFarm()
  const [type, setType] = useState<PixKeyType>(farm.pixKeyType ?? 'cpf')
  // sem chave ainda: sugere o CPF do responsável
  const [key, setKey] = useState(!farm.pixKey && farm.responsibleCpf && (farm.pixKeyType ?? 'cpf') === 'cpf' ? farm.responsibleCpf : '')
  const [name, setName] = useState(farm.pixName || farm.responsible || farm.name)
  const [city, setCity] = useState(farm.pixCity || farm.city)
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(!farm.pixKey)

  async function save() {
    setBusy(true)
    setMsg(null)
    try {
      await updateFarmPix(db, farm.id, { type, key, name, city })
      setKey('')
      setEditing(false)
      setMsg({ kind: 'ok', text: 'Chave Pix salva. Ela será usada no QR Code das vendas.' })
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof FarmError ? err.message : (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!window.confirm('Remover a chave Pix desta fazenda?')) return
    await removeFarmPix(db, farm.id)
    setEditing(true)
  }

  return (
    <>
      <h2 className="section-title">Recebimento por Pix</h2>
      <div className="card stack">
        {farm.pixKey && farm.pixKeyType && !editing ? (
          <>
            <dl className="kv">
              <dt>Chave ({PIX_KEY_LABELS[farm.pixKeyType]})</dt>
              <dd>{maskPixKey(farm.pixKeyType, farm.pixKey)}</dd>
              <dt>Recebedor</dt>
              <dd>{farm.pixName}</dd>
              <dt>Cidade</dt>
              <dd>{farm.pixCity}</dd>
            </dl>
            <button className="btn btn-outline btn-block" onClick={() => setEditing(true)}>
              <Icon name="edit" /> Trocar chave Pix
            </button>
            <button className="btn btn-danger btn-block" onClick={remove}>
              Remover chave Pix
            </button>
          </>
        ) : (
          <>
            <p className="muted">A chave aparece mascarada nos comprovantes. O QR Code leva o cliente direto ao pagamento.</p>
            <div className="field">
              <label className="label" htmlFor="pix-type">
                Tipo de chave
              </label>
              <select id="pix-type" className="input" value={type} onChange={(e) => setType(e.target.value as PixKeyType)}>
                {(Object.keys(PIX_KEY_LABELS) as PixKeyType[]).map((t) => (
                  <option key={t} value={t}>
                    {PIX_KEY_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="pix-key">
                Chave Pix
              </label>
              <input
                id="pix-key"
                className="input"
                value={key}
                autoComplete="off"
                inputMode={type === 'cpf' || type === 'cnpj' || type === 'celular' ? 'numeric' : type === 'email' ? 'email' : 'text'}
                onChange={(e) => setKey(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="pix-name">
                Nome do recebedor (como no banco)
              </label>
              <input id="pix-name" className="input" value={name} maxLength={25} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label className="label" htmlFor="pix-city">
                Cidade do recebedor
              </label>
              <input id="pix-city" className="input" value={city} maxLength={15} onChange={(e) => setCity(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-block" disabled={busy || !key.trim()} onClick={save}>
              <Icon name="check" /> Salvar chave Pix
            </button>
            {farm.pixKey && (
              <button className="btn btn-outline btn-block" onClick={() => setEditing(false)}>
                Cancelar
              </button>
            )}
          </>
        )}
        <Notice msg={msg} />
      </div>
    </>
  )
}
