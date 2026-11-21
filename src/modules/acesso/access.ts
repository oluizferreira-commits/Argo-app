import { newId } from '../../core/ids'
import type { ArgoDatabase } from '../../db/database'
import { Repository } from '../../db/repository'
import type { AccessOrigin, CachedRoute, Farm, GeoPoint, Landmark, LandmarkKind } from '../../db/types'
import { CoordError, haversine } from './geo'
import { fetchRoute } from './routing'

export const LANDMARK_LABELS: Record<LandmarkKind, string> = {
  referencia: 'Ponto de referência',
  bifurcacao: 'Bifurcação',
  atencao: 'Atenção (ponte, mata-burro, atoleiro…)',
}

/** Pontos a mais disto da porteira provavelmente foram marcados por engano. */
const MAX_LANDMARK_KM = 150

// ------------------------------------------------------------------ entrada e cidades

export async function setEntrance(db: ArgoDatabase, farmId: string, p: GeoPoint): Promise<Farm> {
  return new Repository(db, 'farms').update(farmId, { entrance: { lat: p.lat, lng: p.lng } })
}

export async function addOrigin(db: ArgoDatabase, farm: Farm, o: Omit<AccessOrigin, 'id'>): Promise<Farm> {
  const list = farm.accessOrigins ?? []
  if (list.some((x) => x.osm === o.osm || (x.name === o.name && x.region === o.region))) throw new CoordError(`${o.name} já está na lista.`)
  if (list.length >= 8) throw new CoordError('Limite de 8 cidades de origem.')
  return new Repository(db, 'farms').update(farm.id, { accessOrigins: [...list, { ...o, id: newId() }] })
}

export async function removeOrigin(db: ArgoDatabase, farm: Farm, originId: string): Promise<Farm> {
  await db.routeCache.delete(`${farm.id}|${originId}`)
  return new Repository(db, 'farms').update(farm.id, { accessOrigins: (farm.accessOrigins ?? []).filter((o) => o.id !== originId) })
}

// ------------------------------------------------------------------ pontos de referência

export interface LandmarkInput {
  name: string
  kind: LandmarkKind
  note: string
  lat: number
  lng: number
}

function cleanLandmark(farm: Farm, input: LandmarkInput): LandmarkInput {
  const name = input.name.trim()
  if (!name) throw new CoordError('Dê um nome ao ponto (ex.: "Ponte do córrego").')
  if (name.length > 60) throw new CoordError('Nome muito longo (máx. 60 caracteres).')
  if (!(input.kind in LANDMARK_LABELS)) throw new CoordError('Tipo de ponto inválido.')
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) throw new CoordError('Marque o local no mapa.')
  if (farm.entrance && haversine(farm.entrance, input) > MAX_LANDMARK_KM * 1000)
    throw new CoordError(`O ponto está a mais de ${MAX_LANDMARK_KM} km da fazenda. Confira o local.`)
  return { name, kind: input.kind, note: input.note.trim().slice(0, 200), lat: input.lat, lng: input.lng }
}

export async function addLandmark(db: ArgoDatabase, farm: Farm, input: LandmarkInput, idempotencyKey?: string): Promise<Landmark> {
  return new Repository(db, 'landmarks').create({ ...cleanLandmark(farm, input), farmId: farm.id }, idempotencyKey)
}

export async function updateLandmark(db: ArgoDatabase, farm: Farm, id: string, input: LandmarkInput): Promise<Landmark> {
  return new Repository(db, 'landmarks').update(id, cleanLandmark(farm, input))
}

export async function removeLandmark(db: ArgoDatabase, id: string): Promise<Landmark> {
  return new Repository(db, 'landmarks').softDelete(id)
}

// ------------------------------------------------------------------ rotas (cópia local)

const routeId = (farmId: string, originId: string) => `${farmId}|${originId}`

