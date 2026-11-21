import { useState } from 'react'
import { Icon } from './Icon'
import { useFarm } from '../modules/fazendas/FarmContext'
import { verifyPin } from '../modules/fazendas/farms'

/**
 * Autorização explícita para lançar uma saída que deixa o estoque negativo:
 * motivo + confirmação + PIN da fazenda (se houver PIN).
 */
export function NegativeAuthorization({ message, onAuthorize, onCancel }: { message: string; onAuthorize: (reason: string) => void; onCancel: () => void }) {
  const { farm } = useFarm()
  const [reason, setReason] = useState('')
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const needsPin = Boolean(farm.pinHash)

  // não é <form>: fica dentro do formulário do lançamento (formulários não podem ser aninhados)
  async function submit() {
    setError(null)
    if (!reason.trim()) return setError('Informe o motivo.')
    if (!confirm) return setError('Marque a confirmação.')
    if (needsPin && !(await verifyPin(farm, pin))) return setError('PIN incorreto.')
    onAuthorize(reason.trim())
  }

  return (
    <div className="notice notice-warn" role="alert" data-testid="negative-auth">
      <Icon name="alert" />
      <div className="stack" style={{ gap: 10, flex: 1 }}>
        <div>
          <strong>{message}</strong>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label className="label" htmlFor="neg-reason">
            Motivo da autorização
          </label>
          <input id="neg-reason" className="input" maxLength={200} placeholder="Ex.: compra ainda não lançada" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {needsPin && (
          <div className="field" style={{ margin: 0 }}>
            <label className="label" htmlFor="neg-pin">
              PIN da fazenda
            </label>
            <input id="neg-pin" className="input" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
          </div>
        )}
        <label className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} style={{ width: 22, height: 22, marginTop: 2 }} />
          <span>Confirmo que quero lançar com o estoque ficando negativo.</span>
        </label>
        {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
        <div className="row">
          <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="btn btn-gold" style={{ flex: 1 }} onClick={() => void submit()}>
            Autorizar
          </button>
        </div>
      </div>
    </div>
  )
}
