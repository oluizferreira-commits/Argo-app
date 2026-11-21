import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { backupFileName, BackupError, createBackup, importBackup, markBackupDone, parseBackup } from '../../backup/backup'
import { formatBytes, formatDateTime } from '../../core/format'
import { newId } from '../../core/ids'
import { db } from '../../db/database'
import { Repository } from '../../db/repository'
import { Icon } from '../../components/Icon'
import { StatusItem } from '../../components/StatusItem'
import { useStorageStatus } from '../../hooks/useStorageStatus'
import { readFileText, saveFile } from '../../platform/files'
import { isStandalone, requestPersistentStorage } from '../../platform/storage'
import { useFarm } from '../fazendas/FarmContext'

const diagnostics = new Repository(db, 'diagnostics')

type Msg = { kind: 'ok' | 'error' | 'warn'; text: string } | null

function Notice({ msg }: { msg: Msg }) {
  if (!msg) return null
  return (
    <div className={`notice notice-${msg.kind}`} role="status">
      <Icon name={msg.kind === 'ok' ? 'check' : 'alert'} />
      <div>{msg.text}</div>
    </div>
  )
}

export function SettingsPage() {
  return (
    <>
      <FarmSection />
      <StorageSection />
      <BackupSection />
      <SyncSection />
      <StorageTestSection />
      <AboutSection />
    </>
  )
}

function FarmSection() {
  const { farm, switchFarm } = useFarm()
  return (
    <>
      <h2 className="section-title">Fazenda</h2>
      <div className="card stack">
        <Link to="/fazenda" style={{ color: 'inherit', textDecoration: 'none' }}>
          <StatusItem
            icon="pasture"
            label={farm.name}
            detail={[farm.responsible, farm.city].filter(Boolean).join(' · ') || 'Toque para editar'}
            badge={<Icon name="chevronRight" size={20} className="muted" />}
          />
        </Link>
        <button className="btn btn-outline btn-block" onClick={() => void switchFarm()}>
          <Icon name="arrows" /> Trocar de fazenda
        </button>
      </div>
    </>
  )
}

function StorageSection() {
  const { status, refresh } = useStorageStatus()
  const [msg, setMsg] = useState<Msg>(null)

  async function ask() {
    const ok = await requestPersistentStorage()
    refresh()
    setMsg(
      ok
        ? { kind: 'ok', text: 'Armazenamento persistente ativado.' }
        : {
            kind: 'warn',
            text: isStandalone()
              ? 'O sistema não concedeu o armazenamento persistente agora. Mantenha backups regulares.'
              : 'Instale o ARGO na Tela de Início para maior proteção dos dados e tente novamente.',
          },
    )
  }

  return (
    <>
      <h2 className="section-title">Armazenamento</h2>
      <div className="card stack">
        <div className="status-list">
          <StatusItem
            icon="database"
            label="Banco de dados local"
            detail={`IndexedDB · ${status?.usage !== undefined ? `${formatBytes(status.usage)} em uso` : 'uso desconhecido'}`}
          />
          <StatusItem
            icon="shield"
            label="Proteção contra limpeza"
            detail={status === null ? 'Verificando…' : status.persisted ? 'Persistente' : 'Não persistente'}
            badge={
              status?.persisted ? <span className="badge badge-ok">Ativa</span> : <span className="badge badge-warn">Inativa</span>
            }
          />
        </div>
        {status && !status.persisted && status.supported && (
          <button className="btn btn-outline btn-block" onClick={ask}>
            <Icon name="shield" /> Solicitar armazenamento persistente
          </button>
        )}
        <Notice msg={msg} />
      </div>
    </>
  )
}

