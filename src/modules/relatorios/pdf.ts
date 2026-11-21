import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatDateTime } from '../../core/format'
import type { Report } from './reports'

/**
 * Gera o PDF dos relatórios (texto de verdade, pesquisável). Fontes padrão do PDF:
 * só caracteres do alfabeto latino (acentos do português funcionam).
 */

const GREEN_DARK: [number, number, number] = [22, 57, 47]
const GOLD: [number, number, number] = [169, 116, 63]
const GOLD_LIGHT: [number, number, number] = [235, 203, 148]
const INK: [number, number, number] = [20, 23, 20]
const MUTED: [number, number, number] = [108, 114, 109]
const ROW_ALT: [number, number, number] = [245, 242, 236]

/** Troca caracteres fora do padrão das fontes do PDF (travessão, sinal de menos, aspas curvas, ✓…). */
const PDF_REPLACE: Record<number, string> = {
  0x2012: '-', 0x2013: '-', 0x2014: '-', 0x2015: '-', 0x2212: '-',
  0x2018: "'", 0x2019: "'", 0x201c: '"', 0x201d: '"', 0x2026: '...',
}

export function pdfText(s: string): string {
  let out = ''
  for (const ch of s) {
    const code = ch.codePointAt(0)!
    if (code <= 0xff) out += ch
    else out += PDF_REPLACE[code] ?? ''
  }
  return out
}

async function logoDataUrl(): Promise<string | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}pwa-192.png`)
    const blob = await res.blob()
    return await new Promise((resolve) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => resolve(null)
      r.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

export interface PdfMeta {
  farmName: string
  periodLabel: string
}

export async function buildReportsPdf(reports: readonly Report[], meta: PdfMeta): Promise<Blob> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const logo = await logoDataUrl()
  const generated = formatDateTime(new Date().toISOString())

  const headed = new Set<number>()
  const header = () => {
    const page = doc.getCurrentPageInfo().pageNumber
    if (headed.has(page)) return
    headed.add(page)
    const w = doc.internal.pageSize.getWidth()
    if (logo) doc.addImage(logo, 'PNG', 12, 9, 13, 13)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.setTextColor(...GREEN_DARK)
    doc.text('ARGO', 28, 16)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...GOLD)
    doc.text('GESTÃO PECUÁRIA', 28, 20.5)
    doc.setFontSize(10)
    doc.setTextColor(...INK)
    doc.setFont('helvetica', 'bold')
    doc.text(pdfText(meta.farmName), w - 12, 14.5, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...MUTED)
    doc.text(pdfText(`Relatório · ${meta.periodLabel}`), w - 12, 19.5, { align: 'right' })
    doc.setDrawColor(...GOLD)
    doc.setLineWidth(0.8)
    doc.line(12, 25, w - 12, 25)
  }

  const footer = () => {
    const total = doc.getNumberOfPages()
    for (let i = 1; i <= total; i++) {
      doc.setPage(i)
      const w = doc.internal.pageSize.getWidth()
      const h = doc.internal.pageSize.getHeight()
      doc.setFontSize(7.5)
      doc.setTextColor(...MUTED)
      doc.text(pdfText(`ARGO — Gestão Pecuária · by Luiz Ferreira · gerado em ${generated}`), 12, h - 8)
      doc.text(`Página ${i} de ${total}`, w - 12, h - 8, { align: 'right' })
    }
  }

  let first = true
  for (const r of reports) {
    const wide = r.tables.some((t) => t.wide)
    if (!first) doc.addPage('a4', wide ? 'landscape' : 'portrait')
    else if (wide) {
      doc.deletePage(1)
      doc.addPage('a4', 'landscape')
    }
    first = false
    header()
    const w = doc.internal.pageSize.getWidth()
    let y = 35
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(15)
    doc.setTextColor(...GREEN_DARK)
    doc.text(pdfText(r.title), 12, y)
    y += 6

    // resumo em caixas
    const boxW = (w - 24 - (r.summary.length - 1) * 3) / Math.max(1, r.summary.length)
    r.summary.forEach((s, i) => {
      const x = 12 + i * (boxW + 3)
      doc.setFillColor(...ROW_ALT)
      doc.roundedRect(x, y, boxW, 15, 2, 2, 'F')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(...MUTED)
      doc.text(pdfText(s.label), x + 3, y + 5, { maxWidth: boxW - 6 })
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(...GREEN_DARK)
      doc.text(pdfText(s.value), x + 3, y + 11.5, { maxWidth: boxW - 6 })
    })
    y += 21

    if (r.empty) {
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(10)
      doc.setTextColor(...MUTED)
      doc.text(pdfText(r.empty), 12, y + 2)
      y += 8
    } else {
      for (const t of r.tables) {
        if (t.rows.length === 0) continue
        if (t.title) {
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(9.5)
          doc.setTextColor(...GOLD)
          doc.text(pdfText(t.title.toUpperCase()), 12, y + 2)
          y += 4
        }
        autoTable(doc, {
          startY: y,
          margin: { left: 12, right: 12, top: 30, bottom: 15 },
          head: [t.columns.map((c) => pdfText(c.label))],
          body: t.rows.map((row) => row.map(pdfText)),
          foot: t.foot ? [t.foot.map(pdfText)] : undefined,
          showFoot: 'lastPage',
          theme: 'plain',
          styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.8, textColor: INK, lineColor: [226, 222, 212], lineWidth: { bottom: 0.2 } },
          headStyles: { fillColor: GREEN_DARK, textColor: GOLD_LIGHT, fontStyle: 'bold' },
          footStyles: { fillColor: [245, 236, 221], textColor: GREEN_DARK, fontStyle: 'bold' },
          alternateRowStyles: { fillColor: ROW_ALT },
          columnStyles: Object.fromEntries(t.columns.map((c, i) => [i, { halign: c.align === 'right' ? 'right' : 'left' }])),
          didDrawPage: () => header(),
          // título, linhas e total da coluna com o mesmo alinhamento (números à direita)
          didParseCell: (data) => {
            data.cell.styles.halign = t.columns[data.column.index]?.align === 'right' ? 'right' : 'left'
          },
        })
        y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8
      }
    }
    for (const note of r.notes) {
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(8)
      doc.setTextColor(...MUTED)
      doc.text(pdfText(note), 12, y, { maxWidth: w - 24 })
      y += 5
    }
  }
  footer()
  return doc.output('blob')
}
