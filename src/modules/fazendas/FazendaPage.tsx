import { useState, type FormEvent } from 'react'
import { db } from '../../db/database'
import { Icon } from '../../components/Icon'
import { useFarm } from './FarmContext'
import { maskPixKey, PIX_KEY_LABELS, type PixKeyType } from '../../domain/pix'
import { FarmError, removeFarmPix, setFarmPin, updateFarm, updateFarmPix } from './farms'

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

export function FazendaPage() {
  const { farm, switchFarm } = useFarm()
  const [name, setName] = useState(farm.name)
  const [responsible, setResponsible] = useState(farm.responsible)
  const [city, setCity] = useState(farm.city)
  const [msg, setMsg] = useState<Msg>(null)
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [pinMsg, setPinMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      await updateFarm(db, farm.id, { name, responsible, city })
      setMsg({ kind: 'ok', text: 'Dados da fazenda salvos.' })
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof FarmError ? err.message : (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  async function savePin(remove: boolean) {
    setPinMsg(null)
    if (!remove && pin !== pin2) return setPinMsg({ kind: 'error', text: 'Os dois PINs não são iguais.' })
    if (remove && !window.confirm('Remover o PIN desta fazenda?')) return
    setBusy(true)
    try {
      await setFarmPin(db, farm.id, remove ? '' : pin)
      setPin('')
      setPin2('')
      setPinMsg({ kind: 'ok', text: remove ? 'PIN removido.' : 'PIN definido. Ele será pedido ao abrir o app.' })
    } catch (err) {
      setPinMsg({ kind: 'error', text: err instanceof FarmError ? err.message : (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <form onSubmit={save} className="card stack">
        <div className="field">
          <label className="label" htmlFor="fz-name">
            Nome da fazenda
          </label>
          <input id="fz-name" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="fz-resp">
            Responsável
          </label>
          <input id="fz-resp" className="input" value={responsible} maxLength={60} onChange={(e) => setResponsible(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="fz-city">
            Cidade
          </label>
          <input id="fz-city" className="input" value={city} maxLength={60} onChange={(e) => setCity(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || !name.trim()}>
          <Icon name="check" /> Salvar
        </button>
        <Notice msg={msg} />
      </form>

      <PixSection />

      <h2 className="section-title">PIN de acesso</h2>
      <div className="card stack">
        <p className="muted">{farm.pinHash ? 'Esta fazenda tem PIN.' : 'Esta fazenda não tem PIN: abre direto.'}</p>
        <input
          className="input"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={6}
          placeholder={farm.pinHash ? 'Novo PIN (4 a 6 números)' : 'PIN (4 a 6 números)'}
          aria-label="Novo PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        />
        {pin && (
          <input
            className="input"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={6}
            placeholder="Repita o PIN"
            aria-label="Repita o PIN"
            value={pin2}
            onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))}
          />
        )}
        <button className="btn btn-outline btn-block" disabled={busy || pin.length < 4} onClick={() => savePin(false)}>
          <Icon name="shield" /> {farm.pinHash ? 'Trocar PIN' : 'Definir PIN'}
        </button>
        {farm.pinHash && (
          <button className="btn btn-danger btn-block" disabled={busy} onClick={() => savePin(true)}>
            Remover PIN
          </button>
        )}
        <Notice msg={pinMsg} />
      </div>

      <button className="btn btn-gold btn-block" onClick={() => void switchFarm()}>
        <Icon name="arrows" /> Trocar de fazenda
      </button>
      <p className="muted" style={{ margin: '0 4px' }}>
        Para cadastrar outra fazenda, toque em "Trocar de fazenda" e depois em "Cadastrar nova fazenda".
      </p>
    </>
  )
}

function PixSection() {
  const { farm } = useFarm()
  const [type, setType] = useState<PixKeyType>(farm.pixKeyType ?? 'cpf')
  const [key, setKey] = useState('')
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
