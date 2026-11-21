import { Link } from 'react-router'
import { Icon } from '../../components/Icon'
import { isStandalone } from '../../platform/storage'
import { useFarm } from '../fazendas/FarmContext'
import { AgendaSection, IndicatorsSection, PendingCenter, RecentActivity } from './DashboardSections'
import { QuickLaunch } from './QuickLaunch'
import { RunningServicesBanner } from '../maquinas/RunningServicesBanner'
import { useDashboardData } from './useDashboardData'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

/**
 * Painel: boas-vindas compacto → indicadores → Central de Pendências → Novo lançamento →
 * Agenda Operacional → Atividades recentes. Situação do sistema e backup ficam em Configurações.
 */
export function DashboardPage() {
  const { farm } = useFarm()
  const d = useDashboardData()
  const standalone = isStandalone()
  const today = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())

  return (
    <>
      <section className="hero hero-compact" data-testid="welcome">
        <div className="gold-rule" />
        <h1>{greeting()}.</h1>
        <div className="hero-line">
          <p>{today}</p>
          <Link to="/fazenda" className="farm-chip">
            <Icon name="pasture" size={16} /> {farm.name}
          </Link>
        </div>
      </section>

      <RunningServicesBanner />

      {d && (
        <>
          <IndicatorsSection ind={d.indicators} today={d.today} />
          <PendingCenter items={d.pendencies} />
          <QuickLaunch />
          <AgendaSection items={d.agenda} today={d.today} />
          <RecentActivity items={d.activities} />
        </>
      )}

      {!standalone && (
        <div className="notice notice-warn">
          <Icon name="download" />
          <div>
            <strong>Instale o ARGO no iPhone.</strong> No Safari, toque em <strong>Compartilhar</strong> e depois em{' '}
            <strong>Adicionar à Tela de Início</strong>. Instalado, o app abre em tela cheia e os dados ficam mais protegidos.
          </div>
        </div>
      )}

      <Link to="/configuracoes" className="btn btn-outline btn-block">
        <Icon name="gear" /> Configurações, segurança e backup
      </Link>

      <p className="app-credit">
        ARGO · Gestão Pecuária · <span>by Luiz Ferreira</span>
      </p>
    </>
  )
}
