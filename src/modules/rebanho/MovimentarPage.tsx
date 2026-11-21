import { Link, Navigate, useParams } from 'react-router'
import { MOVEMENT_INFO, MOVEMENT_TYPES, type MovementType } from '../../domain/movements'
import { Icon } from '../../components/Icon'
import { MovementForm } from './MovementForm'
import { usePastures } from './useHerd'

export type FormType = Exclude<MovementType, 'estorno'>

const FORM_TYPES = MOVEMENT_TYPES.filter((t): t is FormType => t !== 'estorno')

/** Escolha do tipo de movimentação. */
export function MovimentarPage() {
  const pastures = usePastures()
  if (pastures && pastures.length === 0) {
    return (
      <div className="card empty">
        <p>Cadastre um pasto antes de lançar movimentações.</p>
        <Link to="/pastos/novo" className="btn btn-gold btn-block" style={{ marginTop: 16 }}>
          <Icon name="plus" /> Cadastrar pasto
        </Link>
      </div>
    )
  }
  return (
    <>
      <p className="muted" style={{ margin: '0 4px' }}>
        O que aconteceu com o rebanho?
      </p>
      <div className="type-grid">
        {FORM_TYPES.map((t) => (
          <Link key={t} to={t === 'venda' ? '/vendas/nova' : `/rebanho/movimentar/${t}`} className="type-tile">
            <div className="tile-icon">
              <Icon name={MOVEMENT_INFO[t].icon} />
            </div>
            <div className="tile-title">{MOVEMENT_INFO[t].label}</div>
            <div className="tile-desc">{MOVEMENT_INFO[t].description}</div>
          </Link>
        ))}
      </div>
    </>
  )
}

/** Formulário de um tipo específico (/rebanho/movimentar/:tipo). */
export function MovimentarTipoPage() {
  const { tipo } = useParams()
  if (tipo === 'venda') return <Navigate to="/vendas/nova" replace />
  if (!FORM_TYPES.includes(tipo as FormType)) {
    return (
      <div className="card empty">
        <p>Tipo de movimentação desconhecido.</p>
        <Link to="/rebanho/movimentar" className="btn btn-outline btn-block" style={{ marginTop: 16 }}>
          Voltar
        </Link>
      </div>
    )
  }
  return <MovementForm key={tipo} type={tipo as FormType} />
}
