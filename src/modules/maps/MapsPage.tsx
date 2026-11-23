import type L from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Icon } from '../../components/Icon'
import { useOnline } from '../../hooks/useOnline'
import { useFarm } from '../fazendas/FarmContext'
import { formatDay } from '../rebanho/herd'
import { formatHa } from './geo'
import { drawShapes, initialView, MAP_COLORS, shapesBounds } from './layers'
import { MapCanvas, type BaseLayer } from './MapCanvas'
import { useMapData } from './useMapData'

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** ARGO Maps — mapa da fazenda: satélite ou desenho, pastos com nome e área, toque abre o pasto. */
export function MapsPage() {
  const { farm } = useFarm()
  const d = useMapData()
  const online = useOnline()
  const navigate = useNavigate()
  const [map, setMap] = useState<L.Map | null>(null)
  const [base, setBase] = useState<BaseLayer>('satelite')
  const [selected, setSelected] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const effectiveBase: BaseLayer = online ? base : 'desenho'

  const views = d?.views
  useEffect(() => {
    if (!map || !views) return
    const g = drawShapes(map, views, { selectedId: selected, onSelect: setSelected })
    return () => {
      g.remove()
    }
  }, [map, views, selected])

  // enquadra a fazenda ao abrir
  const framed = useRef(false)
  useEffect(() => {
    if (!map || !views || framed.current) return
    const b = shapesBounds(views)
    if (b) map.fitBounds(b, { padding: [24, 24] })
    framed.current = true
  }, [map, views])

  const sel = useMemo(() => views?.find((v) => v.shape.id === selected) ?? null, [views, selected])
  const found = useMemo(() => {
    const qq = fold(q.trim())
    if (!qq || !views) return []
    return views.filter((v) => v.shape.kind !== 'perimetro' && fold(v.label).includes(qq)).slice(0, 6)
  }, [q, views])

  if (!d) return <div className="argo-loading">Carregando o mapa</div>

  if (d.shapes.length === 0) {
    return (
      <section className="maps-empty" data-testid="maps-empty">
        <span className="maps-empty-icon">
          <Icon name="layers" size={40} />
        </span>
        <h2>Mapeie sua fazenda</h2>
        <p className="muted">
          Encontre a fazenda na imagem de satélite, contorne o perímetro e desenhe os pastos. O ARGO calcula as áreas e você confirma no fim.
        </p>
        <Link to="/maps/editar" className="btn btn-gold btn-block" data-testid="maps-start">
          <Icon name="polygon" /> Começar o mapeamento
        </Link>
        <p className="muted" style={{ fontSize: 13 }}>
          Áreas e perímetros são estimativas cartográficas para gestão — não substituem georreferenciamento legal nem levantamento topográfico.
        </p>
      </section>
    )
  }

  const view = initialView(d.farmMap, farm.entrance)
  const sp = sel?.shape.kind === 'pasto' ? d.pastureById.get(sel.shape.pastureId ?? '') : undefined
  const heads = sel?.heads ?? 0
  const ha = sel ? sel.shape.areaCentiHa / 100 : 0

  return (
    <div className="maps-screen">
      <div className="maps-top">
        <div className="seg" role="group" aria-label="Tipo de mapa">
          <button type="button" className={effectiveBase === 'satelite' ? 'on' : ''} aria-pressed={effectiveBase === 'satelite'} disabled={!online} onClick={() => setBase('satelite')}>
            Satélite
          </button>
          <button type="button" className={effectiveBase === 'desenho' ? 'on' : ''} aria-pressed={effectiveBase === 'desenho'} onClick={() => setBase('desenho')}>
            Desenho
          </button>
        </div>
        <span className={`map-status ${d.farmMap?.status === 'confirmado' ? 'ok' : 'draft'}`} data-testid="map-status">
          {d.farmMap?.status === 'confirmado' ? `Confirmado · versão ${d.farmMap.version}` : 'Rascunho'}
        </span>
      </div>

      <div className="maps-stage">
        <MapCanvas base={effectiveBase} center={view.center} zoom={view.zoom} onReady={setMap} testId="farm-map" />
        <div className="maps-search">
          <Icon name="search" size={18} />
          <input type="search" placeholder="Buscar pasto" aria-label="Buscar pasto no mapa" value={q} onChange={(e) => setQ(e.target.value)} />
          {found.length > 0 && (
            <div className="maps-found">
              {found.map((v) => (
                <button
                  key={v.shape.id}
                  type="button"
                  onClick={() => {
                    setSelected(v.shape.id)
                    setQ('')
                    const b = shapesBounds([v])
                    if (b && map) map.fitBounds(b, { padding: [40, 40], maxZoom: 17 })
                  }}
                >
                  {v.label} <span>{formatHa(v.shape.areaCentiHa)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="maps-fabs">
          <button
            type="button"
            className="round-btn"
            aria-label="Centralizar a fazenda"
            onClick={() => {
              const b = shapesBounds(d.views)
              if (b && map) map.fitBounds(b, { padding: [24, 24] })
            }}
          >
            <Icon name="crosshair" size={22} />
          </button>
          <button type="button" className="round-btn gold" aria-label="Editar o mapeamento" onClick={() => navigate('/maps/editar?etapa=pastos')} data-testid="maps-edit">
            <Icon name="edit" size={22} />
          </button>
        </div>
        {!online && <div className="maps-offline">Sem internet: o satélite fica indisponível; os contornos da fazenda continuam aqui.</div>}
      </div>

      {sel ? (
        <section className="maps-panel" data-testid="maps-panel">
          <div className="maps-panel-head">
            <div>
              <div className="ind-label">{sel.shape.kind === 'pasto' ? 'Pasto' : 'Área não produtiva'}</div>
              <h2 className="maps-panel-title">{sel.label}</h2>
            </div>
            <button type="button" className="btn btn-outline btn-icon" aria-label="Fechar" onClick={() => setSelected(null)}>
              <Icon name="close" size={20} />
            </button>
          </div>
          <div className="maps-kpis">
            <span>
              <b>{formatHa(sel.shape.areaCentiHa)}</b>
              <small>área no mapa</small>
            </span>
            {sel.shape.kind === 'pasto' && (
              <>
                <span>
                  <b data-testid="panel-heads">{heads.toLocaleString('pt-BR')}</b>
                  <small>cabeças</small>
                </span>
                <span>
                  <b>{ha > 0 ? (heads / ha).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—'}</b>
                  <small>cab./ha</small>
                </span>
              </>
            )}
          </div>
          {sel.shape.kind === 'pasto' && (d.cats.get(sel.shape.pastureId ?? '') ?? []).length > 0 && (
            <div className="herd-cats">
              {d.cats.get(sel.shape.pastureId ?? '')!.map((c) => (
                <span key={c.label} className="herd-cat">
                  <b>{c.n.toLocaleString('pt-BR')}</b> {c.label}
                </span>
              ))}
            </div>
          )}
          {sp && sp.areaHa !== null && <p className="muted" style={{ fontSize: 14 }}>Área no cadastro: {formatHa(Math.round(sp.areaHa * 100))}</p>}
          {sp && (
            <div className="row">
              <Link to={`/pastos/${sp.id}`} className="btn btn-gold" style={{ flex: 1 }}>
                Abrir pasto
              </Link>
              <Link to={`/rebanho/movimentar?pasto=${sp.id}`} className="btn btn-outline" style={{ flex: 1 }}>
                Movimentar
              </Link>
            </div>
          )}
        </section>
      ) : (
        <section className="maps-legend" aria-label="Legenda">
          <span>
            <i style={{ background: MAP_COLORS.pastoComAnimais }} /> Pasto com animais
          </span>
          <span>
            <i style={{ background: MAP_COLORS.pastoVazio }} /> Pasto vazio
          </span>
          <span>
            <i style={{ background: MAP_COLORS.naoProdutiva }} /> Área não produtiva
          </span>
          <span>
            <i className="line" style={{ borderColor: MAP_COLORS.perimetro }} /> Perímetro
          </span>
          {d.farmMap?.confirmedAt && <span className="muted">Confirmado em {formatDay(d.farmMap.confirmedAt.slice(0, 10))}</span>}
        </section>
      )}
      <p className="muted maps-note">Áreas são estimativas cartográficas, não georreferenciamento legal. Toque num pasto para ver os dados.</p>
    </div>
  )
}
