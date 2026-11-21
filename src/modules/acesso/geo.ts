import type { GeoPoint } from '../../db/types'

const R = 6371008.8 // raio médio da Terra (m)
const rad = (d: number) => (d * Math.PI) / 180

/** Distância em metros entre dois pontos (fórmula de haversine). */
export function haversine(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export class CoordError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CoordError'
  }
}

/**
 * Lê uma coordenada digitada/colada: "-10.123456, -48.123456", "-10,123456 -48,123456" ou "-10.123456;-48.123456".
 * Aceita só o território brasileiro (aproximado).
 */
export function parseCoordinate(text: string): GeoPoint {
  const normalized = text.trim().replace(/(\d),(\d)/g, '$1.$2')
  const nums = normalized.match(/-?\d+(?:\.\d+)?/g)
  if (!nums || nums.length !== 2) throw new CoordError('Informe latitude e longitude, ex.: -10.123456, -48.123456')
  const lat = Number(nums[0])
  const lng = Number(nums[1])
  if (!(lat >= -34 && lat <= 6) || !(lng >= -74 && lng <= -28))
    throw new CoordError('Coordenada fora do Brasil. Confira a ordem: latitude primeiro, depois longitude.')
  return { lat, lng }
}

export function formatCoordinate(p: GeoPoint): string {
  return `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`
}

export interface Projection {
  /** Distância (m) percorrida na rota desde a origem até o ponto mais próximo. */
  along: number
  /** Distância (m) do ponto até a rota. */
  offset: number
}

/** Projeta um ponto na rota (lista de [lat, lng]): quanto já se andou e quão longe está do caminho. */
export function projectOnRoute(coords: readonly [number, number][], p: GeoPoint): Projection {
  let best: Projection = { along: 0, offset: Infinity }
  let acc = 0
  const cosLat = Math.cos(rad(p.lat))
  for (let i = 0; i < coords.length - 1; i++) {
    const a = { lat: coords[i][0], lng: coords[i][1] }
    const b = { lat: coords[i + 1][0], lng: coords[i + 1][1] }
    const seg = haversine(a, b)
    // projeção plana local (suficiente para trechos curtos)
    const ax = (a.lng - p.lng) * cosLat
    const ay = a.lat - p.lat
    const bx = (b.lng - p.lng) * cosLat
    const by = b.lat - p.lat
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2))
    const q = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }
    const off = haversine(q, p)
    if (off < best.offset) best = { along: acc + seg * t, offset: off }
    acc += seg
  }
  return best
}

export function formatKm(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: m < 10000 ? 1 : 0 })} km`
}

export function formatDuration(s: number): string {
  const min = Math.round(s / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

/** Links que abrem a navegação no app de mapas do visitante (a partir da localização dele). */
export function navigationLinks(dest: GeoPoint) {
  const ll = `${dest.lat},${dest.lng}`
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`,
    waze: `https://waze.com/ul?ll=${ll}&navigate=yes`,
    apple: `https://maps.apple.com/?daddr=${ll}&dirflg=d`,
  }
}
