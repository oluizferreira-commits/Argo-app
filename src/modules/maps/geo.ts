/**
 * ARGO Maps — geometria (funções puras, sem mapa e sem banco).
 *
 * Coordenadas no padrão GeoJSON: [longitude, latitude] em graus (WGS 84).
 * Área e perímetro são ESTIMATIVAS CARTOGRÁFICAS sobre a esfera (raio médio da Terra),
 * adequadas para gestão — não são georreferenciamento legal nem levantamento topográfico.
 */

export type LngLat = [number, number]
/** Anel aberto (o primeiro ponto NÃO é repetido no fim). */
export type Ring = LngLat[]

export interface PolygonGeometry {
  type: 'Polygon'
  /** GeoJSON: anel externo fechado (primeiro ponto repetido no fim). */
  coordinates: LngLat[][]
}

const R = 6371008.8 // raio médio da Terra (m), o mesmo usado por bibliotecas como Turf
const rad = (d: number) => (d * Math.PI) / 180

/** Anel aberto → geometria GeoJSON (anel fechado, sentido anti-horário, 7 casas ≈ 1 cm). */
export function toGeometry(ring: Ring): PolygonGeometry {
  const r = ring.map(([x, y]) => [round7(x), round7(y)] as LngLat)
  const ccw = signedArea(r) > 0 ? r : [...r].reverse()
  return { type: 'Polygon', coordinates: [[...ccw, ccw[0]]] }
}

/** Geometria GeoJSON → anel aberto. */
export function fromGeometry(g: PolygonGeometry): Ring {
  const outer = g.coordinates[0] ?? []
  const open = outer.length > 1 && samePoint(outer[0], outer[outer.length - 1]) ? outer.slice(0, -1) : outer
  return open.map(([x, y]) => [x, y] as LngLat)
}

const round7 = (v: number) => Math.round(v * 1e7) / 1e7
export const samePoint = (a: LngLat, b: LngLat) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9

/** Área plana com sinal (só para orientação). */
function signedArea(ring: Ring): number {
  let s = 0
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % ring.length]
    s += x1 * y2 - x2 * y1
  }
  return s / 2
}

/** Área do anel em m² sobre a esfera (fórmula de Chamberlain & Duquette). */
export function areaM2(ring: Ring): number {
  const n = ring.length
  if (n < 3) return 0
  let total = 0
  for (let i = 0; i < n; i++) {
    const p1 = ring[i]
    const p2 = ring[(i + 1) % n]
    const p3 = ring[(i + 2) % n]
    total += (rad(p3[0]) - rad(p1[0])) * Math.sin(rad(p2[1]))
  }
  return Math.abs((total * R * R) / 2)
}

/** Distância em metros entre dois pontos (haversine). */
export function distanceM(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1])
  const dLng = rad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Perímetro do anel (fechado) em metros. */
export function perimeterM(ring: Ring): number {
  if (ring.length < 2) return 0
  let s = 0
  for (let i = 0; i < ring.length; i++) s += distanceM(ring[i], ring[(i + 1) % ring.length])
  return s
}

/** m² → centésimos de hectare (inteiro, como no resto do ARGO). */
export const m2ToCentiHa = (m2: number) => Math.round(m2 / 100)

export function formatHa(centiHa: number): string {
  return `${(centiHa / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha`
}

export function formatMeters(m: number): string {
  return m >= 1000 ? `${(m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} km` : `${Math.round(m).toLocaleString('pt-BR')} m`
}

// ------------------------------------------------------------------ interseções

/** Projeção local plana (metros) em torno de uma latitude — para testes de cruzamento e encaixe. */
export function projector(lat0: number) {
  const k = Math.cos(rad(lat0))
  return {
    fwd: ([lng, lat]: LngLat): [number, number] => [rad(lng) * R * k, rad(lat) * R],
    inv: ([x, y]: [number, number]): LngLat => [(x / (R * k)) * (180 / Math.PI), (y / R) * (180 / Math.PI)],
  }
}

type P = [number, number]
const cross = (o: P, a: P, b: P) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

/**
 * Cruzamento "de verdade" (em X) entre dois segmentos, em metros. Encostar, dividir trecho ou passar a menos
 * de `tolM` (diferença de encaixe/arredondamento) não conta.
 */
