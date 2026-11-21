import { Link } from 'react-router'
import { Icon } from '../../components/Icon'
import { pendingSpecification } from './herd'
import { useBalances, usePastures } from './useHerd'

function describe(females: number, males: number): string {
  return [females && `${females} fêmea${females > 1 ? 's' : ''}`, males && `${males} macho${males > 1 ? 's' : ''}`].filter(Boolean).join(' e ')
}

/** Alerta de pastos com gado contado sem categoria (aparece no Painel e no Rebanho). */
export function SpecificationAlerts() {
  const pastures = usePastures()
  const { balances } = useBalances()
  if (!pastures) return null
  const pending = pendingSpecification(balances, pastures.map((p) => p.id))
  if (pending.length === 0) return null
  const name = (id: string) => pastures.find((p) => p.id === id)?.name ?? ''
  return (
    <div className="notice notice-warn" role="alert" data-testid="spec-alert">
      <Icon name="alert" />
      <div className="stack" style={{ gap: 8, flex: 1 }}>
        <strong>Contagem a especificar</strong>
        {pending.map((p) => (
          <div key={p.pastureId}>
            <strong>{name(p.pastureId)}</strong>: {describe(p.females, p.males)} sem categoria.{' '}
            <Link to={`/rebanho/movimentar/especificacao?pasto=${p.pastureId}`}>Especificar</Link>
          </div>
        ))}
        <span>Na próxima vez que o gado for ao curral, conte separando por categoria (ex.: novilhas e vacas).</span>
      </div>
    </div>
  )
}

/** Aviso dentro da página do pasto. */
export function PastureSpecificationNotice({ pastureId, females, males }: { pastureId: string; females: number; males: number }) {
  if (females <= 0 && males <= 0) return null
  return (
    <div className="notice notice-warn" role="alert" data-testid="pasture-spec-alert">
      <Icon name="alert" />
      <div className="stack" style={{ gap: 10, flex: 1 }}>
        <div>
          <strong>Este pasto tem {describe(females, males)} sem categoria.</strong> Na próxima vez que o gado for ao curral, conte separando por
          categoria (ex.: 40 novilhas e 100 vacas).
        </div>
        <Link to={`/rebanho/movimentar/especificacao?pasto=${pastureId}`} className="btn btn-gold btn-block">
          <Icon name="list" /> Especificar agora
        </Link>
      </div>
    </div>
  )
}
