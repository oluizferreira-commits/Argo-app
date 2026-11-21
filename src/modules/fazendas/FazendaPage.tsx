import { useState, type FormEvent } from 'react'
import { db } from '../../db/database'
import { Icon } from '../../components/Icon'
import { useFarm } from './FarmContext'
import { FarmError, setFarmPin, updateFarm } from './farms'

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