export function segmentsCross(a: P, b: P, c: P, d: P, tolM = 0.3): boolean {
  const lcd = Math.hypot(d[0] - c[0], d[1] - c[1]) || 1
  const lab = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  const d1 = cross(c, d, a) / lcd
  const d2 = cross(c, d, b) / lcd
  const d3 = cross(a, b, c) / lab
  const d4 = cross(a, b, d) / lab
  return ((d1 > tolM && d2 < -tolM) || (d1 < -tolM && d2 > tolM)) && ((d3 > tolM && d4 < -tolM) || (d3 < -tolM && d4 > tolM))
}

function projectRing(ring: Ring, lat0: number): P[] {
  const pr = projector(lat0)
  return ring.map(pr.fwd)
}

/** O contorno cruza com ele mesmo (formato de "8")? */
export function selfIntersects(ring: Ring): boolean {
  const n = ring.length
  if (n < 4) return false
  const p = projectRing(ring, ring[0][1])
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue // vizinhos
      if (segmentsCross(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) return true
    }
  }
  return false
}

/** Ponto dentro do polígono (borda: -1 = fora, 0 = na borda, 1 = dentro). Tolerância em metros. */
export function pointInRing(pt: LngLat, ring: Ring, tolM = 0.5): -1 | 0 | 1 {
  const lat0 = pt[1]
  const p = projector(lat0).fwd(pt)
  const r = projectRing(ring, lat0)
  let inside = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i]
    const b = r[j]
    if (distToSegment(p, a, b) <= tolM) return 0
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside ? 1 : -1
}

function distToSegment(p: P, a: P, b: P): number {
  const [q] = closestOnSegment(p, a, b)
  return Math.hypot(p[0] - q[0], p[1] - q[1])
}

export function closestOnSegment(p: P, a: P, b: P): [P, number] {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return [[a[0] + t * dx, a[1] + t * dy], t]
}

/**
 * Dois polígonos se sobrepõem (ocupam a mesma área)? Dividir a cerca (borda comum) não é sobreposição.
 * Detecta: bordas que se cruzam, vértice de um dentro do outro, ou um dentro do outro.
 */
export function ringsOverlap(a: Ring, b: Ring): boolean {
  const lat0 = a[0][1]
  const pa = ccw(projectRing(a, lat0))
  const pb = ccw(projectRing(b, lat0))
  for (let i = 0; i < pa.length; i++) {
    for (let j = 0; j < pb.length; j++) {
      if (segmentsCross(pa[i], pa[(i + 1) % pa.length], pb[j], pb[(j + 1) % pb.length])) return true
    }
  }
  // pontos logo para dentro de cada canto e do meio de cada lado: se algum cair dentro do outro, há área em comum
  return probes(pa).some((p) => inside(p, pb)) || probes(pb).some((p) => inside(p, pa))
}

function ccw(p: P[]): P[] {
  let s = 0
  for (let i = 0; i < p.length; i++) s += p[i][0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * p[i][1]
  return s >= 0 ? p : [...p].reverse()
}

/** Pontos 0,5 m para dentro do polígono (anti-horário): cantos e meio dos lados. */
function probes(p: P[], d = 0.5): P[] {
  const n = p.length
  const out: P[] = []
  const normal = (a: P, b: P): P => {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    return [-dy / len, dx / len] // à esquerda = para dentro
  }
  for (let i = 0; i < n; i++) {
    const prev = p[(i - 1 + n) % n]
    const cur = p[i]
    const next = p[(i + 1) % n]
    const n1 = normal(prev, cur)
    const n2 = normal(cur, next)
    const bx = n1[0] + n2[0]
    const by = n1[1] + n2[1]
    const bl = Math.hypot(bx, by) || 1
    out.push([cur[0] + (bx / bl) * d, cur[1] + (by / bl) * d])
    out.push([(cur[0] + next[0]) / 2 + n2[0] * d, (cur[1] + next[1]) / 2 + n2[1] * d])
  }
  return out
}

/** Ponto estritamente dentro (projetado, metros), com folga de 1 cm da borda. */
function inside(pt: P, r: P[]): boolean {
  let ins = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i]
    const b = r[j]
    if (distToSegment(pt, a, b) <= 0.01) return false
    if (a[1] > pt[1] !== b[1] > pt[1] && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) ins = !ins
  }
  return ins
}

