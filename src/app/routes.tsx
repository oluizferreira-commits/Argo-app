import { createHashRouter, type RouteObject } from 'react-router'
import { Layout } from '../components/Layout'
import { DashboardPage } from '../modules/dashboard/DashboardPage'
import { ComoChegarPage } from '../modules/acesso/ComoChegarPage'
import { FazendaPage } from '../modules/fazendas/FazendaPage'
import { PagamentosPage } from '../modules/receber/PagamentosPage'
import { ReceberPage } from '../modules/receber/ReceberPage'
import { HubPage } from '../modules/hub/HubPage'
import { ClienteFormPage } from '../modules/clientes/ClienteFormPage'
import { ClientePage } from '../modules/clientes/ClientePage'
import { ClientesPage } from '../modules/clientes/ClientesPage'
import { NovaVendaPage } from '../modules/vendas/NovaVendaPage'
import { VendaPage } from '../modules/vendas/VendaPage'
import { VendasPage } from '../modules/vendas/VendasPage'
import { PastoFormPage } from '../modules/pastos/PastoFormPage'
import { PastoPage } from '../modules/pastos/PastoPage'
import { PastosPage } from '../modules/pastos/PastosPage'
import { PlannedModulePage } from '../modules/planned/PlannedModulePage'
import { HistoricoPage } from '../modules/rebanho/HistoricoPage'
import { MovimentacaoPage } from '../modules/rebanho/MovimentacaoPage'
import { MovimentarPage, MovimentarTipoPage } from '../modules/rebanho/MovimentarPage'
import { RebanhoPage } from '../modules/rebanho/RebanhoPage'
import { SettingsPage } from '../modules/settings/SettingsPage'
import { MODULES } from './modules'
import { FINANCE_MODULE_IDS } from './navigation'

/** `handle.title` = título exibido no cabeçalho. */
export interface RouteHandle {
  title: string
}

const t = (title: string): RouteHandle => ({ title })

/** Páginas implementadas. */
const implemented: RouteObject[] = [
  { path: '/', element: <DashboardPage />, handle: t('ARGO') },
  { path: '/rebanho', element: <RebanhoPage />, handle: t('Rebanho') },
  { path: '/rebanho/movimentar', element: <MovimentarPage />, handle: t('Nova movimentação') },
  { path: '/rebanho/movimentar/:tipo', element: <MovimentarTipoPage />, handle: t('Nova movimentação') },
  { path: '/rebanho/historico', element: <HistoricoPage />, handle: t('Histórico do rebanho') },
  { path: '/rebanho/movimentacao/:id', element: <MovimentacaoPage />, handle: t('Movimentação') },
  { path: '/pastos', element: <PastosPage />, handle: t('Pastos') },
  { path: '/pastos/novo', element: <PastoFormPage />, handle: t('Novo pasto') },
  { path: '/pastos/:id', element: <PastoPage />, handle: t('Pasto') },
  { path: '/pastos/:id/editar', element: <PastoFormPage />, handle: t('Editar pasto') },
  { path: '/fazenda', element: <FazendaPage />, handle: t('Fazenda') },
  { path: '/acesso', element: <ComoChegarPage />, handle: t('Como chegar') },
  { path: '/vendas', element: <VendasPage />, handle: t('Vendas') },
  { path: '/receber', element: <ReceberPage />, handle: t('Contas a receber') },
  { path: '/pagamentos', element: <PagamentosPage />, handle: t('Recebimentos') },
  { path: '/vendas/nova', element: <NovaVendaPage />, handle: t('Nova venda') },
  { path: '/vendas/nova/:modo', element: <NovaVendaPage />, handle: t('Nova venda') },
  { path: '/vendas/:id', element: <VendaPage />, handle: t('Venda') },
  { path: '/clientes', element: <ClientesPage />, handle: t('Clientes') },
  { path: '/clientes/novo', element: <ClienteFormPage />, handle: t('Novo cliente') },
  { path: '/clientes/:id', element: <ClientePage />, handle: t('Cliente') },
  { path: '/clientes/:id/editar', element: <ClienteFormPage />, handle: t('Editar cliente') },
  { path: '/configuracoes', element: <SettingsPage />, handle: t('Configurações') },
  { path: '/financeiro', element: <HubPage ids={FINANCE_MODULE_IDS} intro="Vendas, clientes, recebimentos e reserva financeira." />, handle: t('Financeiro') },
  { path: '/mais', element: <HubPage intro="Todos os módulos do ARGO." />, handle: t('Módulos') },
]

/** Módulos ainda não desenvolvidos: página "Módulo planejado". */
const planned: RouteObject[] = MODULES.filter((m) => m.status === 'planejado').map((m) => ({
  path: m.path,
  element: <PlannedModulePage module={m} />,
  handle: t(m.title),
}))

// HashRouter (#/rota): funciona em qualquer hospedagem estática e offline, sem configurar o servidor.
export const router = createHashRouter([
  {
    element: <Layout />,
    children: [...implemented, ...planned, { path: '*', element: <DashboardPage />, handle: t('ARGO') }],
  },
])
