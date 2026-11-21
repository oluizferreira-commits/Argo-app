import type { CachedRoute, GeoPoint } from '../../db/types'
import { Icon } from '../../components/Icon'
import { formatDuration, formatKm, navigationLinks } from './geo'
import { guideWithLandmarks } from './guide'
import type { MapLandmark } from './RouteMap'
import { reachesGate } from './routing'

/** Distância, tempo, validação da chegada e passo a passo (app e página pública). */
export function RouteSummary({ route, originName, landmarks }: { route: CachedRoute | Omit<CachedRoute, 'id' | 'farmId' | 'originId'>; originName: string; landmarks: readonly MapLandmark[] }) {
  const valid = reachesGate(route)
  const { items, offRoute } = guideWithLandmarks(route, originName, landmarks)
  return (
    <>
      <div className="card stack">
        <div className="row" style={{ justifyContent: 'space-around', textAlign: 'center' }}>
          <div>
            <div className="big-number" style={{ fontSize: 30 }} data-testid="route-distance">
              {formatKm(route.distance)}
            </div>
            <div className="muted">distância</div>
          </div>
          <div>
            <div className="big-number" style={{ fontSize: 30 }} data-testid="route-time">
              {formatDuration(route.duration)}
            </div>
            <div className="muted">tempo estimado</div>
          </div>
        </div>
        <div className={`notice ${valid ? 'notice-ok' : 'notice-warn'}`} data-testid="route-validation">
          <Icon name={valid ? 'check' : 'alert'} />
          <div>
            {valid
              ? `Rota validada: segue as estradas do mapa e chega a ${Math.round(route.snapEnd)} m da porteira.`
              : `A estrada mapeada termina a ${formatKm(route.snapEnd)} da porteira. O trecho final não está no mapa: confira pela imagem de satélite.`}
          </div>
        </div>
        <p className="muted" style={{ fontSize: 14 }}>
          Rota de referência a partir do ponto de {originName} no mapa. Tempo estimado pelo mapa; em estrada de terra pode levar mais. A
          navegação abaixo parte da localização de quem estiver usando.
        </p>
      </div>
      <h2 className="section-title">Passo a passo</h2>
      <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }} data-testid="route-guide">
        {items.map((it, i) => (
          <div key={i} className={`guide-line${it.kind === 'landmark' ? ' lm' : ''}`}>
            <span className="guide-km">{it.at < 1000 ? `${Math.round(it.at)} m` : `km ${(it.at / 1000).toFixed(1).replace('.', ',')}`}</span>
            <span>
              {it.kind === 'landmark' ? (
                <>
                  <strong>
                    ({it.index}) {it.text}
                  </strong>
                  {it.note && <span className="muted"> — {it.note}</span>}
                </>
              ) : (
                it.text
              )}
            </span>
          </div>
        ))}
      </div>
      {offRoute.length > 0 && (
        <p className="muted" style={{ margin: '0 4px', fontSize: 14 }}>
          Fora desta rota: {offRoute.map((o) => `(${o.index}) ${o.lm.name}`).join(', ')}.
        </p>
      )}
    </>
  )
}

export function NavigationButtons({ dest }: { dest: GeoPoint }) {
  const l = navigationLinks(dest)
  return (
    <div className="stack">
      <div className="label" style={{ margin: '0 4px' }}>
        Navegar até a porteira
      </div>
      <div className="nav-grid">
        <a className="btn btn-primary" href={l.google} target="_blank" rel="noopener noreferrer">
          Google Maps
        </a>
        <a className="btn btn-primary" href={l.waze} target="_blank" rel="noopener noreferrer">
          Waze
        </a>
        <a className="btn btn-primary" href={l.apple} target="_blank" rel="noopener noreferrer">
          Apple Mapas
        </a>
      </div>
    </div>
  )
}
