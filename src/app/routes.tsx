import { createHashRouter, type RouteObject } from 'react-router'
import { Layout } from '../components/Layout'
import { DashboardPage } from '../modules/dashboard/DashboardPage'
import { ComoChegarPage } from '../modules/acesso/ComoChegarPage'
import { FazendaPage } from '../modules/fazendas/FazendaPage'
import { PagamentosPage } from '../modules/receber/PagamentosPage'
import { ReceberPage } from '../modules/receber/ReceberPage'
import { ReservaPage } from '../modules/reserva/ReservaPage'
import { RelatoriosPage } from '../modules/relatorios/RelatoriosPage'
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
import { DieselPage } from '../modules/diesel/DieselPage'
import { DadosResponsavelPage } from '../modules/financeiro/DadosResponsavelPage'
import { FinanceiroPage } from '../modules/financeiro/FinanceiroPage'
import { NovaVacinacaoPage } from '../modules/vacinacao/NovaVacinacaoPage'
import { VacinacaoDetailPage } from '../modules/vacinacao/VacinacaoDetailPage'
import { VacinacaoPage } from '../modules/vacinacao/VacinacaoPage'
import { ManejoPage } from '../modules/manejo/ManejoPage'
import { OperacaoFormPage } from '../modules/manejo/OperacaoFormPage'
import { OperacaoPage } from '../modules/manejo/OperacaoPage'
import { ChecklistPage, ManutencaoPage } from '../modules/maquinas/ManutencaoPages'
import { MaquinaPage } from '../modules/maquinas/MaquinaPage'
import { MaquinasPage } from '../modules/maquinas/MaquinasPage'
import { IniciarServicoPage, ServicoPage } from '../modules/maquinas/ServicoPages'
import { DiaristaPage } from '../modules/diaristas/DiaristaPage'
import { DiaristasPage } from '../modules/diaristas/DiaristasPage'
import { TarefasPage } from '../modules/tarefas/TarefasPage'
import { InsumoPage } from '../modules/insumos/InsumoPage'
import { InsumosPage } from '../modules/insumos/InsumosPage'
import { ResponsaveisPage } from '../modules/responsaveis/ResponsaveisPage'
import { SettingsPage } from '../modules/settings/SettingsPage'
import { MODULES } from './modules'

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
  { path: '/reserva', element: <ReservaPage />, handle: t('Reserva financeira') },
  { path: '/relatorios', element: <RelatoriosPage />, handle: t('Relatórios') },
  { path: '/vendas/nova', element: <NovaVendaPage />, handle: t('Nova venda') },
  { path: '/vendas/nova/:modo', element: <NovaVendaPage />, handle: t('Nova venda') },
  { path: '/vendas/:id', element: <VendaPage />, handle: t('Venda') },
  { path: '/clientes', element: <ClientesPage />, handle: t('Clientes') },
  { path: '/clientes/novo', element: <ClienteFormPage />, handle: t('Novo cliente') },
  { path: '/clientes/:id', element: <ClientePage />, handle: t('Cliente') },
  { path: '/clientes/:id/editar', element: <ClienteFormPage />, handle: t('Editar cliente') },
  { path: '/insumos', element: <InsumosPage />, handle: t('Insumos') },
  { path: '/insumos/:id', element: <InsumoPage />, handle: t('Insumo') },
  { path: '/diesel', element: <DieselPage />, handle: t('Diesel') },
  { path: '/diesel/equipamentos', element: <MaquinasPage />, handle: t('Máquinas') },
  { path: '/maquinas', element: <MaquinasPage />, handle: t('Máquinas') },
  { path: '/maquinas/servico/novo', element: <IniciarServicoPage />, handle: t('Iniciar serviço') },
  { path: '/maquinas/servico/:id', element: <ServicoPage />, handle: t('Serviço') },
  { path: '/maquinas/:id', element: <MaquinaPage />, handle: t('Máquina') },
  { path: '/maquinas/:id/manutencao', element: <ManutencaoPage />, handle: t('Manutenção') },
  { path: '/maquinas/:id/checklist', element: <ChecklistPage />, handle: t('Checklist diário') },
  { path: '/vacinacao', element: <VacinacaoPage />, handle: t('Vacinação') },
  { path: '/vacinacao/nova', element: <NovaVacinacaoPage />, handle: t('Nova vacinação') },
  { path: '/vacinacao/:id', element: <VacinacaoDetailPage />, handle: t('Vacinação') },
  { path: '/manejo', element: <ManejoPage />, handle: t('Manejo de pastagens') },
  { path: '/manejo/nova', element: <OperacaoFormPage />, handle: t('Operação de campo') },
  { path: '/manejo/:id', element: <OperacaoPage />, handle: t('Operação de campo') },
  { path: '/diaristas', element: <DiaristasPage />, handle: t('Diaristas') },
  { path: '/diaristas/:id', element: <DiaristaPage />, handle: t('Diarista') },
  { path: '/tarefas', element: <TarefasPage />, handle: t('Tarefas') },
  { path: '/responsaveis', element: <ResponsaveisPage />, handle: t('Responsáveis') },
  { path: '/configuracoes', element: <SettingsPage />, handle: t('Configurações') },
  { path: '/financeiro', element: <FinanceiroPage />, handle: t('Financeiro') },
  { path: '/financeiro/dados', element: <DadosResponsavelPage />, handle: t('Dados do responsável') },
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
