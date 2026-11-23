/**
 * ARGO Maps — mapa ILUSTRADO semi-realista, gerado na hora a partir dos contornos cadastrados.
 *
 * Nada aqui é imagem fixa nem dado inventado:
 * - capim, mata, água e sede só aparecem onde o proprietário desenhou e escolheu o tipo;
 * - cercas seguem exatamente as divisas desenhadas;
 * - o gado é ilustrativo (poucos animais, só em pastos que TÊM cabeças no Rebanho), não representa cada animal
 *   nem posição real (não é rastreamento).
 * Desenhado em SVG por cima do mapa e refeito ao mover/aproximar (camada leve, sem bibliotecas novas).
 */
import L from 'leaflet'
import type { MapShape } from '../../db/types'
import { formatHa, fromGeometry, interiorPoint, pointInRing, type LngLat, type Ring } from './geo'
import type { ShapeView } from './layers'

const NS = 'http://www.w3.org/2000/svg'

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  parent?.appendChild(e)
  return e
}

/** Número estável a partir do id (mesma aparência sempre, sem sortear a cada abertura). */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
function rng(seed: number) {
  let a = seed || 1
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Texturas e efeitos (uma vez por camada). */
function defs(svg: SVGSVGElement) {
  const d = el('defs', {}, svg)
  // capim: 3 tons de pasto ocupado e 2 de pasto vazio (mais alto/seco)
  const grass: [string, string, string, string][] = [
    ['grass-0', '#7aa95e', '#8cba6c', '#5f8f4a'],
    ['grass-1', '#83b66a', '#97c47a', '#679a52'],
    ['grass-2', '#76a35a', '#88b468', '#5a8946'],
    ['grass-dry-0', '#a5c98a', '#b8d49b', '#8fb373'],
    ['grass-dry-1', '#9fc283', '#b3cf95', '#89ad6e'],
  ]
  for (const [id, base, light, dark] of grass) {
    const p = el('pattern', { id: `argo-${id}`, width: 46, height: 46, patternUnits: 'userSpaceOnUse' }, d)
    el('rect', { width: 46, height: 46, fill: base }, p)
    // manchas (relevo e touceiras)
    el('ellipse', { cx: 10, cy: 12, rx: 11, ry: 7, fill: light, opacity: 0.45 }, p)
    el('ellipse', { cx: 34, cy: 30, rx: 13, ry: 8, fill: dark, opacity: 0.28 }, p)
    el('ellipse', { cx: 36, cy: 6, rx: 7, ry: 4, fill: dark, opacity: 0.2 }, p)
    el('ellipse', { cx: 8, cy: 38, rx: 8, ry: 5, fill: light, opacity: 0.35 }, p)
    // folhas de capim
    const blades = el('g', { stroke: dark, 'stroke-width': 0.9, 'stroke-linecap': 'round', opacity: 0.55 }, p)
    for (const [x, y] of [
      [6, 22],
      [20, 8],
      [28, 20],
      [40, 40],
      [16, 34],
      [42, 16],
    ])
      el('path', { d: `M${x} ${y}l-1.6-3.6M${x + 1.5} ${y}l.4-4M${x + 3} ${y}l1.8-3.2` }, blades)
    const lb = el('g', { stroke: light, 'stroke-width': 0.8, 'stroke-linecap': 'round', opacity: 0.6 }, p)
    for (const [x, y] of [
      [12, 28],
      [32, 10],
      [24, 42],
    ])
      el('path', { d: `M${x} ${y}l-1.2-3M${x + 1.4} ${y}l1.3-3` }, lb)
  }
  // mata: copas de árvores vistas de cima
  const forest = el('pattern', { id: 'argo-forest', width: 38, height: 38, patternUnits: 'userSpaceOnUse' }, d)
  el('rect', { width: 38, height: 38, fill: '#2a5235' }, forest)
  for (const [x, y, r, c] of [
    [8, 9, 8, '#3c7343'],
    [27, 7, 7, '#356a3d'],
    [19, 22, 9, '#417c47'],
    [5, 31, 7, '#386e3f'],
    [33, 29, 8, '#3a7041'],
  ] as const) {
    el('circle', { cx: x + 1.5, cy: y + 2, r, fill: '#173d2d', opacity: 0.5 }, forest)
    el('circle', { cx: x, cy: y, r, fill: c }, forest)
    el('circle', { cx: x - r * 0.3, cy: y - r * 0.35, r: r * 0.45, fill: '#5e9a5a', opacity: 0.55 }, forest)
  }
  // água
  const wg = el('linearGradient', { id: 'argo-water-g', x1: 0, y1: 0, x2: 1, y2: 1 }, d)
  el('stop', { offset: 0, 'stop-color': '#8ccbdc' }, wg)
  el('stop', { offset: 1, 'stop-color': '#4f97b3' }, wg)
  const water = el('pattern', { id: 'argo-water', width: 60, height: 30, patternUnits: 'userSpaceOnUse' }, d)
  el('rect', { width: 60, height: 30, fill: 'transparent' }, water)
  el('path', { d: 'M4 10q6-4 12 0t12 0M30 24q6-4 12 0t12 0', stroke: '#e8f6fb', 'stroke-width': 1, fill: 'none', opacity: 0.5 }, water)
  // sede / terreiro
  const yard = el('pattern', { id: 'argo-yard', width: 24, height: 24, patternUnits: 'userSpaceOnUse' }, d)
  el('rect', { width: 24, height: 24, fill: '#b4946a' }, yard)
  el('circle', { cx: 6, cy: 7, r: 1.2, fill: '#cdb38a' }, yard)
  el('circle', { cx: 17, cy: 15, r: 1, fill: '#8f7350' }, yard)
  el('circle', { cx: 9, cy: 19, r: 0.9, fill: '#cdb38a' }, yard)
  // outra área: hachura
  const other = el('pattern', { id: 'argo-other', width: 10, height: 10, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, d)
  el('rect', { width: 10, height: 10, fill: '#6f7f55' }, other)
  el('line', { x1: 0, y1: 0, x2: 0, y2: 10, stroke: '#8b9a6c', 'stroke-width': 3 }, other)
  // luz do sol (de cima à esquerda) e sombra
  const sun = el('linearGradient', { id: 'argo-sun', x1: 0, y1: 0, x2: 1, y2: 1 }, d)
  el('stop', { offset: 0, 'stop-color': '#fff3cf', 'stop-opacity': 0.22 }, sun)
  el('stop', { offset: 0.55, 'stop-color': '#fff3cf', 'stop-opacity': 0 }, sun)
  el('stop', { offset: 1, 'stop-color': '#0b2318', 'stop-opacity': 0.22 }, sun)
  const sh = el('filter', { id: 'argo-shadow', x: '-10%', y: '-10%', width: '120%', height: '120%' }, d)
  el('feDropShadow', { dx: 0, dy: 2.5, stdDeviation: 2.2, 'flood-color': '#06140e', 'flood-opacity': 0.45 }, sh)
}

/** Vaca nelore vista de cima (≈ 20 px), voltada para a direita. */
function cow(parent: Element, x: number, y: number, angle: number, scale: number, delay: number, dur: number) {
  const g = el('g', { transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${angle.toFixed(0)}) scale(${scale.toFixed(2)})` }, parent)
  const a = el('g', { class: 'map-cow', style: `animation-delay:${delay.toFixed(1)}s;animation-duration:${dur.toFixed(1)}s` }, g)
  el('ellipse', { cx: 1.6, cy: 2.4, rx: 8.2, ry: 4, fill: '#0b2318', opacity: 0.32 }, a) // sombra
  el('path', { d: 'M-9.2 0l-2.4 .6', stroke: '#b9aa8d', 'stroke-width': 0.9, 'stroke-linecap': 'round' }, a) // rabo
  el('path', { d: 'M-6.6 -3.3h9.4a3.2 3.2 0 0 1 3.1 3.3 3.2 3.2 0 0 1-3.1 3.3h-9.4A2.8 2.8 0 0 1-9.3 0a2.8 2.8 0 0 1 2.7-3.3Z', fill: '#efe7d6' }, a) // corpo
  el('path', { d: 'M-6.4 2.9h9.2a3 3 0 0 0 2.9-2.2', stroke: '#cfc2a8', 'stroke-width': 1, fill: 'none', opacity: 0.8 }, a) // sombra do corpo
  el('ellipse', { cx: 3.4, cy: 0, rx: 2.3, ry: 2.5, fill: '#d9cdb5' }, a) // cupim
  el('path', { d: 'M6.2 -1.7c2.4-.4 4.6.1 5 1.7-.4 1.6-2.6 2.1-5 1.7Z', fill: '#bfb39c' }, a) // cabeça (cinza do nelore)
  el('ellipse', { cx: 11, cy: 0, rx: 0.9, ry: 1.1, fill: '#6e6354' }, a) // focinho
  el('path', { d: 'M6.6 -1.6l-.9-1.6M6.6 1.6l-.9 1.6', stroke: '#b3a68e', 'stroke-width': 1.1, 'stroke-linecap': 'round' }, a) // orelhas
  el('path', { d: 'M-6 -2.1c3-1 7.5-1.1 9.6-.3', stroke: '#fffaf0', 'stroke-width': 1, fill: 'none', opacity: 0.7 }, a) // brilho do sol
}

const MAX_COWS_PER_PASTURE = 6
const MAX_COWS_TOTAL = 40

/** Pontos de gado estáveis (em coordenadas geográficas) dentro do pasto, longe das cercas. */
const spotCache = new Map<string, LngLat[]>()
function cattleSpots(shape: MapShape, n: number): LngLat[] {
  const key = `${shape.id}:${shape.geometryVersion}:${n}`
  const hit = spotCache.get(key)
  if (hit) return hit
  const ring = fromGeometry(shape.geometry)
  const lngs = ring.map((p) => p[0])
  const lats = ring.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...lngs), Math.max(...lngs), Math.min(...lats), Math.max(...lats)]
  // margem da cerca: ~8% do lado do pasto
  const margin = Math.sqrt(shape.areaCentiHa * 100) * 0.08
  const r = rng(hash(shape.id))
  const out: LngLat[] = []
  // gado anda em grupo: sorteia um centro e espalha em volta
  let center: LngLat = interiorPoint(ring) ?? ring[0]
  for (let i = 0; i < 60; i++) {
    const c: LngLat = [x0 + r() * (x1 - x0), y0 + r() * (y1 - y0)]
    // longe do meio (onde fica a placa com o nome) e longe das cercas
    if (pointInRing(c, ring, margin * 2) === 1 && Math.hypot(c[0] - center[0], (c[1] - center[1]) * 1.0) > (x1 - x0) * 0.18) {
      center = c
      break
    }
  }
  for (let tries = 0; out.length < n && tries < 400; tries++) {
    const spread = tries < 200 ? 0.35 : 1
    const p: LngLat = [center[0] + (r() - 0.5) * (x1 - x0) * spread, center[1] + (r() - 0.5) * (y1 - y0) * spread]
    if (p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1) continue
    if (pointInRing(p, ring, margin) !== 1) continue
    out.push(p)
  }
  spotCache.set(key, out)
  return out
}

export interface IllustratedOptions {
  selectedId?: string | null
  onSelect?: (id: string) => void
  /** mostra gado ilustrativo nos pastos com animais */
  cattle?: boolean
}

/**
 * Camada do mapa ilustrado. Devolve `{ remove }`. Refaz o desenho ao terminar de mover/aproximar
 * (durante a animação de zoom fica escondida, como as camadas do próprio Leaflet).
 */
export function drawIllustrated(map: L.Map, views: readonly ShapeView[], opts: IllustratedOptions = {}) {
  const svg = el('svg', { class: 'argo-illustrated leaflet-zoom-hide', 'aria-hidden': 'true' })
  map.getPanes().overlayPane.appendChild(svg)
  const lowPower = (navigator.hardwareConcurrency ?? 4) <= 2

  const redraw = () => {
    while (svg.firstChild) svg.removeChild(svg.firstChild)
    defs(svg)
    const size = map.getSize()
    const pad = 0.5
    const min = map.containerPointToLayerPoint([-size.x * pad, -size.y * pad])
    const w = size.x * (1 + 2 * pad)
    const h = size.y * (1 + 2 * pad)
    L.DomUtil.setPosition(svg as unknown as HTMLElement, min)
    svg.setAttribute('width', String(w))
    svg.setAttribute('height', String(h))
    svg.setAttribute('viewBox', `${min.x} ${min.y} ${w} ${h}`)
    const zoom = map.getZoom()
    const pt = ([lng, lat]: LngLat) => map.latLngToLayerPoint([lat, lng])
    const pathOf = (ring: Ring) => ring.map((p, i) => `${i ? 'L' : 'M'}${pt(p).x.toFixed(1)} ${pt(p).y.toFixed(1)}`).join('') + 'Z'

    const perimeter = views.find((v) => v.shape.kind === 'perimetro')
    // fora da fazenda: escurece (foco na propriedade)
    if (perimeter)
      el('path', { d: `M${min.x} ${min.y}h${w}v${h}h${-w}Z${pathOf(fromGeometry(perimeter.shape.geometry))}`, 'fill-rule': 'evenodd', fill: '#0c241c', opacity: 0.55 }, svg)

    const ground = el('g', { filter: 'url(#argo-shadow)' }, svg)
    const fences = el('g', {}, svg)
    const cattle = el('g', { class: lowPower ? 'still' : '' }, svg)
    const labels = el('g', {}, svg)
    let cowsLeft = MAX_COWS_TOTAL

    const inner = views.filter((v) => v.shape.kind !== 'perimetro').sort((a, b) => b.shape.areaCentiHa - a.shape.areaCentiHa)
    const placed: { x: number; y: number; w: number; h: number }[] = []
    const fits = (x: number, y: number, w: number, h: number) => {
      if (placed.some((p) => Math.abs(p.x - x) < (p.w + w) / 2 + 4 && Math.abs(p.y - y) < (p.h + h) / 2 + 4)) return false
      placed.push({ x, y, w, h })
      return true
    }
    // dentro do perímetro sem pasto: terra/capim nativo neutro
    if (perimeter) el('path', { d: pathOf(fromGeometry(perimeter.shape.geometry)), fill: '#8a9a62' }, ground)

    for (const v of inner) {
      const s = v.shape
      const ring = fromGeometry(s.geometry)
      const d = pathOf(ring)
      const hv = hash(s.id)
      let fill: string
      if (s.kind === 'pasto') fill = (v.heads ?? 0) > 0 ? `url(#argo-grass-${hv % 3})` : `url(#argo-grass-dry-${hv % 2})`
      else fill = s.areaType === 'mata' ? 'url(#argo-forest)' : s.areaType === 'agua' ? 'url(#argo-water-g)' : s.areaType === 'sede' ? 'url(#argo-yard)' : 'url(#argo-other)'
      const shape = el('path', { d, fill }, ground)
      if (s.areaType === 'agua' && s.kind === 'nao-produtiva') {
        el('path', { d, fill: 'url(#argo-water)' }, ground)
        el('path', { d, fill: 'none', stroke: '#d9c49a', 'stroke-width': 3, 'stroke-linejoin': 'round', opacity: 0.9 }, fences) // margem de areia
      }
      el('path', { d, fill: 'url(#argo-sun)', 'pointer-events': 'none' }, ground)
      // cerca: arame + mourões
      if (s.kind === 'pasto' || s.areaType === 'mata') {
        el('path', { d, fill: 'none', stroke: '#efe3c4', 'stroke-width': 1.3, opacity: 0.85, 'stroke-linejoin': 'round' }, fences)
        if (zoom >= 15) el('path', { d, fill: 'none', stroke: '#5b4126', 'stroke-width': 3.4, 'stroke-dasharray': '0.1 11', 'stroke-linecap': 'round' }, fences)
      }
      if (opts.selectedId === s.id) {
        el('path', { d, fill: 'none', stroke: '#f3d58f', 'stroke-width': 7, opacity: 0.35, 'stroke-linejoin': 'round' }, fences)
        el('path', { d, fill: 'none', stroke: '#f3d58f', 'stroke-width': 2.6, 'stroke-linejoin': 'round' }, fences)
      }
      if (opts.onSelect && s.kind !== 'perimetro') {
        const hit = el('path', { d, fill: 'transparent', class: 'leaflet-interactive', 'data-shape': s.id }, svg)
        const t = el('title', {}, hit)
        t.textContent = v.label
        L.DomEvent.on(hit as unknown as HTMLElement, 'click', (e) => {
          L.DomEvent.stopPropagation(e)
          opts.onSelect!(s.id)
        })
      }
      void shape

      // tamanho do pasto na tela: decide gado e placa
      const pts = ring.map(pt)
      const xs = pts.map((p) => p.x)
      const ys = pts.map((p) => p.y)
      const sw = Math.max(...xs) - Math.min(...xs)
      const shh = Math.max(...ys) - Math.min(...ys)

      if (opts.cattle !== false && s.kind === 'pasto' && (v.heads ?? 0) > 0 && cowsLeft > 0 && zoom >= 14 && sw > 50 && shh > 40) {
        const want = Math.min(MAX_COWS_PER_PASTURE, Math.ceil((v.heads ?? 0) / 25), Math.floor((sw * shh) / 1800), cowsLeft)
        const spots = cattleSpots(s, want)
        const r = rng(hv)
        const scale = Math.max(0.85, Math.min(1.5, 1.05 + (zoom - 15) * 0.2))
        // gado pastando em grupo: quase todos virados para o mesmo lado
        const heading = r() * 360
        for (const sp of spots) {
          const p = pt(sp)
          cow(cattle, p.x, p.y, heading + (r() - 0.5) * 70, scale, -r() * 20, 14 + r() * 12)
          cowsLeft--
        }
      }

      // placa com o nome (só se couber)
      const ip = interiorPoint(ring)
      if (ip && sw > 54 && shh > 26) {
        const c = pt(ip)
        const name = v.label
        // placa compacta quando o pasto aparece pequeno na tela
        const compact = sw < 170
        const showInfo = !compact && shh > 50
        const info = s.kind === 'pasto' ? `${formatHa(s.areaCentiHa)}${(v.heads ?? 0) > 0 ? ` · ${(v.heads ?? 0).toLocaleString('pt-BR')} cab.` : ''}` : formatHa(s.areaCentiHa)
        const fw = Math.max(name.length * (compact ? 6.3 : 7.4), showInfo ? info.length * 5.9 : 0) + (compact ? 12 : 18)
        const fh = showInfo ? 36 : compact ? 19 : 22
        // tenta no meio; se encostar em outra placa, um pouco acima ou abaixo
        let cy: number | null = null
        for (const off of [0, -(fh + 6), fh + 6]) {
          const y = c.y - (showInfo ? 6 : 0) + off
          if (fits(c.x, y, fw, fh)) {
            cy = y
            break
          }
        }
        if (cy !== null) {
          const g = el('g', { class: `map-plaque${compact ? ' compact' : ''}${opts.selectedId === s.id ? ' is-selected' : ''}`, transform: `translate(${c.x.toFixed(1)} ${cy.toFixed(1)})` }, labels)
          el('rect', { x: -fw / 2 + 1, y: -fh / 2 + 2.5, width: fw, height: fh, rx: 7, fill: '#06140e', opacity: 0.35 }, g)
          el('rect', { x: -fw / 2, y: -fh / 2, width: fw, height: fh, rx: 7, fill: '#f4ecd8', stroke: '#8a6a3a', 'stroke-width': 1 }, g)
          const t1 = el('text', { x: 0, y: showInfo ? -3 : compact ? 4 : 4.5, 'text-anchor': 'middle', class: 'plaque-name' }, g)
          t1.textContent = name
          if (showInfo) {
            const t2 = el('text', { x: 0, y: 12, 'text-anchor': 'middle', class: 'plaque-info' }, g)
            t2.textContent = info
          }
        }
      }
    }

    // perímetro: cerca principal, mais marcada
    if (perimeter) {
      const d = pathOf(fromGeometry(perimeter.shape.geometry))
      el('path', { d, fill: 'none', stroke: '#06140e', 'stroke-width': 6, opacity: 0.35, 'stroke-linejoin': 'round' }, fences)
      el('path', { d, fill: 'none', stroke: '#e6cf9c', 'stroke-width': 2.2, 'stroke-linejoin': 'round' }, fences)
      el('path', { d, fill: 'none', stroke: '#4d361f', 'stroke-width': 4.4, 'stroke-dasharray': '0.1 9', 'stroke-linecap': 'round' }, fences)
    }
  }

  map.on('zoomend moveend viewreset resize', redraw)
  redraw()
  return {
    remove() {
      map.off('zoomend moveend viewreset resize', redraw)
      svg.remove()
    },
  }
}
