import { FEMALE_CATEGORIES, MALE_CATEGORIES, type Category, type CategoryId } from '../domain/categories'
import type { QtyText } from './quantities'
import { Stepper } from './Stepper'

/**
 * Lista de categorias (machos / fêmeas) com contador para cada uma.
 * @param available saldo disponível por categoria — limita o máximo e é exibido.
 * @param only restringe às categorias informadas.
 */
export function CategoryQuantities(props: {
  value: QtyText
  onChange: (v: QtyText) => void
  available?: (c: CategoryId) => number
  only?: readonly CategoryId[]
  hideEmpty?: boolean
}) {
  const filter = (list: readonly Category[]) =>
    list.filter(
      (c) =>
        (!props.only || props.only.includes(c.id)) &&
        (!props.hideEmpty || !props.available || props.available(c.id) > 0) &&
        (!c.unspecified || (props.available !== undefined && props.available(c.id) > 0)),
    )
  const groups = [
    { title: 'Machos', list: filter(MALE_CATEGORIES) },
    { title: 'Fêmeas', list: filter(FEMALE_CATEGORIES) },
  ].filter((g) => g.list.length > 0)

  if (groups.length === 0) return <p className="muted">Não há animais neste pasto.</p>

  return (
    <div className="stack">
      {groups.map((g) => (
        <div key={g.title}>
          <div className="group-title">{g.title}</div>
          {g.list.map((c) => {
            const avail = props.available?.(c.id)
            return (
              <div className="qty-row" key={c.id}>
                <div className="qty-label">
                  <div className="status-label">{c.label}</div>
                  {avail !== undefined && <div className="status-detail">Disponível: {avail}</div>}
                </div>
                <Stepper
                  label={c.label}
                  value={props.value[c.id] ?? ''}
                  max={avail}
                  onChange={(v) => props.onChange({ ...props.value, [c.id]: v })}
                />
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
