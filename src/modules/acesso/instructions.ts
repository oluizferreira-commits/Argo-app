import type { RouteStep } from '../../db/types'

const SIDE: Record<string, string> = {
  left: 'à esquerda',
  right: 'à direita',
  'slight left': 'levemente à esquerda',
  'slight right': 'levemente à direita',
  'sharp left': 'acentuadamente à esquerda',
  'sharp right': 'acentuadamente à direita',
  straight: 'em frente',
  uturn: 'em retorno',
}

function road(s: RouteStep): string {
  if (s.name && s.ref) return `${s.name} (${s.ref})`
  return s.name || s.ref || ''
}

/** Instrução em português a partir da manobra do roteamento. */
export function stepText(s: RouteStep, originName: string): string {
  const via = road(s)
  const on = via ? ` na ${via}` : ''
  const side = SIDE[s.modifier] ?? ''
  switch (s.type) {
    case 'depart':
      return `Saia de ${originName}${via ? ` pela ${via}` : ''}`
    case 'arrive':
      return 'Chegada à entrada principal da fazenda'
    case 'turn':
    case 'end of road':
      if (s.modifier === 'straight') return `Siga em frente${on}`
      if (s.modifier === 'uturn') return `Faça o retorno${on}`
      return `${s.type === 'end of road' ? 'No fim da via, vire' : 'Vire'} ${side}${on}`
    case 'fork':
      return `Na bifurcação, mantenha-se ${side.replace('levemente ', '')}${on}`
    case 'merge':
      return `Entre${on}`
    case 'on ramp':
    case 'off ramp':
      return `Pegue o acesso ${side}${on}`
    case 'roundabout':
    case 'rotary':
    case 'roundabout turn':
      return `Na rotatória, pegue a ${s.exit ?? 1}ª saída${on}`
    case 'new name':
    case 'continue':
    default:
      return via ? `Continue na ${via}` : `Continue ${side || 'em frente'}`
  }
}

export interface GuideLine {
  text: string
  /** distância percorrida até este ponto (m) */
  at: number
  /** distância deste trecho (m) */
  distance: number
}

/**
 * Lista de instruções. Junta passos "continue" sem mudança de via com o anterior,
 * para o guia ficar curto e legível.
 */
export function buildGuide(steps: readonly RouteStep[], originName: string): GuideLine[] {
  const out: GuideLine[] = []
  let at = 0
  for (const s of steps) {
    if (s.type === 'notification') {
      at += s.distance
      continue
    }
    const text = stepText(s, originName)
    const prev = out[out.length - 1]
    if (prev && (s.type === 'continue' || s.type === 'new name') && prev.text.endsWith(road(s)) && road(s)) {
      prev.distance += s.distance
    } else {
      out.push({ text, at, distance: s.distance })
    }
    at += s.distance
  }
  return out
}
