import { useState } from 'react'
import { Link } from 'react-router'
import { BackupReminder } from '../../backup/BackupReminder'
import { FarmLandscape } from '../../components/Art'
import { Icon } from '../../components/Icon'
import { useOnline } from '../../hooks/useOnline'
import { isStandalone } from '../../platform/storage'
import { HeroWeather } from '../clima/WeatherWidgets'
import { useFarm } from '../fazendas/FarmContext'
import { UpdatedNotice } from '../novidades/UpdatedNotice'
import { VoiceTaskButton } from '../tarefas/VoiceTask'
import { AgendaSection, IndicatorsSection, PendingCenter, RecentActivity } from './DashboardSections'
import { QuickLaunch } from './QuickLaunch'
import { RunningServicesBanner } from '../maquinas/RunningServicesBanner'
import { useDashboardData } from './useDashboardData'

function greeting(hour: number): string {
  if (hour < 12) return 'Bom dia'
  if (hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

const n = (v: number) => v.toLocaleString('pt-BR')

/**
 * Painel "Terra & Tecnologia": cabeçalho integrado ao fundo → cartão principal com paisagem →
 * visão da fazenda (rebanho, pastos, financeiro) → Central de Pendências → ações rápidas →
 * Agenda Operacional → atividades recentes. Tudo com dados reais já lançados.
 */
export function DashboardPage() {
  const { farm } = useFarm()
  const online = useOnline()
  const d = useDashboardData()
  const standalone = isStandalone()
  const [now] = useState(() => new Date())
  const today = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(now)
  const pendCount = d?.pendencies.length ?? 0
  const todayItems = d ? d.agenda.filter((a) => a.date === d.today && a.status !== 'concluida').length : 0

  return (
    <>
      <h1 className="visually-hidden">Painel · {farm.name}</h1>
      <header className="home-top">
        <div className="home-brand">
          <img src={`${import.meta.env.BASE_URL}logo-mark.svg`} alt="" />
          <div>
            <div className="brand-name">ARGO</div>
            <div className="brand-sub">Gestão Pecuária</div>
          </div>
        </div>
        <span className={`home-net${online ? '' : ' offline'}`} title={online ? 'Online' : 'Offline'}>
          <i />
          {online ? 'Online' : 'Offline'}
        </span>
        <button
          type="button"
          className="round-btn"
          aria-label={pendCount ? `${pendCount} pendências` : 'Sem pendências'}
          onClick={() => document.getElementById('pendencias')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          data-testid="bell"
        >
          <Icon name="bell" size={22} />
          {pendCount > 0 && <span className="round-badge">{pendCount > 99 ? '99+' : pendCount}</span>}
        </button>
        <Link to="/configuracoes" className="round-btn" aria-label="Configurações, segurança e backup">
          <Icon name="gear" size={22} />
        </Link>
      </header>

      <BackupReminder />

      <section className="home-hero" data-testid="welcome">
        <FarmLandscape className="home-hero-art" />
        <HeroWeather farm={farm} />
        <div className="home-hero-body">
          <p className="hero-eyebrow">
            {greeting(now.getHours())} · <span>{today}</span>
          </p>
          <Link to="/fazenda" className="farm-chip farm-title">
            {farm.name}
          </Link>
          {d && (
            <div className="hero-stats" data-testid="hero-summary">
              <span>
                <b>{n(d.indicators.animals)}</b> {d.indicators.animals === 1 ? 'cabeça' : 'cabeças'}
              </span>
              <span>
                <b>{n(d.indicators.occupiedPastures)}</b> de {n(d.indicators.pastures)} pastos ocupados
              </span>
              <span className={pendCount ? 'is-alert' : ''}>
                <b>{n(pendCount)}</b> {pendCount === 1 ? 'pendência' : 'pendências'}
              </span>
              {todayItems > 0 && (
                <span>
                  <b>{n(todayItems)}</b> para hoje
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      <UpdatedNotice createdAt={farm.createdAt} />

      <VoiceTaskButton />

      <RunningServicesBanner />

      {d ? (
        <>
          <IndicatorsSection ind={d.indicators} today={d.today} />
          <PendingCenter items={d.pendencies} />
          <QuickLaunch />
          <AgendaSection items={d.agenda} today={d.today} />
          <RecentActivity items={d.activities} />
        </>
      ) : (
        <div className="argo-loading" role="status">
          <img src={`${import.meta.env.BASE_URL}logo-mark.svg`} alt="" />
          Carregando a fazenda
        </div>
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

      <p className="app-credit">
        ARGO · Terra &amp; Tecnologia · <span>by Luiz Ferreira</span>
      </p>
    </>
  )
}
