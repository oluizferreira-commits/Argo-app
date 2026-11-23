import L from 'leaflet'
import type { MapShape } from '../../db/types'
import { formatHa, fromGeometry, interiorPoint } from './geo'

export const MAP_COLORS = {
  perimetro: '#C8A96B',
  pastoComAnimais: '#83B66A',
  pastoVazio: '#A5C98A',
  naoProdutiva: '#5f7f63',
  cerca: '#F1E8D5',
  selecionado: '#F3D58F',
} as const

export interface ShapeView {
  shape: MapShape
  label: string
  /** cabeças no pasto (do Rebanho), para a cor */
  heads: number | null
}

/**
 * Desenha os contornos salvos (perímetro, pastos e áreas) com nome e área.
 * Devolve a camada (para remover) e o "fitBounds" da fazenda.
 */
export function drawShapes(map: L.Map, views: readonly ShapeView[], opts: { selectedId?: string | null; onSelect?: (id: string) => void; labels?: boolean; dim?: boolean }): L.LayerGroup {
  const g = L.layerGroup().addTo(map)
  const order = [...views].sort((a, b) => (a.shape.kind === 'perimetro' ? -1 : 0) - (b.shape.kind === 'perimetro' ? -1 : 0))
  for (const v of order) {
    const s = v.shape
    const latlngs = fromGeometry(s.geometry).map(([x, y]) => L.latLng(y, x))
    const sel = opts.selectedId === s.id
    const style: L.PathOptions =
      s.kind === 'perimetro'
        ? { color: MAP_COLORS.perimetro, weight: 4, fill: false, dashArray: '10 6', interactive: false }
        : s.kind === 'pasto'
          ? {
              color: sel ? MAP_COLORS.selecionado : MAP_COLORS.cerca,
              weight: sel ? 4 : 2,
              fillColor: (v.heads ?? 0) > 0 ? MAP_COLORS.pastoComAnimais : MAP_COLORS.pastoVazio,
              fillOpacity: opts.dim ? 0.18 : sel ? 0.55 : 0.38,
            }
          : { color: MAP_COLORS.cerca, weight: 1.5, dashArray: '4 4', fillColor: MAP_COLORS.naoProdutiva, fillOpacity: opts.dim ? 0.15 : 0.4 }
    const poly = L.polygon(latlngs, { ...style, className: `shape shape-${s.kind}${sel ? ' is-selected' : ''}` }).addTo(g)
    if (s.kind !== 'perimetro' && opts.onSelect) poly.on('click', () => opts.onSelect!(s.id))
    if (opts.labels !== false && s.kind !== 'perimetro') {
      const ip = interiorPoint(fromGeometry(s.geometry))
      if (ip)
        L.tooltip({ permanent: true, direction: 'center', className: `map-label${sel ? ' is-selected' : ''}`, interactive: false })
          .setLatLng([ip[1], ip[0]])
          .setContent(`<b>${escapeHtml(v.label)}</b><span>${formatHa(s.areaCentiHa)}</span>`)
          .addTo(g)
    }
  }
  return g
}

export function shapesBounds(views: readonly { shape: MapShape }[]): L.LatLngBounds | null {
  const pts = views.flatMap((v) => fromGeometry(v.shape.geometry).map(([x, y]) => L.latLng(y, x)))
  return pts.length ? L.latLngBounds(pts) : null
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/** Centro inicial: enquadramento salvo → entrada da fazenda → Brasil. */
export function initialView(farmMap: { center: { lat: number; lng: number } | null; zoom: number | null } | null, entrance: { lat: number; lng: number } | null | undefined): { center: [number, number]; zoom: number } {
  if (farmMap?.center) return { center: [farmMap.center.lat, farmMap.center.lng], zoom: farmMap.zoom ?? 15 }
  if (entrance) return { center: [entrance.lat, entrance.lng], zoom: 15 }
  return { center: [-14.2, -51.9], zoom: 4 }
}

