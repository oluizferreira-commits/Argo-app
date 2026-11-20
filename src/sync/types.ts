import type { EntityMap, EntityName } from '../db/types'

export type AnyRecord = EntityMap[EntityName]

export interface PushItem {
  entity: EntityName
  record: AnyRecord
}

export interface PushResult {
  /** Itens aceitos pelo servidor ("entity:id"). */
  accepted: string[]
  /** Itens recusados, com motivo. */
  rejected: { key: string; error: string }[]
}

export interface PullResult {
  changes: PushItem[]
  /** Marcador a enviar no próximo pull (ex.: maior updated_at recebido). */
  cursor: string | null
}

/**
 * Contrato de um servidor de sincronização.
 * Hoje: LocalOnlyAdapter. Futuro: SupabaseAdapter (PostgreSQL).
 */
export interface SyncAdapter {
  readonly name: string
  isConfigured(): boolean
  push(items: PushItem[]): Promise<PushResult>
  pull(cursor: string | null): Promise<PullResult>
}
