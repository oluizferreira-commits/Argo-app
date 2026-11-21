import { Icon } from './Icon'

/** Campo numérico com botões − e + grandes. Valor vazio = não informado. */
export function Stepper(props: {
  value: string
  onChange: (v: string) => void
  max?: number
  label: string
  /** Texto exibido quando vazio (padrão "0"). */
  placeholder?: string
  /** Valor de partida dos botões − e + quando o campo está vazio (ex.: contagem parte do saldo do sistema). */
  base?: number
}) {
  const n = props.value === '' ? (props.base ?? 0) : Number(props.value)
  const set = (v: number) => {
    const clamped = Math.max(0, props.max !== undefined ? Math.min(props.max, v) : v)
    props.onChange(String(clamped))
  }
  return (
    <div className="stepper">
      <button type="button" className="stepper-btn" onClick={() => set(n - 1)} disabled={n <= 0} aria-label={`Diminuir ${props.label}`}>
        <Icon name="minus" size={22} />
      </button>
      <input
        className="stepper-input"
        inputMode="numeric"
        pattern="[0-9]*"
        value={props.value}
        placeholder={props.placeholder ?? '0'}
        aria-label={props.label}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 6)
          if (digits === '') props.onChange('')
          else set(Number(digits))
        }}
      />
      <button
        type="button"
        className="stepper-btn"
        onClick={() => set(n + 1)}
        disabled={props.max !== undefined && n >= props.max}
        aria-label={`Aumentar ${props.label}`}
      >
        <Icon name="plus" size={22} />
      </button>
    </div>
  )
}
