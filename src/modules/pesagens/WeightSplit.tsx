import { useState } from 'react'
import { formatDecimal, parseDecimal } from '../../core/money'
import type { KgWeighing } from '../../db/types'
import { splitByWeight } from './lots'

const kg = (t: number) => `${formatDecimal(t, 1)} kg`

/**
 * "Separar por peso": média acima e abaixo de um peso de corte (por cabeça).
 * O corte começa na média geral (arredondada para 10 kg) e pode ser trocado.
 */
export function WeightSplit({ weighings }: { weighings: readonly KgWeighing[] }) {
  const heads = weighings.reduce((a, w) => a + w.heads, 0)
  const total = weighings.reduce((a, w) => a + w.kgTenths, 0)
  const avgKg = heads ? total / heads / 10 : 0
  // enquanto a pessoa não digitar um corte, ele acompanha a média do lote (arredondada para 10 kg)
  const [typed, setTyped] = useState<string | null>(null)
  const text = typed ?? (avgKg ? String(Math.round(avgKg / 10) * 10) : '')
  const setText = (v: string) => setTyped(v)
  if (!weighings.length) return null
  const cut = parseDecimal(text, 1)
  const r = cut && cut > 0 ? splitByWeight(weighings, cut) : null
  return (
    <div className="card stack" data-testid="weight-split">
      <div className="label" style={{ margin: 0 }}>
        Separar por peso (média acima e abaixo)
      </div>
      <div className="row" style={{ gap: 8 }}>
        <span className="muted" style={{ flex: 'none' }}>
          Peso de corte
        </span>
        <input className="input" inputMode="decimal" aria-label="Peso de corte em kg por cabeça" placeholder="ex.: 350" value={text} onChange={(e) => setText(e.target.value.replace(/[^\d.,]/g, ''))} style={{ maxWidth: 140, textAlign: 'right' }} data-testid="split-cut" />
        <span className="muted" style={{ flex: 'none' }}>
          kg/cab.
        </span>
      </div>
      {r && (
        <div className="split-grid">
          <div className="split-box up" data-testid="split-above">
            <span className="split-title">{kg(cut!)} ou mais</span>
            <b>{r.above.heads} cab.</b>
            <span>média {r.above.heads ? kg(r.above.avgTenths) : '—'}</span>
            <small>
              {kg(r.above.kgTenths)} · {r.above.weighings} pesage{r.above.weighings === 1 ? 'm' : 'ns'}
            </small>
          </div>
          <div className="split-box down" data-testid="split-below">
            <span className="split-title">abaixo de {kg(cut!)}</span>
            <b>{r.below.heads} cab.</b>
            <span>média {r.below.heads ? kg(r.below.avgTenths) : '—'}</span>
            <small>
              {kg(r.below.kgTenths)} · {r.below.weighings} pesage{r.below.weighings === 1 ? 'm' : 'ns'}
            </small>
          </div>
        </div>
      )}
      <p className="muted" style={{ fontSize: 13 }}>
        Cada pesagem entra inteira no grupo pelo peso por cabeça dela (os animais que subiram juntos ficam juntos).
      </p>
    </div>
  )
}
