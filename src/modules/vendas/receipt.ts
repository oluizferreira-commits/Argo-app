import qrcode from 'qrcode-generator'
import { formatDateTime } from '../../core/format'
import { formatDecimal, formatMoney } from '../../core/money'
import type { Client, Farm, Pasture, Payment, Sale } from '../../db/types'
import { saleBalance } from '../receber/receivables'
import { category } from '../../domain/categories'
import { buildPixPayload, maskPhone, maskPixKey, PIX_KEY_LABELS } from '../../domain/pix'
import { formatDay } from '../rebanho/herd'
import { formatSaleNumber, kgCutTotals, kgWeighingsOf, salePurpose } from './sales'

/**
 * Código Pix (copia e cola) do que FALTA pagar de uma parcela, ou null se: a venda é para a fazenda
 * (quem recebe é outra pessoa — o comprovante sai sem Pix e sem QR Code), não há chave cadastrada
 * ou a parcela já está paga. O Pix só sai nas vendas para gastos pessoais.
 */
export function salePixPayload(sale: Sale, farm: Farm, installmentIndex: number, payments: readonly Payment[] = []): string | null {
  if (salePurpose(sale) !== 'pessoal') return null
  if (!farm.pixKey || !farm.pixName || !farm.pixCity) return null
  const state = saleBalance(sale, payments).installments[installmentIndex] ?? saleBalance(sale, payments).installments[0]
  if (!state || state.openCents <= 0) return null
  return buildPixPayload({
    key: farm.pixKey,
    name: farm.pixName,
    city: farm.pixCity,
    amountCents: state.openCents,
    txid: `ARGO${formatSaleNumber(sale.number)}${sale.installments.length > 1 ? `P${installmentIndex + 1}` : ''}`,
  })
}

export const PAYMENT_LABEL = { avista: 'À vista', prazo: 'A prazo', parcelado: 'Parcelado' } as const

