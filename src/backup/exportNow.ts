import type { ArgoDatabase } from '../db/database'
import { saveFile } from '../platform/files'
import { backupFileName, createBackup, markBackupDone } from './backup'

/** Intervalo do lembrete de backup. */
export const BACKUP_EVERY_MS = 12 * 60 * 60 * 1000

/**
 * Gera o backup e abre a folha do iPhone para salvar (ex.: "Salvar em Arquivos" › iCloud Drive).
 * Só marca como feito se a pessoa não cancelar. Precisa ser chamado num toque (exigência do iPhone).
 */
export async function exportBackupNow(db: ArgoDatabase): Promise<'feito' | 'cancelado'> {
  const backup = await createBackup(db, __APP_VERSION__)
  const saved = await saveFile(backupFileName(backup), JSON.stringify(backup, null, 2))
  if (!saved) return 'cancelado'
  await markBackupDone(db, backup)
  return 'feito'
}

/**
 * O lembrete aparece quando: já existe algum lançamento e o último backup tem 12 horas ou mais
 * (ou nunca foi feito). Se ninguém abrir o app nesse tempo, aparece na próxima abertura.
 */
export function backupDue(lastBackupAt: string | null | undefined, hasData: boolean, now: number): boolean {
  if (!hasData) return false
  if (!lastBackupAt) return true
  const t = Date.parse(lastBackupAt)
  return !Number.isFinite(t) || now - t >= BACKUP_EVERY_MS
}

/** Quanto falta para o próximo lembrete (ms; 0 = já). */
export function nextBackupIn(lastBackupAt: string | null | undefined, now: number): number {
  if (!lastBackupAt) return 0
  return Math.max(0, Date.parse(lastBackupAt) + BACKUP_EVERY_MS - now)
}
