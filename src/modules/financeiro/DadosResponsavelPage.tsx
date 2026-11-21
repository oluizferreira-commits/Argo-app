import { useState, type FormEvent } from 'react'
import { db } from '../../db/database'
import { Icon } from '../../components/Icon'
import { maskCpf } from '../../domain/pix'
import { useFarm } from '../fazendas/FarmContext'
import { FarmError, updateFarmResponsible } from '../fazendas/farms'
import { PixSection } from '../fazendas/PixSection'

/** CPF digitado → 000.000.000-00 enquanto digita. */
function formatCpfInput(text: string): string {
  const d = text.replace(/\D/g, '').slice(0, 11)
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2')
}

export function DadosResponsavelPage() {
  const { farm } = useFarm()
  const [editing, setEditing] = useState(!farm.responsible || !farm.responsibleCpf)
  const [name, setName] = useState(farm.responsible)
  const [cpf, setCpf] = useState(formatCpfInput(farm.responsibleCpf ?? ''))
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    try {
      await updateFarmResponsible(db, farm.id, { responsible: name, cpf })
      setEditing(false)
      setSaved(true)
    } catch (err) {
      setError(err instanceof FarmError ? err.message : (err as Error).message)
    }
  }

  return (
    <>
      <h2 className="section-title">Responsável pela fazenda</h2>
      {editing ? (
        <form onSubmit={submit} className="card stack" data-testid="responsible-form">
          <div className="field">
            <label className="label" htmlFor="dr-name">
              Nome do responsável
            </label>
            <input id="dr-name" className="input" maxLength={60} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="dr-cpf">
              CPF
            </label>
            <input
              id="dr-cpf"
              className="input"
              inputMode="numeric"
              autoComplete="off"
              placeholder="000.000.000-00"
              value={cpf}
              onChange={(e) => setCpf(formatCpfInput(e.target.value))}
            />
            <p className="muted" style={{ margin: '6px 0 0', fontSize: 14 }}>
              Fica guardado só neste aparelho e aparece mascarado na tela.
            </p>
          </div>
          {error && (
            <div className="notice notice-error" role="alert">
              <Icon name="alert" />
              <div>{error}</div>
            </div>
          )}
          <div className="row">
            {farm.responsible && (
              <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setEditing(false)}>
                Cancelar
              </button>
            )}
            <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={!name.trim()}>
              <Icon name="check" /> Salvar
            </button>
          </div>
        </form>
      ) : (
        <div className="card stack" data-testid="responsible-card">
          <dl className="kv">
            <dt>Nome</dt>
            <dd>{farm.responsible || '—'}</dd>
            <dt>CPF</dt>
            <dd data-testid="responsible-cpf">{farm.responsibleCpf ? maskCpf(farm.responsibleCpf) : 'Não informado'}</dd>
          </dl>
          {saved && (
            <div className="notice notice-ok" role="status">
              <Icon name="check" />
              <div>Dados do responsável salvos.</div>
            </div>
          )}
          <button className="btn btn-outline btn-block" onClick={() => setEditing(true)}>
            <Icon name="edit" /> Alterar nome ou CPF
          </button>
        </div>
      )}
      {/* recria ao salvar o CPF, para sugerir a chave Pix */}
      <PixSection key={farm.responsibleCpf ?? ''} />
    </>
  )
}