const W = 1080
const M = 64
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
const C = {
  ink: '#141714',
  ink2: '#3f4540',
  ink3: '#6c726d',
  line: '#e2ded4',
  green: '#276153',
  greenDark: '#16392f',
  gold: '#a9743f',
  goldLight: '#f5ecdd',
  danger: '#b3261e',
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

interface ReceiptData {
  sale: Sale
  farm: Farm
  client: Client
  pastures: Map<string, Pasture>
  installmentIndex: number
  payments: readonly Payment[]
}

/** Desenha o comprovante e devolve a imagem PNG. */
export async function renderReceipt(d: ReceiptData): Promise<Blob> {
  const { sale, farm, client } = d
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = 3200
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, canvas.height)
  ctx.textBaseline = 'alphabetic'

  const text = (s: string, x: number, y: number, size: number, weight = 400, color = C.ink, align: CanvasTextAlign = 'left') => {
    ctx.font = `${weight} ${size}px ${FONT}`
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.fillText(s, x, y)
  }
  const fit = (s: string, max: number, size: number, weight = 400) => {
    ctx.font = `${weight} ${size}px ${FONT}`
    if (ctx.measureText(s).width <= max) return s
    let t = s
    while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1)
    return `${t}…`
  }
  const rule = (y: number, color = C.line, h = 2) => {
    ctx.fillStyle = color
    ctx.fillRect(M, y, W - 2 * M, h)
  }

  // ---------- cabeçalho: logo ARGO no canto superior esquerdo
  let y = M
  const logo = await loadImage(`${import.meta.env.BASE_URL}favicon.svg`)
  if (logo) ctx.drawImage(logo, M, y, 112, 112)
  text('ARGO', M + 136, y + 62, 46, 800, C.greenDark)
  text('GESTÃO PECUÁRIA', M + 138, y + 98, 20, 600, C.gold)
  text('COMPROVANTE DE VENDA', W - M, y + 40, 26, 700, C.ink2, 'right')
  text(`Nº ${formatSaleNumber(sale.number)}`, W - M, y + 88, 44, 800, C.ink, 'right')
  if (sale.status === 'cancelada') text('VENDA CANCELADA', W - M, y + 124, 24, 800, C.danger, 'right')
  y += 150
  rule(y, C.gold, 4)
  y += 50

  // ---------- vendedor / comprador
  const col2 = W / 2 + 16
  text('VENDEDOR', M, y, 20, 700, C.gold)
  text('COMPRADOR', col2, y, 20, 700, C.gold)
  y += 42
  const left = [farm.name, farm.responsible && `Responsável: ${farm.responsible}`, farm.city].filter(Boolean) as string[]
  // Comprador: nome, telefone MASCARADO e cidade (CPF do cliente não é usado).
  const phone = maskPhone(client.phone)
  const right = [client.name, phone && `Telefone: ${phone}`, client.city].filter(Boolean) as string[]
  const half = W / 2 - M - 32
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const size = i === 0 ? 32 : 26
    const weight = i === 0 ? 700 : 400
    if (left[i]) text(fit(left[i], half, size, weight), M, y, size, weight, i === 0 ? C.ink : C.ink2)
    if (right[i]) text(fit(right[i], half, size, weight), col2, y, size, weight, i === 0 ? C.ink : C.ink2)
    y += i === 0 ? 44 : 38
  }
  y += 14
  text(`Data da venda: ${formatDay(sale.date)}`, M, y, 26, 600, C.ink2)
  text(`Emitido em: ${formatDateTime(new Date().toISOString())}`, W - M, y, 22, 400, C.ink3, 'right')
  y += 34
  rule(y)
  y += 52

  // ---------- animais
  const modeLabel =
    sale.mode === 'cabeca' ? 'VENDA POR CABEÇA' : sale.mode === 'kg' ? 'VENDA POR KG · PESO VIVO' : sale.weighing === 'vivo' ? 'VENDA POR ARROBA · PESO VIVO (kg ÷ 30)' : 'VENDA POR ARROBA · ABATE'
  text(modeLabel, M, y, 20, 700, C.gold)
  y += 46
  const pastureName = (id: string) => d.pastures.get(id)?.name ?? ''
  for (const it of sale.items) {
    const label = `${it.quantity} ${(it.quantity === 1 ? category(it.category).label : category(it.category).plural).toLowerCase()}`
    text(label, M, y, 30, 600)
    text(fit(pastureName(it.pastureId), 360, 22), M + 420, y, 22, 400, C.ink3)
    if (sale.mode === 'cabeca') {
      const price = sale.pricePerHeadCents[it.category] ?? 0
      text(`${formatMoney(price)}/cab.`, W - M - 250, y, 24, 400, C.ink2, 'right')
      text(formatMoney(price * it.quantity), W - M, y, 28, 700, C.ink, 'right')
    } else if (sale.mode === 'kg') {
      // na balança os animais sobem misturados: o peso é do lote (resumo abaixo), não de cada categoria
      text(`${it.quantity} cab.`, W - M, y, 26, 600, C.ink2, 'right')
    } else {
      const animals = sale.animals.filter((a) => a.pastureId === it.pastureId && a.category === it.category)
      const sum = animals.reduce((a, x) => a + x.amount, 0)
      const desc = sale.weighing === 'vivo' ? `${formatDecimal(sum, 1)} kg` : `${formatDecimal(sum, 2)} @`
      text(desc, W - M, y, 26, 600, C.ink2, 'right')
    }
    y += 50
  }
  y += 6
  rule(y)
  y += 50
  if (sale.mode === 'kg') {
    const ws = kgWeighingsOf(sale)
    const kg = ws.reduce((a, x) => a + x.kgTenths, 0)
    const cab = ws.reduce((a, x) => a + x.heads, 0)
    text(`${cab} cab. · ${formatDecimal(kg, 1)} kg · média ${formatDecimal(Math.round(kg / Math.max(1, cab)), 1)} kg`, M, y, 26, 600, C.ink2)
    if (!sale.kgPriceCut) text(`${formatMoney(sale.pricePerKgCents ?? 0)} por kg`, W - M, y, 26, 400, C.ink2, 'right')
    y += 56
    if (sale.kgPriceCut) {
      const c = sale.kgPriceCut
      const t = kgCutTotals(ws, c)
      const cut = `${formatDecimal(c.cutTenths, 1)} kg`
      text(`${cut} ou mais: ${t.aboveHeads} cab. · ${formatDecimal(t.aboveKg, 1)} kg × ${formatMoney(c.aboveCents)}`, M, y, 24, 400, C.ink2)
      text(formatMoney(t.aboveCents), W - M, y, 26, 700, C.ink, 'right')
      y += 46
      text(`Abaixo de ${cut}: ${t.belowHeads} cab. · ${formatDecimal(t.belowKg, 1)} kg × ${formatMoney(c.belowCents)}`, M, y, 24, 400, C.ink2)
      text(formatMoney(t.belowCents), W - M, y, 26, 700, C.ink, 'right')
      y += 56
    }
  }
  if (sale.mode === 'arroba') {
    const totalAnimals = sale.animals.length
    text(`${totalAnimals} animal(is) · ${formatDecimal(sale.arrobasHundredths, 2, 2)} @`, M, y, 28, 600, C.ink2)
    text(`${formatMoney(sale.pricePerArrobaCents ?? 0)} por arroba`, W - M, y, 26, 400, C.ink2, 'right')
    y += 56
  }

  // ---------- total
  ctx.fillStyle = C.goldLight
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath()
    ctx.roundRect(M, y - 8, W - 2 * M, 108, 20)
    ctx.fill()
  } else ctx.fillRect(M, y - 8, W - 2 * M, 108)
  text('VALOR TOTAL', M + 32, y + 58, 26, 700, C.gold)
  text(formatMoney(sale.totalCents), W - M - 32, y + 66, 52, 800, C.greenDark, 'right')
  y += 150

  // ---------- pagamento
  const bal = saleBalance(sale, d.payments)
  text('PAGAMENTO', M, y, 20, 700, C.gold)
  if (sale.status === 'ativa')
    text(
      bal.settled ? 'QUITADA' : bal.paidCents > 0 ? `RECEBIDO ${formatMoney(bal.paidCents)} · FALTA ${formatMoney(bal.openCents)}` : `EM ABERTO`,
      W - M,
      y,
      20,
      800,
      bal.settled ? '#2e7d4f' : C.gold,
      'right',
    )
  y += 44
  if (sale.paymentKind === 'avista') {
    text('À vista', M, y, 28, 600)
    y += 44
  } else {
    sale.installments.forEach((p, i) => {
      const label = sale.paymentKind === 'prazo' ? 'A prazo — vencimento' : `Parcela ${i + 1}/${sale.installments.length} — vencimento`
      const st = bal.installments[i]
      text(`${label} ${formatDay(p.due)}${st?.status === 'paga' ? '  ✓ paga' : ''}`, M, y, 26, 400, st?.status === 'paga' ? '#2e7d4f' : C.ink2)
      text(formatMoney(p.amountCents), W - M, y, 26, 700, C.ink, 'right')
      y += 42
    })
  }
  y += 16

  // ---------- Pix
  const payload = sale.status === 'ativa' ? salePixPayload(sale, farm, d.installmentIndex, d.payments) : null
  if (payload && farm.pixKey && farm.pixKeyType) {
    rule(y)
    y += 40
    const qr = qrcode(0, 'M')
    qr.addData(payload)
    qr.make()
    const n = qr.getModuleCount()
    const size = 380
    const cell = Math.floor(size / (n + 4))
    const qrSize = cell * (n + 4)
    ctx.fillStyle = '#fff'
    ctx.fillRect(M, y, qrSize, qrSize)
    ctx.fillStyle = '#000'
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(M + (c + 2) * cell, y + (r + 2) * cell, cell, cell)
    const tx = M + qrSize + 40
    const inst = sale.installments[d.installmentIndex] ?? sale.installments[0]
    const open = bal.installments[d.installmentIndex]?.openCents ?? inst.amountCents
    text('PAGUE COM PIX', tx, y + 50, 24, 800, C.green)
    text(formatMoney(open), tx, y + 112, 44, 800, C.ink)
    if (sale.installments.length > 1) text(`Parcela ${d.installmentIndex + 1} · vence ${formatDay(inst.due)}`, tx, y + 152, 22, 400, C.ink2)
    text(fit(`Recebedor: ${farm.pixFullName || farm.pixName}`, W - M - tx, 22), tx, y + 206, 22, 400, C.ink2)
    text(`Chave (${PIX_KEY_LABELS[farm.pixKeyType]}): ${maskPixKey(farm.pixKeyType, farm.pixKey)}`, tx, y + 244, 22, 400, C.ink2)
    text('Abra o app do seu banco e', tx, y + 300, 22, 400, C.ink3)
    text('escaneie o QR Code.', tx, y + 330, 22, 400, C.ink3)
    y += qrSize + 40
  }

  // ---------- rodapé
  if (sale.notes) {
    text(fit(`Obs.: ${sale.notes}`, W - 2 * M, 22), M, y, 22, 400, C.ink2)
    y += 44
  }
  rule(y)
  y += 40
  text('Documento gerado pelo ARGO — Gestão Pecuária · by Luiz Ferreira', W / 2, y, 20, 400, C.ink3, 'center')
  y += 30
  text('Comprovante de negociação. Não substitui nota fiscal.', W / 2, y, 20, 400, C.ink3, 'center')
  y += M - 10

  // recorta na altura usada
  const out = document.createElement('canvas')
  out.width = W
  out.height = y
  out.getContext('2d')!.drawImage(canvas, 0, 0)
  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar imagem'))), 'image/png'))
}
