import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent, type ReactNode } from 'react'
import { newId } from '../../core/ids'
import { db } from '../../db/database'
import type { Farm } from '../../db/types'
import { Icon } from '../../components/Icon'
import { FarmContext } from './FarmContext'
import { createFarm, FarmError, getCurrentFarmId, setCurrentFarm, verifyPin } from './farms'

const UNLOCK_KEY = 'argo-unlocked-farm'

/** Ao entrar numa fazenda, começa sempre pelo Painel. */
function goHome() {
  if (window.location.hash && window.location.hash !== '#/') window.location.hash = '#/'
}

function readUnlocked(): string | null {
  try {
    return sessionStorage.getItem(UNLOCK_KEY)
  } catch {
    return null
  }
}

function writeUnlocked(id: string | null) {
  try {
    if (id) sessionStorage.setItem(UNLOCK_KEY, id)
    else sessionStorage.removeItem(UNLOCK_KEY)
  } catch {
    /* armazenamento de sessão indisponível: o PIN será pedido de novo */
  }
}

/**
 * Entrada do app: cadastro da primeira fazenda, escolha da fazenda e PIN.
 * O restante do app só é exibido com uma fazenda escolhida (e desbloqueada).
 */
export function FarmGate({ children }: { children: ReactNode }) {
  const farms = useLiveQuery(async () =>
    (await db.farms.toArray()).filter((f) => f.deletedAt === null).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
  )
  const currentId = useLiveQuery(() => getCurrentFarmId(db), [], undefined)
  const [unlocked, setUnlocked] = useState<string | null>(readUnlocked)
  const [creating, setCreating] = useState(false)
  const [pinFor, setPinFor] = useState<Farm | null>(null)

  if (farms === undefined || currentId === undefined) return null

  const current = farms.find((f) => f.id === currentId) ?? null

  async function choose(f: Farm) {
    if (f.pinHash) {
      setPinFor(f)
      return
    }
    writeUnlocked(f.id)
    setUnlocked(f.id)
    goHome()
    await setCurrentFarm(db, f.id)
  }

  async function switchFarm() {
    writeUnlocked(null)
    setUnlocked(null)
    setPinFor(null)
    await setCurrentFarm(db, null)
  }

  // Fazenda atual com PIN e ainda não desbloqueada nesta sessão.
  const needsPin = current && current.pinHash && unlocked !== current.id ? current : null
  const pinTarget = pinFor ?? needsPin

  if (farms.length === 0 || creating) {
    return (
      <GateShell>
        <CreateFarm
          first={farms.length === 0}
          onCancel={farms.length ? () => setCreating(false) : undefined}
          onCreated={async (f) => {
            setCreating(false)
            writeUnlocked(f.id)
            setUnlocked(f.id)
            goHome()
            await setCurrentFarm(db, f.id)
          }}
        />
      </GateShell>
    )
  }

  if (pinTarget) {
    return (
      <GateShell>
        <PinLock
          farm={pinTarget}
          onBack={() => {
            setPinFor(null)
            void setCurrentFarm(db, null)
          }}
          onUnlock={async () => {
            writeUnlocked(pinTarget.id)
            setUnlocked(pinTarget.id)
            setPinFor(null)
            goHome()
            await setCurrentFarm(db, pinTarget.id)
          }}
        />
      </GateShell>
    )
  }

  if (!current) {
    return (
      <GateShell>
        <h1 className="gate-title">Escolha a fazenda</h1>
        <div className="stack">
          {farms.map((f) => (
            <button key={f.id} className="gate-farm" onClick={() => choose(f)}>
              <span className="gate-farm-name">{f.name}</span>
              <span className="gate-farm-detail">
                {[f.responsible, f.city].filter(Boolean).join(' · ') || 'Fazenda'}
                {f.pinHash && ' · com PIN'}
              </span>
              <Icon name="chevronRight" size={22} />
            </button>
          ))}
          <button className="btn btn-outline-light btn-block" onClick={() => setCreating(true)}>
            <Icon name="plus" /> Cadastrar nova fazenda
          </button>
        </div>
      </GateShell>
    )
  }

  return <FarmContext.Provider value={{ farm: current, switchFarm }}>{children}</FarmContext.Provider>
}

