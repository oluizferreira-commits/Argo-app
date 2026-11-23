import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { formatDateTime } from '../core/format'
import { db } from '../db/database'
import { Icon } from '../components/Icon'
import { backupDue, exportBackupNow } from './exportNow'

const SNOOZE_KEY = 'argo.backup.adiado'

/**
 * Aviso de backup: aparece quando o último backup tem 12 horas ou mais (ou nunca foi feito).
 * "Depois" esconde só até a próxima abertura do app (ou por 1 hora, se o app continuar aberto).
 */
export function BackupReminder() {
  const last = useLiveQuery(async () => ({
    at: (await db.meta.get('lastBackupAt'))?.value as string | undefined,
    hasData: (await db.auditLog.count()) > 0,
  }))
  const [now, setNow] = useState(() => Date.now())
  const [snoozedAt, setSnoozedAt] = useState<number | null>(() => {
    try {
      const v = Number(sessionStorage.getItem(SNOOZE_KEY))
      return v > 0 ? v : null
    } catch {
      return null
    }
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  // se o app ficar aberto, confere de novo a cada minuto
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  if (!last) return null
  const snoozed = snoozedAt !== null && now - snoozedAt < 3600_000
  if (!backupDue(last.at, last.hasData, now) || snoozed) return null

  async function doBackup() {
    setBusy(true)
    setMsg(null)
    try {
      const r = await exportBackupNow(db)
      if (r === 'cancelado') setMsg('Backup cancelado. Toque de novo e escolha "Salvar em Arquivos".')
    } catch (e) {
      setMsg(`Não foi possível gerar o backup: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="backup-reminder" role="alert" data-testid="backup-reminder">
      <span className="backup-icon">
        <Icon name="shield" size={24} />
      </span>
      <div className="backup-body">
        <b>Hora de fazer o backup</b>
        <span>{last.at ? `Último backup: ${formatDateTime(last.at)}.` : 'Nenhum backup feito ainda.'} Salve uma cópia no iCloud Drive para não perder os dados se o celular quebrar ou sumir.</span>
        {msg && <span className="backup-msg">{msg}</span>}
        <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-gold btn-compact" disabled={busy} onClick={() => void doBackup()} data-testid="backup-now">
            <Icon name="download" size={20} /> {busy ? 'Gerando…' : 'Fazer backup agora'}
          </button>
          <button
            type="button"
            className="btn btn-outline btn-compact"
            onClick={() => {
              const t = Date.now()
              try {
                sessionStorage.setItem(SNOOZE_KEY, String(t))
              } catch {
                /* ignora */
              }
              setSnoozedAt(t)
            }}
            data-testid="backup-later"
          >
            Depois
          </button>
          <Link to="/configuracoes" className="inline-link" style={{ alignSelf: 'center', fontSize: 14 }}>
            Como restaurar
          </Link>
        </div>
      </div>
    </section>
  )
}
