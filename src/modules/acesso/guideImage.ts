import qrcode from 'qrcode-generator'
import type { CachedRoute, GeoPoint } from '../../db/types'
import { formatCoordinate, formatDuration, formatKm } from './geo'
import { guideWithLandmarks } from './guide'
import type { MapLandmark } from './RouteMap'
import { reachesGate } from './routing'

const SAT = (z: number, x: number, y: number) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`
const LBL = (z: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}`

const W = 1080
const M = 56
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

function project(p: GeoPoint, z: number) {
  const s = 256 * 2 ** z
  const lat = (Math.max(-85, Math.min(85, p.lat)) * Math.PI) / 180
  return { x: ((p.lng + 180) / 360) * s, y: ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * s }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/** Mapa de satélite estático com a rota (desenhado no canvas). */
async function drawStaticMap(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  w: number,
  h: number,
  route: CachedRoute,
  landmarks: readonly MapLandmark[],
): Promise<boolean> {
  const pts: GeoPoint[] = [...route.coords.map(([lat, lng]) => ({ lat, lng })), route.dest, ...landmarks]
  let z = 16
  let a = { x: 0, y: 0 }
  let b = { x: 0, y: 0 }
  for (; z >= 3; z--) {
    const ps = pts.map((p) => project(p, z))
    a = { x: Math.min(...ps.map((p) => p.x)), y: Math.min(...ps.map((p) => p.y)) }
    b = { x: Math.max(...ps.map((p) => p.x)), y: Math.max(...ps.map((p) => p.y)) }
    if (b.x - a.x <= w * 0.86 && b.y - a.y <= h * 0.86) break
  }
  const cx = (a.x + b.x) / 2 - w / 2
  const cy = (a.y + b.y) / 2 - h / 2
  ctx.save()
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x0, y0, w, h, 24)
  else ctx.rect(x0, y0, w, h)
  ctx.clip()
  ctx.fillStyle = '#0c241e'
  ctx.fillRect(x0, y0, w, h)
  const tiles: Promise<void>[] = []
  let ok = 0
  for (let tx = Math.floor(cx / 256); tx <= Math.floor((cx + w) / 256); tx++) {
    for (let ty = Math.floor(cy / 256); ty <= Math.floor((cy + h) / 256); ty++) {
      const dx = x0 + tx * 256 - cx
      const dy = y0 + ty * 256 - cy
      tiles.push(
        (async () => {
          const [sat, lbl] = await Promise.all([loadImage(SAT(z, tx, ty)), loadImage(LBL(z, tx, ty))])
          if (sat) {
            ctx.drawImage(sat, dx, dy, 256, 256)
            ok++
          }
          if (lbl) ctx.drawImage(lbl, dx, dy, 256, 256)
        })(),
      )
    }
  }
  // satélite primeiro (todos), depois linhas
  await Promise.all(tiles)
  const toXY = (p: GeoPoint) => {
    const q = project(p, z)
    return { x: x0 + q.x - cx, y: y0 + q.y - cy }
  }
  const path = () => {
    ctx.beginPath()
    route.coords.forEach(([lat, lng], i) => {
      const q = toXY({ lat, lng })
      if (i === 0) ctx.moveTo(q.x, q.y)
      else ctx.lineTo(q.x, q.y)
    })
  }
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  path()
  ctx.strokeStyle = 'rgba(12,36,30,0.8)'
  ctx.lineWidth = 16
  ctx.stroke()
  path()
  ctx.strokeStyle = '#e4c690'
  ctx.lineWidth = 8
  ctx.stroke()
  // origem
  const o = toXY(route.origin)
  ctx.fillStyle = '#d9b47f'
  ctx.strokeStyle = '#0c241e'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.arc(o.x, o.y, 14, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  // pontos
  landmarks.forEach((l, i) => {
    const q = toXY(l)
    ctx.fillStyle = '#0c241e'
    ctx.strokeStyle = l.kind === 'atencao' ? '#e0806f' : '#d9b47f'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(q.x, q.y, 20, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#ebcb94'
    ctx.font = `800 22px ${FONT}`
    ctx.textAlign = 'center'
    ctx.fillText(String(i + 1), q.x, q.y + 8)
  })
  // entrada principal
  const e = toXY(route.dest)
  ctx.fillStyle = '#16392f'
  ctx.strokeStyle = '#ebcb94'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(e.x, e.y)
  ctx.bezierCurveTo(e.x - 30, e.y - 34, e.x - 30, e.y - 74, e.x, e.y - 74)
  ctx.bezierCurveTo(e.x + 30, e.y - 74, e.x + 30, e.y - 34, e.x, e.y)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#ebcb94'
  ctx.beginPath()
  ctx.arc(e.x, e.y - 48, 9, 0, Math.PI * 2)
  ctx.fill()
  const label = 'ENTRADA PRINCIPAL'
  ctx.font = `800 22px ${FONT}`
  const lw = ctx.measureText(label).width + 28
  ctx.fillStyle = 'rgba(12,36,30,0.9)'
  ctx.fillRect(e.x - lw / 2, e.y - 124, lw, 38)
  ctx.fillStyle = '#ebcb94'
  ctx.textAlign = 'center'
  ctx.fillText(label, e.x, e.y - 97)
  // atribuição
  ctx.font = `400 16px ${FONT}`
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillText('Imagens © Esri, Maxar · Rotas OSRM · Dados © OpenStreetMap', x0 + w - 16, y0 + h - 14)
  ctx.restore()
  return ok > 0
}

export interface GuideImageInput {
  farmName: string
  originName: string
  route: CachedRoute
  landmarks: readonly MapLandmark[]
  shareLink: string
}

/** Gera o guia de chegada (PNG) para compartilhar no WhatsApp. */
export async function renderGuideImage(d: GuideImageInput): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = 4200
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, canvas.height)
  const text = (s: string, x: number, y: number, size: number, weight = 400, color = '#141714', align: CanvasTextAlign = 'left') => {
    ctx.font = `${weight} ${size}px ${FONT}`
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.fillText(s, x, y)
  }
  const wrap = (s: string, x: number, y: number, max: number, size: number, weight = 400, color = '#141714', lh = 1.3) => {
    ctx.font = `${weight} ${size}px ${FONT}`
    const words = s.split(' ')
    let line = ''
    let yy = y
    for (const w of words) {
      const t = line ? `${line} ${w}` : w
      if (ctx.measureText(t).width > max && line) {
        text(line, x, yy, size, weight, color)
        line = w
        yy += size * lh
      } else line = t
    }
    if (line) text(line, x, yy, size, weight, color)
    return yy + size * lh
  }

  // cabeçalho (logo ARGO no canto superior esquerdo)
  let y = M
  const logo = await loadImage(`${import.meta.env.BASE_URL}favicon.svg`)
  if (logo) ctx.drawImage(logo, M, y, 104, 104)
  text('ARGO', M + 128, y + 58, 44, 800, '#16392f')
  text('GESTÃO PECUÁRIA', M + 130, y + 92, 19, 600, '#a9743f')
  text('COMO CHEGAR', W - M, y + 40, 26, 700, '#3f4540', 'right')
  y = wrap(d.farmName, W - M - 420, y + 84, 420, 34, 800, '#141714') - 34
  ctx.textAlign = 'left'
  y = Math.max(y, M + 104) + 30
  ctx.fillStyle = '#a9743f'
  ctx.fillRect(M, y, W - 2 * M, 4)
  y += 54
  text(`Saindo de ${d.originName}`, M, y, 30, 700)
  text(`${formatKm(d.route.distance)} · ${formatDuration(d.route.duration)}`, W - M, y, 30, 800, '#276153', 'right')
  y += 26

  // mapa
  const mapH = 760
  await drawStaticMap(ctx, M, y, W - 2 * M, mapH, d.route, d.landmarks)
  y += mapH + 44
  const valid = reachesGate(d.route)
  y = wrap(
    valid
      ? `✓ Rota pelas estradas do mapa até a porteira (a estrada chega a ${Math.round(d.route.snapEnd)} m da entrada).`
      : `Atenção: a estrada mapeada termina a ${formatKm(d.route.snapEnd)} da porteira. Confira o trecho final pela imagem de satélite.`,
    M,
    y,
    W - 2 * M,
    22,
    600,
    valid ? '#2e7d4f' : '#9a6a00',
  )
  y = wrap('Tempo estimado pelo mapa; em estrada de terra pode levar mais. A navegação no celular parte da sua localização atual.', M, y, W - 2 * M, 20, 400, '#6c726d')
  y += 20

  // passo a passo
  text('CAMINHO', M, y, 20, 700, '#a9743f')
  y += 40
  const { items } = guideWithLandmarks(d.route, d.originName, d.landmarks)
  // no guia em imagem: pula trechos urbanos muito curtos para caber
  const shown = items.filter((it, i) => it.kind === 'landmark' || i === 0 || i === items.length - 1 || (it.at > 0 && (items[i + 1]?.at ?? Infinity) - it.at >= 400))
  for (const it of shown.slice(0, 22)) {
    const km = it.at < 1000 ? `${Math.round(it.at)} m` : `km ${(it.at / 1000).toFixed(1).replace('.', ',')}`
    if (it.kind === 'landmark') {
      ctx.fillStyle = '#f5ecdd'
      ctx.fillRect(M - 12, y - 30, W - 2 * M + 24, 44)
    }
    text(km, M, y, 20, 700, '#a9743f')
    const label = it.kind === 'landmark' ? `(${it.index}) ${it.text}${it.note ? ` — ${it.note}` : ''}` : it.text
    y = wrap(label, M + 130, y, W - 2 * M - 130, 23, it.kind === 'landmark' ? 700 : 400) + 8
  }
  y += 12
  ctx.fillStyle = '#e2ded4'
  ctx.fillRect(M, y, W - 2 * M, 2)
  y += 40

  // QR + coordenada
  const qr = qrcode(0, 'L')
  qr.addData(d.shareLink)
  qr.make()
  const n = qr.getModuleCount()
  const cell = Math.max(2, Math.floor(300 / (n + 4)))
  const qs = cell * (n + 4)
  ctx.fillStyle = '#fff'
  ctx.fillRect(M, y, qs, qs)
  ctx.fillStyle = '#000'
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(M + (c + 2) * cell, y + (r + 2) * cell, cell, cell)
  const tx = M + qs + 36
  text('ABRA NO CELULAR', tx, y + 46, 22, 800, '#276153')
  wrap('Aponte a câmera para o QR Code: abre o mapa e a navegação pelo Google Maps, Waze ou Apple Mapas.', tx, y + 86, W - M - tx, 22, 400, '#3f4540')
  text('Entrada principal:', tx, y + qs - 60, 20, 600, '#6c726d')
  text(formatCoordinate(d.route.dest), tx, y + qs - 26, 26, 800, '#141714')
  y += qs + 46
  text('Guia gerado pelo ARGO — Gestão Pecuária · by Luiz Ferreira', W / 2, y, 19, 400, '#6c726d', 'center')
  y += M - 16

  const out = document.createElement('canvas')
  out.width = W
  out.height = y
  out.getContext('2d')!.drawImage(canvas, 0, 0)
  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar imagem'))), 'image/png'))
}
