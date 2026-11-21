import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import type { GeoPoint, LandmarkKind } from '../../db/types'

/** Imagens de satélite (Esri World Imagery) + nomes de lugares. */
const SATELLITE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
export const MAP_ATTRIBUTION = 'Imagens © Esri, Maxar, Earthstar Geographics · Rotas: OSRM · Dados © colaboradores do OpenStreetMap'

export interface MapLandmark {
  name: string
  kind: LandmarkKind
  note?: string
  lat: number
  lng: number
}

export interface RouteMapProps {
  entrance: GeoPoint
  origin?: (GeoPoint & { name: string }) | null
  coords?: [number, number][] | null
  landmarks?: readonly MapLandmark[]
  /** Modo de marcação: toque no mapa escolhe um ponto. */
  onPick?: (p: GeoPoint) => void
  picked?: GeoPoint | null
  height?: number
}

const pin = (cls: string, html: string, size: [number, number], anchor: [number, number]) =>
  L.divIcon({ className: `argo-pin ${cls}`, html, iconSize: size, iconAnchor: anchor })

const ENTRANCE_ICON = pin(
  'argo-pin-entrance',
  `<svg viewBox="0 0 40 52" width="40" height="52"><path d="M20 51S2 31 2 19a18 18 0 0 1 36 0c0 12-18 32-18 32Z" fill="#16392f" stroke="#ebcb94" stroke-width="3"/><path d="M12 25v-8l8-5 8 5v8M17 25v-5h6v5" fill="none" stroke="#ebcb94" stroke-width="2.4" stroke-linejoin="round"/></svg><span>Entrada principal</span>`,
  [40, 52],
  [20, 51],
)

export function RouteMap(props: RouteMapProps) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const onPick = useRef(props.onPick)
  onPick.current = props.onPick

  // cria o mapa uma vez
  useEffect(() => {
    if (!el.current) return
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, tap: true } as L.MapOptions)
    L.tileLayer(SATELLITE, { maxZoom: 19, maxNativeZoom: 18, attribution: MAP_ATTRIBUTION, crossOrigin: true }).addTo(m)
    L.tileLayer(LABELS, { maxZoom: 19, maxNativeZoom: 18, opacity: 0.9, crossOrigin: true }).addTo(m)
    m.attributionControl.setPrefix(false)
    m.on('click', (e: L.LeafletMouseEvent) => onPick.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }))
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    return () => {
      m.remove()
      map.current = null
    }
  }, [])

  // desenha rota e marcadores
  const coordsKey = props.coords ? `${props.coords.length}|${props.coords[0]?.join()}|${props.coords.at(-1)?.join()}` : ''
  const lmKey = JSON.stringify(props.landmarks ?? [])
  useEffect(() => {
    const m = map.current
    const g = layer.current
    if (!m || !g) return
    g.clearLayers()
    const bounds = L.latLngBounds([[props.entrance.lat, props.entrance.lng]])
    if (props.coords && props.coords.length > 1) {
      L.polyline(props.coords, { color: '#0c241e', weight: 10, opacity: 0.75, lineJoin: 'round', interactive: false }).addTo(g)
      L.polyline(props.coords, { color: '#e4c690', weight: 5, opacity: 1, lineJoin: 'round', interactive: false }).addTo(g)
      for (const c of props.coords) bounds.extend(c)
    }
    if (props.origin) {
      L.marker([props.origin.lat, props.origin.lng], {
        icon: pin('argo-pin-origin', `<b></b><span>${escapeHtml(props.origin.name)}</span>`, [18, 18], [9, 9]),
        interactive: false,
      }).addTo(g)
      bounds.extend([props.origin.lat, props.origin.lng])
    }
    ;(props.landmarks ?? []).forEach((l, i) => {
      L.marker([l.lat, l.lng], {
        icon: pin(`argo-pin-lm argo-pin-${l.kind}`, `<b>${i + 1}</b><span>${escapeHtml(l.name)}</span>`, [26, 26], [13, 13]),
        interactive: false,
      }).addTo(g)
    })
    L.marker([props.entrance.lat, props.entrance.lng], { icon: ENTRANCE_ICON, zIndexOffset: 1000, interactive: false }).addTo(g)
    m.fitBounds(bounds.pad(0.12), { maxZoom: 16 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.entrance.lat, props.entrance.lng, coordsKey, lmKey, props.origin?.lat, props.origin?.lng])

  // marcador temporário do modo de marcação
  const pickRef = useRef<L.Marker | null>(null)
  useEffect(() => {
    const m = map.current
    if (!m) return
    pickRef.current?.remove()
    pickRef.current = props.picked
      ? L.marker([props.picked.lat, props.picked.lng], { icon: pin('argo-pin-pick', '<b>+</b>', [30, 30], [15, 15]), interactive: false }).addTo(m)
      : null
  }, [props.picked?.lat, props.picked?.lng, props.picked])

  return <div ref={el} className={`route-map${props.onPick ? ' picking' : ''}`} style={{ height: props.height ?? 380 }} />
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
