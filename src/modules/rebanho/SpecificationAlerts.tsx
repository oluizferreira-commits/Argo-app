import { Link } from 'react-router'
import { Icon } from '../../components/Icon'
import { pendingSpecification } from './herd'
import { useBalances, usePastures } from './useHerd'

function describe(females: number, males: number, calves = 0): string {
  const parts = [
    females && `${females} fêmea${females > 1 ? 's' : ''} sem categoria`,
    males && `${males} macho${males > 1 ? 's' : ''} sem categoria`,
    calves && `${calves} bezerro${calves > 1 ? 's' : ''} sem separar macho e fêmea`,
  ].filter(Boolean) as string[]
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}` : parts[0] ?? ''
}

/** Exemplo de como contar, conforme o que está pendente. */
function example(adults: boolean, calves: boolean): string {
  return `ex.: ${[adults && 'novilhas e vacas', calves && 'bezerros e bezerras'].filter(Boolean).join('; ')}`
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
            <strong>{name(p.pastureId)}</strong>: {describe(p.females, p.males, p.calves)}.{' '}
            <Link to={`/rebanho/movimentar/especificacao?pasto=${p.pastureId}`}>Especificar</Link>
          </div>
        ))}
        <span>Na próxima vez que o gado for ao curral, conte separando por categoria ({example(pending.some((p) => p.females || p.males), pending.some((p) => p.calves))}).</span>
      </div>
    </div>
  )
}

/** Aviso dentro da página do pasto. */
export function PastureSpecificationNotice({ pastureId, females, males, calves = 0 }: { pastureId: string; females: number; males: number; calves?: number }) {
  if (females <= 0 && males <= 0 && calves <= 0) return null
  return (
    <div className="notice notice-warn" role="alert" data-testid="pasture-spec-alert">
      <Icon name="alert" />
      <div className="stack" style={{ gap: 10, flex: 1 }}>
        <div>
          <strong>Este pasto tem {describe(females, males, calves)}.</strong> Na próxima vez que o gado for ao curral, conte separando por
          categoria ({[(females > 0 || males > 0) && 'ex.: 40 novilhas e 100 vacas', calves > 0 && `${females > 0 || males > 0 ? '' : 'ex.: '}25 bezerros e 30 bezerras`].filter(Boolean).join('; ')}).
        </div>
        <Link to={`/rebanho/movimentar/especificacao?pasto=${pastureId}`} className="btn btn-gold btn-block">
          <Icon name="list" /> Especificar agora
        </Link>
      </div>
    </div>
  )
}
