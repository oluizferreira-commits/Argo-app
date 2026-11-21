import type { CachedRoute } from '../../db/types'
import type { MapLandmark } from './RouteMap'
import { projectOnRoute } from './geo'
import { buildGuide } from './instructions'

/** Pontos a até esta distância do traçado entram no passo a passo, no km certo. */
export const ON_ROUTE_M = 300

export interface GuideItem {
  kind: 'step' | 'landmark'
  text: string
  note?: string
  at: number
  /** número do ponto no mapa (landmark) */
  index?: number
  landmarkKind?: MapLandmark['kind']
}

/** Passo a passo da rota com os pontos de referência intercalados por quilometragem. */
export function guideWithLandmarks(
  route: Pick<CachedRoute, 'coords' | 'steps'>,
  originName: string,
  landmarks: readonly MapLandmark[],
): { items: GuideItem[]; offRoute: { index: number; lm: MapLandmark }[] } {
  const items: GuideItem[] = buildGuide(route.steps, originName).map((g) => ({ kind: 'step', text: g.text, at: g.at }))
  const offRoute: { index: number; lm: MapLandmark }[] = []
  landmarks.forEach((lm, i) => {
    const p = projectOnRoute(route.coords, lm)
    if (p.offset <= ON_ROUTE_M) items.push({ kind: 'landmark', text: lm.name, note: lm.note, at: p.along, index: i + 1, landmarkKind: lm.kind })
    else offRoute.push({ index: i + 1, lm })
  })
  const arrive = items.findIndex((x) => x.kind === 'step' && x.text.startsWith('Chegada'))
  const arrival = arrive >= 0 ? items.splice(arrive, 1)[0] : null
  items.sort((a, b) => a.at - b.at)
  if (arrival) items.push(arrival)
  return { items, offRoute }
}
