import { useState } from 'react'
import type { ClientInput } from '../vendas/sales'

/** Campos do cliente (usados no cadastro e dentro da venda). */
export function ClientFields({ value, onChange, idPrefix = 'cl' }: { value: ClientInput; onChange: (v: ClientInput) => void; idPrefix?: string }) {
  const [showDoc, setShowDoc] = useState(Boolean(value.document))
  const set = (k: keyof ClientInput) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value })
  return (
    <>
      <div className="field">
        <label className="label" htmlFor={`${idPrefix}-name`}>
          Nome do cliente
        </label>
        <input id={`${idPrefix}-name`} className="input" value={value.name} maxLength={80} onChange={set('name')} autoComplete="off" />
      </div>
      <div className="field">
        <label className="label" htmlFor={`${idPrefix}-phone`}>
          Telefone
        </label>
        <input id={`${idPrefix}-phone`} className="input" type="tel" inputMode="tel" value={value.phone} maxLength={20} onChange={set('phone')} />
      </div>
      <div className="field">
        <label className="label" htmlFor={`${idPrefix}-city`}>
          Cidade
        </label>
        <input id={`${idPrefix}-city`} className="input" value={value.city} maxLength={60} onChange={set('city')} />
      </div>
      {showDoc ? (
        <div className="field">
          <label className="label" htmlFor={`${idPrefix}-doc`}>
            CPF ou CNPJ (opcional — aparece mascarado)
          </label>
          <input id={`${idPrefix}-doc`} className="input" inputMode="numeric" value={value.document} maxLength={18} onChange={set('document')} />
        </div>
      ) : (
        <button type="button" className="btn btn-outline btn-block" style={{ marginTop: 14 }} onClick={() => setShowDoc(true)}>
          Adicionar CPF/CNPJ (opcional)
        </button>
      )}
    </>
  )
}