function GateShell({ children }: { children: ReactNode }) {
  return (
    <div className="gate">
      <div className="gate-inner">
        <div className="gate-brand">
          <img src={`${import.meta.env.BASE_URL}logo-mark.svg`} alt="" />
          <div className="brand-name">ARGO</div>
          <div className="brand-sub">Gestão Pecuária</div>
        </div>
        {children}
      </div>
    </div>
  )
}

function CreateFarm(props: { first: boolean; onCreated: (f: Farm) => void; onCancel?: () => void }) {
  const [key] = useState(newId)
  const [name, setName] = useState('')
  const [responsible, setResponsible] = useState('')
  const [city, setCity] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    setError(null)
    if (pin !== pin2) return setError('Os dois PINs não são iguais.')
    setSaving(true)
    try {
      props.onCreated(await createFarm(db, { name, responsible, city }, pin, key))
    } catch (err) {
      setError(err instanceof FarmError ? err.message : `Não foi possível salvar: ${(err as Error).message}`)
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="stack">
      <h1 className="gate-title">{props.first ? 'Bem-vindo! Cadastre sua fazenda' : 'Nova fazenda'}</h1>
      <div className="card">
        <div className="field">
          <label className="label" htmlFor="f-name">
            Nome da fazenda
          </label>
          <input id="f-name" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </div>
        <div className="field">
          <label className="label" htmlFor="f-resp">
            Responsável
          </label>
          <input id="f-resp" className="input" value={responsible} maxLength={60} onChange={(e) => setResponsible(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="f-city">
            Cidade
          </label>
          <input id="f-city" className="input" value={city} maxLength={60} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="f-pin">
            PIN (opcional, 4 a 6 números)
          </label>
          <input
            id="f-pin"
            className="input"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        {pin && (
          <div className="field">
            <label className="label" htmlFor="f-pin2">
              Repita o PIN
            </label>
            <input
              id="f-pin2"
              className="input"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              value={pin2}
              onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))}
            />
          </div>
        )}
        <p className="muted" style={{ marginTop: 12 }}>
          Sem PIN, qualquer pessoa com este iPhone abre a fazenda. O PIN fica guardado apenas neste aparelho.
        </p>
      </div>
      {error && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" />
          <div>{error}</div>
        </div>
      )}
      <button type="submit" className="btn btn-gold btn-block" disabled={saving || !name.trim()}>
        <Icon name="check" /> {saving ? 'Salvando…' : 'Cadastrar fazenda'}
      </button>
      {props.onCancel && (
        <button type="button" className="btn btn-outline-light btn-block" onClick={props.onCancel}>
          Cancelar
        </button>
      )}
    </form>
  )
}

function PinLock(props: { farm: Farm; onUnlock: () => void; onBack: () => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  async function press(d: string) {
    if (checking) return
    setError(null)
    const next = (pin + d).slice(0, 6)
    setPin(next)
    if (next.length >= 4) {
      setChecking(true)
      const ok = await verifyPin(props.farm, next)
      setChecking(false)
      if (ok) props.onUnlock()
      else if (next.length === 6) {
        setError('PIN incorreto.')
        setPin('')
      }
    }
  }

  async function confirm() {
    setChecking(true)
    const ok = await verifyPin(props.farm, pin)
    setChecking(false)
    if (ok) props.onUnlock()
    else {
      setError('PIN incorreto.')
      setPin('')
    }
  }

  return (
    <div className="stack" style={{ alignItems: 'center' }}>
      <h1 className="gate-title">{props.farm.name}</h1>
      <p className="gate-muted">Digite o PIN</p>
      <div className="pin-dots" aria-label={`${pin.length} números digitados`}>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={i < pin.length ? 'on' : ''} />
        ))}
      </div>
      {error && <p className="gate-error">{error}</p>}
      <div className="pin-pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} className="pin-key" onClick={() => press(d)} aria-label={d}>
            {d}
          </button>
        ))}
        <button className="pin-key pin-key-text" onClick={props.onBack}>
          Voltar
        </button>
        <button className="pin-key" onClick={() => press('0')} aria-label="0">
          0
        </button>
        <button className="pin-key pin-key-text" onClick={() => setPin(pin.slice(0, -1))} aria-label="Apagar">
          Apagar
        </button>
      </div>
      <button className="btn btn-gold btn-block" style={{ maxWidth: 300 }} disabled={pin.length < 4 || checking} onClick={confirm}>
        Entrar
      </button>
    </div>
  )
}
