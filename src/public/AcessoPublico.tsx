import { useEffect, useState, type ReactNode } from 'react'
import type { GeoPoint } from '../db/types'
import { Icon } from '../components/Icon'
import { decodeShare, type SharePayload } from '../modules/acesso/access'
import { formatCoordinate } from '../modules/acesso/geo'
import { RouteMap } from '../modules/acesso/RouteMap'
import { NavigationButtons, RouteSummary } from '../modules/acesso/RouteSummary'
import { fetchRoute, RoutingError, type RouteResult } from '../modules/acesso/routing'

type Source = { kind: 'origin'; index: number } | { kind: 'me'; point: GeoPoint }

/** Página pública de acesso: aberta por quem recebeu o link (não precisa do app nem de login). */
export function AcessoPublico() {
  const [data] = useState<SharePayload | null>(() => decodeShare(window.location.hash))
  const [source, setSource] = useState<Source | null>(() => (data && data.origins.length ? { kind: 'origin', index: 0 } : null))
  const [result, setResult] = useState<{ key: string; route?: RouteResult; error?: string } | null>(null)
  const [geo, setGeo] = useState<{ locating: boolean; error: string | null }>({ locating: false, error: null })
  const key = source ? JSON.stringify(source) : ''

  useEffect(() => {
    if (data) document.title = `Como chegar — ${data.farm}`
  }, [data])

  useEffect(() => {
    if (!data || !source) return
    const ctrl = new AbortController()
    const from = source.kind === 'origin' ? data.origins[source.index] : source.point
    fetchRoute({ lat: from.lat, lng: from.lng }, data.entrance, ctrl.signal)
      .then((route) => setResult({ key, route }))
      .catch((e) => {
        if (!ctrl.signal.aborted) setResult({ key, error: e instanceof RoutingError ? e.message : 'Não foi possível calcular a rota.' })
      })
    return () => ctrl.abort()
  }, [data, source, key])

  const current = result?.key === key ? result : null
  const route = current?.route ?? null
  const loading = geo.locating || (!!source && !current)
  const error = geo.error ?? current?.error ?? null

  function fromMe() {
    if (!navigator.geolocation) return setGeo({ locating: false, error: 'Localização indisponível neste aparelho.' })
    setGeo({ locating: true, error: null })
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setGeo({ locating: false, error: null })
        setSource({ kind: 'me', point: { lat: p.coords.latitude, lng: p.coords.longitude } })
      },
      () => setGeo({ locating: false, error: 'Não foi possível obter sua localização. Permita o acesso à localização no navegador.' }),
      { enableHighAccuracy: true, timeout: 20000 },
    )
  }

  if (!data) {
    return (
      <PublicShell title="Link inválido">
        <div className="card empty">
          <p>Este link de acesso está incompleto ou foi alterado. Peça um novo link a quem enviou.</p>
        </div>
      </PublicShell>
    )
  }

  const originName = source?.kind === 'me' ? 'sua localização' : source ? data.origins[source.index].name : ''
  const originPoint = source?.kind === 'me' ? source.point : source ? data.origins[source.index] : null

  return (
    <PublicShell title={data.farm}>
      <div className="card stack">
        <div className="label">Saindo de</div>
        <div className="chips" role="tablist">
          {data.origins.map((o, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={source?.kind === 'origin' && source.index === i}
              className={`chip${source?.kind === 'origin' && source.index === i ? ' active' : ''}`}
              onClick={() => {
                setGeo({ locating: false, error: null })
                setSource({ kind: 'origin', index: i })
              }}
            >
              {o.name}
            </button>
          ))}
          <button type="button" className={`chip${source?.kind === 'me' ? ' active' : ''}`} onClick={fromMe}>
            Minha localização
          </button>
        </div>
      </div>

      <RouteMap
        entrance={data.entrance}
        origin={originPoint && route ? { name: originName, lat: originPoint.lat, lng: originPoint.lng } : null}
        coords={route?.coords ?? null}
        landmarks={data.landmarks}
        height={420}
      />

      {loading && <p className="muted" style={{ textAlign: 'center' }}>Calculando a rota pelas estradas…</p>}
      {error && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" />
          <div>{error}</div>
        </div>
      )}

      <NavigationButtons dest={data.entrance} />

      {route && <RouteSummary route={route} originName={originName} landmarks={data.landmarks} />}

      <div className="card">
        <dl className="kv">
          <dt>Entrada principal</dt>
          <dd>{formatCoordinate(data.entrance)}</dd>
        </dl>
      </div>
    </PublicShell>
  )
}

function PublicShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}logo-mark.svg`} alt="" />
          <div style={{ minWidth: 0 }}>
            <div className="brand-name">ARGO</div>
            <div className="brand-sub">Como chegar</div>
          </div>
        </div>
      </header>
      <main className="main" style={{ paddingBottom: 'calc(var(--safe-bottom) + 32px)' }}>
        <section className="hero">
          <div className="gold-rule" />
          <h1 style={{ fontSize: 24 }}>{title}</h1>
          <p>Rota de acesso pelas estradas até a entrada principal.</p>
        </section>
        {children}
        <p className="app-credit">
          ARGO · Gestão Pecuária · <span>by Luiz Ferreira</span>
        </p>
      </main>
    </div>
  )
}
