import { nowIso } from '../../core/ids'
import type { CachedRoute, GeoPoint, RouteStep } from '../../db/types'

/**
 * Roteamento rodoviário: OSRM (servidor público do Project OSRM, dados do OpenStreetMap).
 * As rotas acompanham as estradas reais do mapa; nunca são linhas retas.
 */
const OSRM = 'https://router.project-osrm.org/route/v1/driving'

/** A estrada mapeada precisa terminar perto da porteira para a rota ser considerada validada. */
export const GATE_TOLERANCE_M = 150

export class RoutingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RoutingError'
  }
}

interface OsrmStep {
  distance: number
  name?: string
  ref?: string
  maneuver: { type: string; modifier?: string; location: [number, number]; exit?: number }
}

interface OsrmResponse {
  code: string
  message?: string
  routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] }; legs: { steps: OsrmStep[] }[] }[]
  waypoints?: { distance: number; location: [number, number] }[]
}

export type RouteResult = Omit<CachedRoute, 'id' | 'farmId' | 'originId'>

/** Converte a resposta do OSRM no formato do ARGO (coordenadas [lat, lng]). */
export function parseOsrm(data: OsrmResponse, origin: GeoPoint, dest: GeoPoint): RouteResult {
  if (data.code !== 'Ok' || !data.routes?.length || !data.waypoints || data.waypoints.length < 2) {
    throw new RoutingError(data.code === 'NoRoute' ? 'Não existe rota por estrada entre estes pontos no mapa.' : `Falha no roteamento (${data.code}).`)
  }
  const r = data.routes[0]
  const steps: RouteStep[] = r.legs.flatMap((leg) =>
    leg.steps.map((s) => ({
      type: s.maneuver.type,
      modifier: s.maneuver.modifier ?? '',
      name: s.name ?? '',
      ref: s.ref ?? '',
      distance: s.distance,
      lat: s.maneuver.location[1],
      lng: s.maneuver.location[0],
      ...(s.maneuver.exit ? { exit: s.maneuver.exit } : {}),
    })),
  )
  return {
    origin,
    dest,
    distance: r.distance,
    duration: r.duration,
    coords: r.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]),
    steps,
    snapStart: data.waypoints[0].distance,
    snapEnd: data.waypoints[data.waypoints.length - 1].distance,
    computedAt: nowIso(),
  }
}

/** Calcula a rota por estrada. Exige internet. */
export async function fetchRoute(origin: GeoPoint, dest: GeoPoint, signal?: AbortSignal): Promise<RouteResult> {
  const url = `${OSRM}/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson&steps=true&alternatives=false`
  let res: Response
  try {
    res = await fetch(url, { signal })
  } catch {
    throw new RoutingError('Sem conexão com o serviço de rotas. Verifique a internet.')
  }
  if (res.status === 429) throw new RoutingError('Serviço de rotas ocupado. Tente de novo em alguns segundos.')
  if (!res.ok) throw new RoutingError(`Serviço de rotas indisponível (HTTP ${res.status}).`)
  return parseOsrm((await res.json()) as OsrmResponse, origin, dest)
}

/** A estrada mapeada chega até a porteira oficial? */
export function reachesGate(r: Pick<RouteResult, 'snapEnd'>): boolean {
  return r.snapEnd <= GATE_TOLERANCE_M
}
