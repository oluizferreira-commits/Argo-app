import type { SupplyUnit } from '../../db/types'
import type { SupplyFieldsState } from './supplyFieldsState'

const UNIT_TEXT: Record<SupplyUnit, string> = { saco: 'sacos', L: 'litros', kg: 'kg' }

/** Campos do cadastro conforme a categoria (unidade só pode ser escolhida ao criar). */
export function SupplyFields({ value: f, onChange, unitLocked }: { value: SupplyFieldsState; onChange: (v: SupplyFieldsState) => void; unitLocked?: boolean }) {
  const set = (patch: Partial<SupplyFieldsState>) => onChange({ ...f, ...patch })
  const input = (id: string, label: string, key: keyof SupplyFieldsState, placeholder = '', mode: 'text' | 'decimal' = 'text') => (
    <div className="field" style={{ margin: 0 }}>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input id={id} className="input" inputMode={mode} placeholder={placeholder} maxLength={80} value={f[key]} onChange={(e) => set({ [key]: e.target.value } as Partial<SupplyFieldsState>)} />
    </div>
  )
  return (
    <>
      {!unitLocked && f.category === 'herbicida' && (
        <div className="field" style={{ margin: 0 }}>
          <div className="label">Unidade de medida</div>
          <div className="row" style={{ gap: 8 }}>
            {(['L', 'kg'] as const).map((u) => (
              <button type="button" key={u} className={`chip${f.unit === u ? ' active' : ''}`} onClick={() => set({ unit: u })}>
                {u === 'L' ? 'Litros (L)' : 'Quilos (kg)'}
              </button>
            ))}
          </div>
        </div>
      )}
      {f.category === 'herbicida' && (
        <>
          {input('sf-ai', 'Princípio ativo', 'activeIngredient', 'Ex.: Picloram + 2,4-D')}
          {input('sf-man', 'Fabricante', 'manufacturer', 'Ex.: Corteva')}
        </>
      )}
      {f.category === 'semente' && (
        <>
          {input('sf-species', 'Espécie', 'species', 'Ex.: Brachiaria brizantha')}
          {input('sf-cultivar', 'Cultivar / variedade', 'cultivar', 'Ex.: Marandu, Piatã, Mombaça')}
          {input('sf-man', 'Fabricante / marca', 'manufacturer')}
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>{input('sf-vc', 'Valor cultural (VC%)', 'vc', 'Ex.: 80', 'decimal')}</div>
            <div style={{ flex: 1 }}>{input('sf-kgsaco', 'Peso do saco (kg)', 'kgPerSack', 'Ex.: 20', 'decimal')}</div>
          </div>
        </>
      )}
      {f.category === 'geral' && input('sf-kgsaco', 'Peso do saco (kg)', 'kgPerSack', 'Ex.: 25', 'decimal')}
      {input('sf-min', `Estoque mínimo (${UNIT_TEXT[f.unit]}) — opcional`, 'min', 'Avisa quando ficar abaixo', 'decimal')}
      {f.category !== 'geral' && (
        <div className="field" style={{ margin: 0 }}>
          <label className="label" htmlFor="sf-notes">
            Observações
          </label>
          <textarea id="sf-notes" className="input" maxLength={1000} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
        </div>
      )}
    </>
  )
}