/** O polígono `inner` está dentro de `outer` (bordas podem coincidir)? */
export function ringInside(inner: Ring, outer: Ring): boolean {
  if (!inner.every((pt) => pointInRing(pt, outer) >= 0)) return false
  const lat0 = inner[0][1]
  const pi = projectRing(inner, lat0)
  const po = projectRing(outer, lat0)
  for (let i = 0; i < pi.length; i++) for (let j = 0; j < po.length; j++) if (segmentsCross(pi[i], pi[(i + 1) % pi.length], po[j], po[(j + 1) % po.length])) return false
  return true
}

/** Um ponto garantidamente dentro do polígono (para o nome do pasto). */
export function interiorPoint(ring: Ring): LngLat | null {
  if (ring.length < 3) return null
  const c = centroid(ring)
  if (pointInRing(c, ring, 0) === 1) return c
  // polígono côncavo: varre uma linha horizontal pelo meio e pega o meio do trecho interno mais largo
  const lat0 = ring[0][1]
  const pr = projector(lat0)
  const p = projectRing(ring, lat0)
  const ys = p.map((q) => q[1])
  const y = (Math.min(...ys) + Math.max(...ys)) / 2
  const xs: number[] = []
  for (let i = 0; i < p.length; i++) {
    const a = p[i]
    const b = p[(i + 1) % p.length]
    if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]))
  }
  xs.sort((m, n) => m - n)
  let best: [number, number] | null = null
  for (let i = 0; i + 1 < xs.length; i += 2) if (!best || xs[i + 1] - xs[i] > best[1] - best[0]) best = [xs[i], xs[i + 1]]
  return best ? pr.inv([(best[0] + best[1]) / 2, y]) : c
}

export function centroid(ring: Ring): LngLat {
  const lat0 = ring[0][1]
  const pr = projector(lat0)
  const p = projectRing(ring, lat0)
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i]
    const [x2, y2] = p[(i + 1) % p.length]
    const f = x1 * y2 - x2 * y1
    a += f
    cx += (x1 + x2) * f
    cy += (y1 + y2) * f
  }
  if (Math.abs(a) < 1e-9) return ring[0]
  return pr.inv([cx / (3 * a), cy / (3 * a)])
}

export function bounds(rings: Ring[]): [[number, number], [number, number]] | null {
  const pts = rings.flat()
  if (!pts.length) return null
  const lats = pts.map((p) => p[1])
  const lngs = pts.map((p) => p[0])
  return [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ]
}

// ------------------------------------------------------------------ validação de um contorno

export type RingProblem = 'poucos-pontos' | 'cruza' | 'area-zero'

export function ringProblem(ring: Ring): RingProblem | null {
  if (ring.length < 3) return 'poucos-pontos'
  if (selfIntersects(ring)) return 'cruza'
  if (areaM2(ring) < 1) return 'area-zero'
  return null
}

export const RING_PROBLEM_TEXT: Record<RingProblem, string> = {
  'poucos-pontos': 'Marque pelo menos 3 pontos.',
  cruza: 'O contorno está se cruzando (formato de "8"). Arraste os pontos para desfazer o cruzamento.',
  'area-zero': 'O contorno não tem área. Afaste os pontos.',
}

/** Leitura de coordenadas digitadas: "-10,123, -48,456" / "-10.123 -48.456" / "10°7'S 48°27'W" simples. */
export function parseCoordinates(text: string): LngLat | null {
  const t = text.trim().replace(/;/g, ' ')
  // decimal com ponto: "-10.12, -48.45"
  let m = /^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(t)
  // decimal com vírgula: "-10,12 -48,45"
  if (!m) m = /^(-?\d{1,2}(?:,\d+)?)\s+(-?\d{1,3}(?:,\d+)?)$/.exec(t)
  if (!m) return null
  const lat = Number(m[1].replace(',', '.'))
  const lng = Number(m[2].replace(',', '.'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return [lng, lat]
}
