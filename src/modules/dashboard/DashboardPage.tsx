import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router'
import { MODULES } from '../../app/modules'
import { formatDateTime } from '../../core/format'
import { db } from '../../db/database'
import { Icon } from '../../components/Icon'
import { StatusItem } from '../../components/StatusItem'
import { useOnline } from '../../hooks/useOnline'
import { useStorageStatus } from '../../hooks/useStorageStatus'
import { isStandalone } from '../../platform/storage'

const SHORTCUTS = ['rebanho', 'pastos', 'nascimentos-mortes', 'vendas-arroba', 'contas-receber', 'relatorios']

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

export function DashboardPage() {
  const online = useOnline()
  const { status } = useStorageStatus()
  const lastBackupAt = useLiveQuery(async () => (await db.meta.get('lastBackupAt'))?.value as string | undefined)
  const pending = useLiveQuery(() => db.outbox.count(), [], 0)
  const standalone = isStandalone()

  return (
    <>
      <section className="hero">
        <div className="gold-rule" />
        <h1>{greeting()}.</h1>
        <p>
          {new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}
        </p>
      </section>

      {!standalone && (
        <div className="notice notice-warn">
          <Icon name="download" />
          <div>
            <strong>Instale o ARGO no iPhone.</strong> No Safari, toque em <strong>Compartilhar</strong> e depois em{' '}
            <strong>Adicionar à Tela de Início</strong>. Instalado, o app abre em tela cheia e os dados ficam mais protegidos.
          </div>
        </div>
      )}

      <h2 className="section-title">Situação do sistema</h2>
      <div className="card status-list">
        <StatusItem
          icon="database"
          label="Dados locais"
          detail={
            status === null
              ? 'Verificando…'
              : status.persisted
                ? 'Armazenamento persistente ativo'
                : 'Armazenamento padrão do navegador'
          }
          badge={
            status?.persisted ? (
              <span className="badge badge-ok">Protegido</span>
            ) : (
              <span className="badge badge-neutral">Local</span>
            )
          }
        />
        <StatusItem
          icon={online ? 'cloud' : 'cloudOff'}
          label="Conexão"
          detail={online ? 'Conectado à internet' : 'Sem internet — tudo continua funcionando'}
          badge={<span className={`badge ${online ? 'badge-ok' : 'badge-gold'}`}>{online ? 'Online' : 'Offline'}</span>}
        />
        <StatusItem
          icon="shield"
          label="Último backup"
          detail={lastBackupAt ? formatDateTime(lastBackupAt) : 'Nenhum backup exportado ainda'}
          badge={lastBackupAt ? <span className="badge badge-ok">OK</span> : <span className="badge badge-warn">Pendente</span>}
        />
        <StatusItem
          icon="refresh"
          label="Sincronização em nuvem"
          detail={`Não configurada — dados apenas neste aparelho${pending ? ` · ${pending} alteração(ões) aguardando` : ''}`}
          badge={<span className="badge badge-neutral">Local</span>}
        />
      </div>

      <h2 className="section-title">Módulos</h2>
      <div className="module-grid">
        {SHORTCUTS.map((id) => MODULES.find((m) => m.id === id)!).map((m) => (
          <Link key={m.id} to={m.path} className={`module-tile${m.status === 'planejado' ? ' planned' : ''}`}>
            <div className="tile-icon">
              <Icon name={m.icon} />
            </div>
            <div className="tile-title">{m.title}</div>
            {m.status === 'planejado' && <span className="badge badge-gold" style={{ alignSelf: 'flex-start' }}>Em breve</span>}
          </Link>
        ))}
      </div>

      <Link to="/configuracoes" className="btn btn-outline btn-block">
        <Icon name="gear" /> Configurações e backup
      </Link>
    </>
  )
}