/** A cópia ainda vale se a porteira e a cidade não mudaram. */
export function cacheIsValid(r: CachedRoute | undefined, origin: GeoPoint, dest: GeoPoint): r is CachedRoute {
  return !!r && haversine(r.dest, dest) < 1 && haversine(r.origin, origin) < 1
}

export async function getCachedRoute(db: ArgoDatabase, farm: Farm, origin: AccessOrigin): Promise<CachedRoute | null> {
  if (!farm.entrance) return null
  const r = await db.routeCache.get(routeId(farm.id, origin.id))
  return cacheIsValid(r, origin, farm.entrance) ? r : null
}

/** Calcula pelo serviço de roteamento e guarda a cópia local. */
export async function computeRoute(db: ArgoDatabase, farm: Farm, origin: AccessOrigin, signal?: AbortSignal): Promise<CachedRoute> {
  if (!farm.entrance) throw new CoordError('Informe a coordenada da entrada principal.')
  const r = await fetchRoute({ lat: origin.lat, lng: origin.lng }, farm.entrance, signal)
  const cached: CachedRoute = { ...r, id: routeId(farm.id, origin.id), farmId: farm.id, originId: origin.id }
  await db.routeCache.put(cached)
  return cached
}

// ------------------------------------------------------------------ página pública

export interface SharePayload {
  v: 1
  farm: string
  entrance: GeoPoint
  origins: { name: string; region: string; lat: number; lng: number }[]
  landmarks: { name: string; kind: LandmarkKind; note: string; lat: number; lng: number }[]
}

export function buildSharePayload(farm: Farm, landmarks: readonly Landmark[]): SharePayload {
  if (!farm.entrance) throw new CoordError('Informe a coordenada da entrada principal.')
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6
  return {
    v: 1,
    farm: farm.name,
    entrance: { lat: r6(farm.entrance.lat), lng: r6(farm.entrance.lng) },
    origins: (farm.accessOrigins ?? []).map((o) => ({ name: o.name, region: o.region, lat: r6(o.lat), lng: r6(o.lng) })),
    landmarks: landmarks
      .filter((l) => l.deletedAt === null)
      .map((l) => ({ name: l.name, kind: l.kind, note: l.note, lat: r6(l.lat), lng: r6(l.lng) })),
  }
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): string {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

export function encodeShare(p: SharePayload): string {
  return toBase64Url(JSON.stringify(p))
}

/** Lê o conteúdo do link público; null se inválido. */
export function decodeShare(hash: string): SharePayload | null {
  try {
    const p = JSON.parse(fromBase64Url(hash.replace(/^#/, ''))) as SharePayload
    const okPoint = (x: unknown) => {
      const q = x as GeoPoint
      return q && Number.isFinite(q.lat) && Number.isFinite(q.lng) && Math.abs(q.lat) <= 90 && Math.abs(q.lng) <= 180
    }
    if (p.v !== 1 || typeof p.farm !== 'string' || !okPoint(p.entrance)) return null
    if (!Array.isArray(p.origins) || !p.origins.every(okPoint)) return null
    if (!Array.isArray(p.landmarks) || !p.landmarks.every(okPoint)) return null
    return {
      v: 1,
      farm: p.farm.slice(0, 60),
      entrance: { lat: p.entrance.lat, lng: p.entrance.lng },
      origins: p.origins.slice(0, 8).map((o) => ({ name: String(o.name).slice(0, 60), region: String(o.region ?? '').slice(0, 40), lat: o.lat, lng: o.lng })),
      landmarks: p.landmarks.slice(0, 50).map((l) => ({
        name: String(l.name).slice(0, 60),
        kind: (['referencia', 'bifurcacao', 'atencao'] as const).includes(l.kind) ? l.kind : 'referencia',
        note: String(l.note ?? '').slice(0, 200),
        lat: l.lat,
        lng: l.lng,
      })),
    }
  } catch {
    return null
  }
}

export function shareUrl(p: SharePayload): string {
  return `${location.origin}${import.meta.env.BASE_URL}acesso.html#${encodeShare(p)}`
}
