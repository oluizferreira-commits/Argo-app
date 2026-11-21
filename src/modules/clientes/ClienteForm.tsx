import type { ClientInput } from '../vendas/sales'

/** Campos do cliente (usados no cadastro e dentro da venda). */
export function ClientFields({ value, onChange, idPrefix = 'cl' }: { value: ClientInput; onChange: (v: ClientInput) => void; idPrefix?: string }) {
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
          Telefone (com DDD)
        </label>
        <input id={`${idPrefix}-phone`} className="input" type="tel" inputMode="tel" placeholder="(34) 99999-1234" value={value.phone} maxLength={20} onChange={set('phone')} />
        <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>Fica salvo completo no app. No comprovante aparece mascarado.</p>
      </div>
      <div className="field">
        <label className="label" htmlFor={`${idPrefix}-city`}>
          Cidade
        </label>
        <input id={`${idPrefix}-city`} className="input" value={value.city} maxLength={60} onChange={set('city')} />
      </div>
    </>
  )
}
