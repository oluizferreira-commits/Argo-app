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
import { totalsByCategory } from '../rebanho/herd'
import { useFarm } from '../fazendas/FarmContext'
import { SpecificationAlerts } from '../rebanho/SpecificationAlerts'
import { useBalances, usePastures, usePendingTasks } from '../rebanho/useHerd'

const SHORTCUTS = ['rebanho', 'pastos', 'vendas', 'clientes', 'acesso', 'contas-receber']

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
  const pastures = usePastures()
  const { balances } = useBalances()
  const { farm } = useFarm()
  const pendingMap = usePendingTasks()
  const pendingTasks = pendingMap ? [...pendingMap.values()].reduce((a, b) => a + b, 0) : 0
  const herdTotal = pastures
    ? [...totalsByCategory(balances, pastures.map((p) => p.id)).values()].reduce((a, b) => a + b, 0)
    : 0

  return (
    <>
      <section className="hero">
        <div className="gold-rule" />
        <h1>{greeting()}.</h1>
        <p>
          {new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}
        </p>
              <Link to="/fazenda" className="farm-chip">
          <Icon name="pasture" size={16} /> {farm.name}
        </Link>
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

      <SpecificationAlerts />

      <h2 className="section-title">Fazenda</h2>
      {pastures && pastures.length === 0 ? (
        <Link to="/pastos/novo" className="card list-link" style={{ padding: 18 }}>
          <div className="status-icon">
            <Icon name="pasture" />
          </div>
          <div className="status-body">
            <div className="status-label">Comece cadastrando seus pastos</div>
            <div className="status-detail">Depois, faça a contagem inicial de cada um.</div>
          </div>
          <Icon name="chevronRight" size={20} className="muted" />
        </Link>
      ) : (
        <div className="card status-list">
          <Link to="/rebanho" style={{ color: 'inherit', textDecoration: 'none' }}>
            <StatusItem
              icon="herd"
              label="Rebanho"
              detail={`${pastures?.length ?? 0} pasto(s)`}
              badge={<span className="big-number" style={{ fontSize: 30 }} data-testid="dash-total">{herdTotal.toLocaleString('pt-BR')}</span>}
            />
          </Link>
          <Link to="/pastos" style={{ color: 'inherit', textDecoration: 'none' }}>
            <StatusItem
              icon="clipboard"
              label="Serviços nos pastos"
              detail={pendingTasks ? `${pendingTasks} pendente(s)` : 'Nada pendente'}
              badge={pendingTasks ? <span className="badge badge-warn">{pendingTasks}</span> : <span className="badge badge-ok">OK</span>}
            />
          </Link>
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

      <p className="app-credit">
        ARGO · Gestão Pecuária · <span>by Luiz Ferreira</span>
      </p>
    </>
  )
}
