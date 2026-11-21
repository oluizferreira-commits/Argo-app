import type { IconName } from '../components/Icon'

export const MOVEMENT_TYPES = [
  'nascimento',
  'compra',
  'transferencia',
  'mudanca-categoria',
  'morte',
  'venda',
  'contagem',
  'estorno',
] as const

export type MovementType = (typeof MOVEMENT_TYPES)[number]

export interface MovementTypeInfo {
  label: string
  description: string
  icon: IconName
}

export const MOVEMENT_INFO: Record<MovementType, MovementTypeInfo> = {
  nascimento: { label: 'Nascimento', description: 'Bezerros e bezerras nascidos', icon: 'calf' },
  compra: { label: 'Compra', description: 'Animais comprados que entraram', icon: 'cash' },
  transferencia: { label: 'Transferência', description: 'Mudar animais de pasto', icon: 'arrows' },
  'mudanca-categoria': { label: 'Mudança de categoria', description: 'Ex.: bezerros que viraram desmama', icon: 'trendUp' },
  morte: { label: 'Morte', description: 'Animais mortos', icon: 'minusCircle' },
  venda: { label: 'Venda', description: 'Por arroba ou por cabeça, com comprovante', icon: 'tag' },
  contagem: { label: 'Contagem', description: 'Conferir um pasto e acertar diferenças', icon: 'clipboard' },
  estorno: { label: 'Estorno', description: 'Correção de lançamento', icon: 'undo' },
}

/** Motivo de uma diferença encontrada na contagem. */
export const COUNT_REASONS = {
  'saldo-inicial': 'Saldo inicial (primeira contagem)',
  'nascimento-nao-registrado': 'Nascimentos não registrados',
  'morte-nao-registrada': 'Mortes não registradas',
  'erro-contagem': 'Correção de contagem anterior',
  outro: 'Outro motivo (ver observação)',
} as const

export type CountReason = keyof typeof COUNT_REASONS
