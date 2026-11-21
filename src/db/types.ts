import type { CategoryId } from '../domain/categories'
import type { CountReason, MovementType } from '../domain/movements'

/**
 * Campos obrigatórios de todo registro de negócio do ARGO.
 * Garantem rastreabilidade, histórico e sincronização futura.
 */
export interface BaseRecord {
  /** UUID gerado no aparelho. Nunca muda. */
  id: string
  createdAt: string
  updatedAt: string
  /** Exclusão lógica: registros nunca são apagados fisicamente. */
  deletedAt: string | null
  /** Revisão: incrementa a cada alteração (base para resolver conflitos). */
  rev: number
  /** Aparelho que fez a última alteração. */
  deviceId: string
  /** "pending" = alteração local ainda não enviada à nuvem. */
  syncStatus: 'pending' | 'synced'
}

export type AuditAction = 'create' | 'update' | 'delete' | 'restore' | 'import' | 'remote'

/** Histórico imutável de cada alteração. */
export interface AuditEntry {
  id: string
  entity: string
  entityId: string
  action: AuditAction
  at: string
  deviceId: string
  rev: number
  before: unknown
  after: unknown
}

/** Fila de saída para sincronização: uma entrada por registro alterado. */
export interface OutboxEntry {
  /** `${entity}:${entityId}` — evita entradas duplicadas do mesmo registro. */
  id: string
  entity: string
  entityId: string
  rev: number
  queuedAt: string
  attempts: number
  lastError: string | null
}

export interface MetaEntry {
  key: string
  value: unknown
}

/**
 * Registro de teste de armazenamento (tela Configurações).
 * Não representa dado da fazenda.
 */
export interface DiagnosticRecord extends BaseRecord {
  note: string
}

/** Fazenda. Cada pasto, movimentação, cliente e venda pertence a uma fazenda. */
export interface Farm extends BaseRecord {
  name: string
  responsible: string
  city: string
  /** PIN opcional (hash SHA-256 com sal). null = sem senha. */
  pinHash: string | null
  pinSalt: string | null
}

/** Pasto da fazenda. */
export interface Pasture extends BaseRecord {
  farmId: string
  name: string
  /** Área em hectares (null = não informada). */
  areaHa: number | null
  notes: string
}

/** Serviço/pendência de um pasto (ex.: "cerca a ser feita"). */
export interface PastureTask extends BaseRecord {
  farmId: string
  pastureId: string
  description: string
  done: boolean
  doneAt: string | null
}

/** Uma linha de movimentação: soma (+) ou tira (−) animais de uma categoria num pasto. */
export interface MovementEntry {
  pastureId: string
  category: CategoryId
  delta: number
  reason?: CountReason
}

/**
 * Movimentação do rebanho. O saldo de cada pasto/categoria é a SOMA de todas as
 * movimentações — nunca é digitado diretamente. Movimentações não são editadas:
 * corrige-se com um estorno (que também fica registrado).
 */
export interface Movement extends BaseRecord {
  farmId: string
  type: MovementType
  /** Data em que o fato aconteceu (AAAA-MM-DD). */
  date: string
  entries: MovementEntry[]
  /** Pastos envolvidos (índice para busca). */
  pastureIds: string[]
  notes: string
  /** Se for estorno: id da movimentação estornada. */
  reversalOf: string | null
  /** Se foi estornada: id do estorno. */
  reversedBy: string | null
}

/**
 * Mapa de entidades de negócio sincronizáveis.
 * Novos módulos (animais, pastos, vendas...) entram aqui.
 */
export interface EntityMap {
  diagnostics: DiagnosticRecord
  farms: Farm
  pastures: Pasture
  pastureTasks: PastureTask
  movements: Movement
}

export type EntityName = keyof EntityMap

export const ENTITY_NAMES: readonly EntityName[] = ['diagnostics', 'farms', 'pastures', 'pastureTasks', 'movements']

/** Campos que o usuário informa (o resto é preenchido pelo repositório). */
export type EntityInput<E extends EntityName> = Omit<EntityMap[E], keyof BaseRecord>
