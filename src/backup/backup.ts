import { newId, nowIso } from '../core/ids'
import type { ArgoDatabase } from '../db/database'
import { getDeviceId, setMeta } from '../db/device'
import { ENTITY_NAMES, type AuditEntry, type EntityName } from '../db/types'
import { remoteWins } from '../sync/engine'
import type { AnyRecord } from '../sync/types'

export const BACKUP_FORMAT = 'argo-backup'
export const BACKUP_FORMAT_VERSION = 1

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  formatVersion: number
  schemaVersion: number
  appVersion: string
  exportedAt: string
  deviceId: string
  /** SHA-256 de JSON.stringify(data): detecta arquivo corrompido ou editado. */
  checksum: string
  data: {
    entities: Partial<Record<EntityName, AnyRecord[]>>
    auditLog: AuditEntry[]
  }
}

export interface ImportSummary {
  added: number
  updated: number
  skipped: number
  auditAdded: number
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupError'
  }
}

/** Gera o backup completo (inclui registros excluídos e todo o histórico). */
export async function createBackup(db: ArgoDatabase, appVersion: string): Promise<BackupFile> {
  const entities: BackupFile['data']['entities'] = {}
  for (const e of ENTITY_NAMES) entities[e] = await db[e].toArray()
  const auditLog = await db.auditLog.toArray()
  const data = { entities, auditLog }
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: db.verno,
    appVersion,
    exportedAt: nowIso(),
    deviceId: await getDeviceId(db),
    checksum: await sha256(JSON.stringify(data)),
    data,
  }
}

export function backupFileName(b: BackupFile): string {
  return `argo-backup-${b.exportedAt.slice(0, 19).replace(/[:T]/g, '-')}.json`
}

/** Marca que um backup foi exportado (exibido no painel). */
export async function markBackupDone(db: ArgoDatabase, b: BackupFile): Promise<void> {
  await setMeta(db, 'lastBackupAt', b.exportedAt)
}

/** Lê e valida um arquivo de backup. Lança BackupError com mensagem clara. */
export async function parseBackup(text: string, db: ArgoDatabase): Promise<BackupFile> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new BackupError('O arquivo não é um JSON válido.')
  }
  const b = parsed as Partial<BackupFile>
  if (b?.format !== BACKUP_FORMAT || typeof b.data !== 'object' || b.data === null) {
    throw new BackupError('Este arquivo não é um backup do ARGO.')
  }
  if ((b.formatVersion ?? 0) > BACKUP_FORMAT_VERSION || (b.schemaVersion ?? 0) > db.verno) {
    throw new BackupError('Backup criado por uma versão mais nova do ARGO. Atualize o aplicativo antes de restaurar.')
  }
  if (b.checksum !== (await sha256(JSON.stringify(b.data)))) {
    throw new BackupError('Falha na verificação de integridade: o arquivo está corrompido ou foi alterado.')
  }
  return b as BackupFile
}

/**
 * Restaura um backup MESCLANDO com os dados atuais. Nunca apaga nada e nunca duplica:
 *  - registro inexistente → adicionado;
 *  - registro existente → substituído apenas se a versão do backup for mais nova;
 *  - histórico → entradas adicionadas por id (sem repetir).
 */
export async function importBackup(db: ArgoDatabase, backup: BackupFile): Promise<ImportSummary> {
  const deviceId = await getDeviceId(db)
  const summary: ImportSummary = { added: 0, updated: 0, skipped: 0, auditAdded: 0 }
  const tables = ENTITY_NAMES.map((e) => db[e])

  await db.transaction('rw', [db.auditLog, db.outbox, db.meta, ...tables], async () => {
    const existingAudit = new Set(await db.auditLog.toCollection().primaryKeys())
    for (const entry of backup.data.auditLog ?? []) {
      if (existingAudit.has(entry.id)) continue
      await db.auditLog.add(entry)
      summary.auditAdded++
    }

    for (const entity of ENTITY_NAMES) {
      for (const incoming of backup.data.entities[entity] ?? []) {
        if (!isRecord(incoming)) {
          summary.skipped++
          continue
        }
        const local = await db[entity].get(incoming.id)
        if (local && !remoteWins(local, incoming)) {
          summary.skipped++
          continue
        }
        const record = { ...incoming, syncStatus: 'pending' as const }
        await db[entity].put(record)
        await db.auditLog.add({
          id: newId(),
          entity,
          entityId: record.id,
          action: 'import',
          at: nowIso(),
          deviceId,
          rev: record.rev,
          before: local ?? null,
          after: record,
        })
        await db.outbox.put({
          id: `${entity}:${record.id}`,
          entity,
          entityId: record.id,
          rev: record.rev,
          queuedAt: nowIso(),
          attempts: 0,
          lastError: null,
        })
        if (local) summary.updated++
        else summary.added++
      }
    }
    await setMeta(db, 'lastImportAt', nowIso())
  })
  return summary
}

function isRecord(r: unknown): r is AnyRecord {
  const x = r as AnyRecord
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof x.id === 'string' &&
    typeof x.rev === 'number' &&
    typeof x.createdAt === 'string' &&
    typeof x.updatedAt === 'string'
  )
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
