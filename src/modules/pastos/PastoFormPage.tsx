import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { newId } from '../../core/ids'
import { db } from '../../db/database'
import type { Pasture } from '../../db/types'
import { Icon } from '../../components/Icon'
import { createPasture, parseArea, PastureError, updatePasture } from './pastures'

/** Cadastro (/pastos/novo) e edição (/pastos/:id/editar). */
export function PastoFormPage() {
  const { id } = useParams()
  const existing = useLiveQuery(async () => (id ? ((await db.pastures.get(id)) ?? null) : null), [id])
  if (id && existing === undefined) return null
  if (id && !existing) return <div className="card empty">Pasto não encontrado.</div>
  return <PastoForm key={existing?.id ?? 'novo'} existing={existing ?? null} />
}

function PastoForm({ existing }: { existing: Pasture | null }) {
  const navigate = useNavigate()
  const [formKey] = useState(newId)
  const [name, setName] = useState(existing?.name ?? '')
  const [area, setArea] = useState(existing?.areaHa != null ? String(existing.areaHa).replace('.', ',') : '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    setError(null)
    setSaving(true)
    try {
      const input = { name, areaHa: parseArea(area), notes }
      const p = existing ? await updatePasture(db, existing.id, input, existing.rev) : await createPasture(db, input, formKey)
      navigate(`/pastos/${p.id}`, { replace: true })
    } catch (err) {
      setError(err instanceof PastureError ? err.message : `Não foi possível salvar: ${(err as Error).message}`)
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="stack">
      <div className="card">
        <div className="field">
          <label className="label" htmlFor="p-name">
            Nome do pasto
          </label>
          <input id="p-name" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </div>
        <div className="field">
          <label className="label" htmlFor="p-area">
            Tamanho (hectares)
          </label>
          <input
            id="p-area"
            className="input"
            inputMode="decimal"
            value={area}
            placeholder="Ex.: 25,5"
            onChange={(e) => setArea(e.target.value.replace(/[^\d.,]/g, ''))}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="p-notes">
            Observações
          </label>
          <textarea id="p-notes" className="input" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      {error && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" />
          <div>{error}</div>
        </div>
      )}
      <button type="submit" className="btn btn-primary btn-block" disabled={saving || !name.trim()}>
        <Icon name="check" /> {saving ? 'Salvando…' : existing ? 'Salvar alterações' : 'Cadastrar pasto'}
      </button>
    </form>
  )
}
