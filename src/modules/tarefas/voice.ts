/**
 * Tarefa falada → tarefa anotada. Interpreta o que a pessoa disse, sem inventar nada:
 *   "anota pra amanhã arrumar a cerca do Pasto da Represa, urgente, pro Zé"
 *   → "Arrumar a cerca" · prazo amanhã · Pasto da Represa · prioridade alta · responsável Zé.
 * O que não for reconhecido fica no texto da tarefa, como foi dito.
 */
import type { TaskInput } from './tasks'

export interface VoiceContext {
  today: string
  pastures: readonly { id: string; name: string }[]
  responsibles: readonly { id: string; name: string }[]
}

export interface SpokenTask extends TaskInput {
  /** o que foi entendido além do texto (para mostrar na confirmação) */
  understood: string[]
}

/** minúsculas e sem acento (para comparar) */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const NUMBER_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, vinte: 20, trinta: 30,
}

const WEEKDAYS: [RegExp, number][] = [
  [/domingo/, 0],
  [/segunda(?:-feira| feira)?/, 1],
  [/terca(?:-feira| feira)?/, 2],
  [/quarta(?:-feira| feira)?/, 3],
  [/quinta(?:-feira| feira)?/, 4],
  [/sexta(?:-feira| feira)?/, 5],
  [/sabado/, 6],
]

/**
 * Remove um trecho do texto original usando a posição encontrada no texto "dobrado" (sem acento).
 * Funciona porque `fold` não muda o tamanho das letras do português depois da normalização NFC.
 */
function cut(original: string, folded: string, re: RegExp): { text: string; folded: string; match: RegExpExecArray | null } {
  const m = re.exec(folded)
  if (!m) return { text: original, folded, match: null }
  const a = m.index
  const b = a + m[0].length
  return { text: `${original.slice(0, a)} ${original.slice(b)}`, folded: `${folded.slice(0, a)} ${folded.slice(b)}`, match: m }
}

const LEAD = /^\s*(?:(?:ok|oi|ei|argo)[,\s]+)*(?:(?:anot(?:a|ar|e)|registr(?:a|ar|e)|lembr(?:a|ar|e)(?:te)?|cri(?:a|ar|e)|adicion(?:a|ar|e)|coloc(?:a|ar|e))(?:\s+(?:a|uma|um|ai|aí|ali|isso|isto|ae))?(?:\s+(?:nova\s+)?tarefa)?(?:\s+(?:de|que|pra|para|pro|para o|para a))?[,:\s]+|(?:nova\s+)?tarefa[,:\s]+)/

export function parseSpokenTask(spoken: string, ctx: VoiceContext): SpokenTask {
  let text = spoken.normalize('NFC').replace(/\s+/g, ' ').trim()
  let f = fold(text)
  const understood: string[] = []
  let dueDate: string | null = null
  let priority: 'normal' | 'alta' = 'normal'
  let pastureId = ''
  let responsibleId: string | null = null

  // "anota", "anotar uma tarefa", "nova tarefa:", "lembrete de"…
  const lead = LEAD.exec(f)
  if (lead) {
    text = text.slice(lead[0].length)
    f = f.slice(lead[0].length)
  }

  const take = (re: RegExp) => {
    const r = cut(text, f, re)
    text = r.text
    f = r.folded
    return r.match
  }

  // prioridade
  if (take(/[,\s]*\b(?:(?:e\s+)?(?:e\s+)?urgente|com urgencia|prioridade alta|muito importante|importante)\b[,.]?/)) {
    priority = 'alta'
    understood.push('prioridade alta')
  }

  // prazo
  const P = '(?:\\b(?:pra|para|ate|até|no|na|de|a partir de)\\s+)?'
  let m: RegExpExecArray | null
  if ((m = take(new RegExp(`${P}\\bdepois de amanha\\b`)))) {
    dueDate = addDays(ctx.today, 2)
  } else if ((m = take(new RegExp(`${P}\\bamanha\\b`)))) {
    dueDate = addDays(ctx.today, 1)
  } else if ((m = take(new RegExp(`${P}\\bhoje\\b`)))) {
    dueDate = ctx.today
  } else if ((m = take(new RegExp(`${P}\\b(?:semana que vem|proxima semana)\\b`)))) {
    dueDate = addDays(ctx.today, 7)
  } else if ((m = take(new RegExp(`\\b(?:daqui a|em|dentro de)\\s+(\\d{1,2}|${Object.keys(NUMBER_WORDS).join('|')})\\s+dias?\\b`)))) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]]
    dueDate = addDays(ctx.today, n)
  } else if ((m = take(new RegExp(`${P}\\bdia\\s+(\\d{1,2})(?:\\s+de\\s+[a-z]+)?\\b`)))) {
    const day = Number(m[1])
    if (day >= 1 && day <= 31) {
      const [y, mo] = ctx.today.split('-').map(Number)
      const pad = (v: number) => String(v).padStart(2, '0')
      let cand = `${y}-${pad(mo)}-${pad(day)}`
      if (cand < ctx.today || Number.isNaN(Date.parse(cand))) {
        const ny = mo === 12 ? y + 1 : y
        const nm = mo === 12 ? 1 : mo + 1
        cand = `${ny}-${pad(nm)}-${pad(day)}`
      }
      dueDate = cand
    }
  } else {
    for (const [re, wd] of WEEKDAYS) {
      const mm = take(new RegExp(`${P}(?:\\b(?:essa|esta|nesta|nessa|proxima)\\s+)?\\b${re.source}(?:\\s+que vem)?\\b`))
      if (mm) {
        const cur = new Date(`${ctx.today}T12:00:00Z`).getUTCDay()
        const diff = (wd - cur + 7) % 7 || 7
        dueDate = addDays(ctx.today, diff)
        break
      }
    }
  }
  if (dueDate) understood.push(`prazo ${dueDate.split('-').reverse().join('/')}`)

  // pasto (pelo nome cadastrado; o mais longo primeiro: "Pasto Novo de Cima" antes de "Pasto Novo")
  const pastures = [...ctx.pastures].sort((a, b) => b.name.length - a.name.length)
  for (const p of pastures) {
    const name = fold(p.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (name.length < 2) continue
    const re = new RegExp(`(?:\\b(?:no|na|do|da|pro|pra|para o|para a|ao|em)\\s+)?\\b${name}\\b`)
    const probe = cut(text, f, re)
    if (probe.match) {
      // "roçar o pasto novo" → sobraria "roçar o": aí o nome do pasto fica no texto
      if (!/\b(?:o|a|os|as)[\s,.]*$/.test(probe.folded.trim())) {
        text = probe.text
        f = probe.folded
      }
      pastureId = p.id
      understood.push(p.name)
      break
    }
  }

  // responsável ("pro Zé", "para o João", "responsável Zé", "o Zé que vai fazer")
  for (const r of ctx.responsibles) {
    const first = fold(r.name.split(' ')[0]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (first.length < 2) continue
    const full = fold(r.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const hit = take(new RegExp(`(?:\\b(?:pro|pra|para o|para a|para|responsavel|com o|com a)\\s+)(?:${full}|${first})\\b`))
    if (hit) {
      responsibleId = r.id
      understood.push(r.name)
      break
    }
  }

  let description = text
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/^[\s,.;:–-]+|[\s,;:–-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[.]+$/, '')
    .trim()
  if (!description) description = spoken.trim()
  description = description.charAt(0).toUpperCase() + description.slice(1)
  return { description, notes: '', pastureId, dueDate, responsibleId, priority, understood }
}