function BackupSection() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const lastBackupAt = useLiveQuery(async () => (await db.meta.get('lastBackupAt'))?.value as string | undefined)

  async function exportNow() {
    setBusy(true)
    setMsg(null)
    try {
      const backup = await createBackup(db, __APP_VERSION__)
      const saved = await saveFile(backupFileName(backup), JSON.stringify(backup, null, 2))
      if (saved) {
        await markBackupDone(db, backup)
        setMsg({ kind: 'ok', text: 'Backup gerado. Guarde o arquivo em local seguro (ex.: iCloud Drive).' })
      }
    } catch (e) {
      setMsg({ kind: 'error', text: `Falha ao gerar backup: ${(e as Error).message}` })
    } finally {
      setBusy(false)
    }
  }

  async function importFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setMsg(null)
    try {
      const backup = await parseBackup(await readFileText(file), db)
      const ok = window.confirm(
        `Restaurar backup de ${formatDateTime(backup.exportedAt)}?\n\nOs dados serão MESCLADOS: nada atual será apagado e registros repetidos não serão duplicados.`,
      )
      if (!ok) return
      const s = await importBackup(db, backup)
      setMsg({
        kind: 'ok',
        text: `Restauração concluída: ${s.added} adicionado(s), ${s.updated} atualizado(s), ${s.skipped} já existente(s).`,
      })
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof BackupError ? e.message : `Falha ao restaurar: ${(e as Error).message}` })
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <>
      <h2 className="section-title">Backup</h2>
      <div className="card stack">
        <StatusItem
          icon="clock"
          label="Último backup exportado"
          detail={lastBackupAt ? formatDateTime(lastBackupAt) : 'Nenhum'}
        />
        <button className="btn btn-gold btn-block" onClick={exportNow} disabled={busy}>
          <Icon name="download" /> Exportar backup
        </button>
        <button className="btn btn-outline btn-block" onClick={() => fileInput.current?.click()} disabled={busy}>
          <Icon name="upload" /> Restaurar backup
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          onChange={(e) => importFile(e.target.files?.[0])}
        />
        <p className="muted">
          O backup inclui todas as fazendas deste aparelho, todos os registros (inclusive excluídos) e o histórico completo.
        </p>
        <Notice msg={msg} />
      </div>
    </>
  )
}

function SyncSection() {
  const pending = useLiveQuery(() => db.outbox.count(), [], 0)
  return (
    <>
      <h2 className="section-title">Sincronização</h2>
      <div className="card status-list">
        <StatusItem
          icon="cloudOff"
          label="Nuvem"
          detail="Não configurada. Os dados ficam somente neste aparelho."
          badge={<span className="badge badge-neutral">Local</span>}
        />
        <StatusItem icon="refresh" label="Alterações aguardando envio" detail={`${pending} registro(s)`} />
      </div>
    </>
  )
}

function StorageTestSection() {
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  // Chave de idempotência: gerada ao abrir o formulário, renovada após salvar.
  const [formKey, setFormKey] = useState(newId)
  const records = useLiveQuery(() => diagnostics.listActive(), [], [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const text = note.trim()
    if (!text || saving) return
    setSaving(true)
    try {
      await diagnostics.create({ note: text }, formKey)
      setNote('')
      setFormKey(newId())
      setMsg({ kind: 'ok', text: 'Registro salvo no aparelho. Feche e abra o app para conferir.' })
    } catch (err) {
      setMsg({ kind: 'error', text: `Não foi possível salvar: ${(err as Error).message}` })
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Excluir este registro de teste?')) return
    await diagnostics.softDelete(id)
  }

  return (
    <>
      <h2 className="section-title">Teste de armazenamento</h2>
      <div className="card stack">
        <p className="muted">
          Use para confirmar que o aparelho guarda dados localmente. Estes registros são apenas de teste e não fazem parte dos
          dados da fazenda.
        </p>
        <form onSubmit={submit} className="stack">
          <div>
            <label className="label" htmlFor="test-note">
              Texto do registro de teste
            </label>
            <input
              id="test-note"
              className="input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              placeholder="Ex.: teste de gravação"
              autoComplete="off"
            />
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={saving || !note.trim()}>
            <Icon name="check" /> {saving ? 'Salvando…' : 'Salvar registro de teste'}
          </button>
        </form>
        <Notice msg={msg} />
        <div data-testid="test-records">
          {records.length === 0 ? (
            <p className="muted">Nenhum registro de teste salvo.</p>
          ) : (
            records.map((r) => (
              <div className="record" key={r.id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{r.note}</div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    Salvo em {formatDateTime(r.createdAt)}
                  </div>
                </div>
                <button className="btn btn-danger btn-icon" onClick={() => remove(r.id)} aria-label="Excluir registro de teste">
                  <Icon name="trash" size={20} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  )
}

function AboutSection() {
  const deviceId = useLiveQuery(async () => (await db.meta.get('deviceId'))?.value as string | undefined)
  const auditCount = useLiveQuery(() => db.auditLog.count(), [], 0)
  return (
    <>
      <h2 className="section-title">Sobre</h2>
      <div className="card">
        <dl className="kv">
          <dt>Aplicativo</dt>
          <dd>ARGO — Gestão Pecuária</dd>
          <dt>Versão</dt>
          <dd>{__APP_VERSION__}</dd>
          <dt>Esquema do banco</dt>
          <dd>v{db.verno}</dd>
          <dt>Entradas no histórico</dt>
          <dd>{auditCount}</dd>
          <dt>Aparelho</dt>
          <dd>{deviceId ? deviceId.slice(0, 8) : '—'}</dd>
          <dt>Modo</dt>
          <dd>{isStandalone() ? 'App instalado' : 'Navegador'}</dd>
        </dl>
      </div>
    </>
  )
}
