import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { newId } from '../../core/ids'
import { db } from '../../db/database'
import type { Client } from '../../db/types'
import { Icon } from '../../components/Icon'
import { useFarm } from '../fazendas/FarmContext'
import { createClient, EMPTY_CLIENT, SaleError, updateClient, type ClientInput } from '../vendas/sales'
import { ClientFields } from './ClienteForm'

export function ClienteFormPage() {
  const { id } = useParams()
  const { farm } = useFarm()
  const existing = useLiveQuery(async () => (id ? ((await db.clients.get(id)) ?? null) : null), [id])
  if (id && existing === undefined) return null
  if (id && (!existing || existing.farmId !== farm.id)) return <div className="card empty">Cliente não encontrado.</div>
  return <Form key={existing?.id ?? 'novo'} existing={existing ?? null} />
}

function Form({ existing }: { existing: Client | null }) {
  const navigate = useNavigate()
  const { farm } = useFarm()
  const [key] = useState(newId)
  const [value, setValue] = useState<ClientInput>(
    existing ? { name: existing.name, phone: existing.phone, city: existing.city, document: existing.document } : EMPTY_CLIENT,
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const c = existing ? await updateClient(db, existing.id, value) : await createClient(db, farm.id, value, key)
      navigate(`/clientes/${c.id}`, { replace: true })
    } catch (err) {
      setError(err instanceof SaleError ? err.message : (err as Error).message)
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="stack">
      <div className="card">
        <ClientFields value={value} onChange={setValue} />
      </div>
      {error && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" />
          <div>{error}</div>
        </div>
      )}
      <button type="submit" className="btn btn-primary btn-block" disabled={saving || !value.name.trim()}>
        <Icon name="check" /> {existing ? 'Salvar alterações' : 'Cadastrar cliente'}
      </button>
    </form>
  )
}
