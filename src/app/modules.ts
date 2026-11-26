import type { IconName } from '../components/Icon'

export type ModuleStatus = 'disponivel' | 'planejado'

export interface ModuleDef {
  id: string
  title: string
  description: string
  path: string
  icon: IconName
  status: ModuleStatus
  /** Etapa prevista de implementação (apenas para módulos planejados). */
  stage?: number
  /** Nome curto do ícone na tela "Mais" (cabe embaixo do quadradinho). */
  short?: string
  /** Pasta (grupo) da tela "Mais". */
  group?: ModuleGroup
}

export type ModuleGroup = 'campo' | 'maquinas' | 'vendas' | 'fazenda'

/** Pastas da tela "Mais": cada uma com sua cor, para achar as coisas sem ler. */
export const MODULE_GROUPS: readonly { id: ModuleGroup; title: string }[] = [
  { id: 'campo', title: 'Gado e pastos' },
  { id: 'maquinas', title: 'Máquinas e equipe' },
  { id: 'vendas', title: 'Vendas e dinheiro' },
  { id: 'fazenda', title: 'Fazenda e sistema' },
]

/**
 * Registro central dos módulos do ARGO.
 * Para ativar um módulo: implemente a página em src/modules/<id>/, registre a rota
 * em src/app/routes.tsx e mude `status` para 'disponivel'.
 */
export const MODULES: readonly ModuleDef[] = [
  { id: 'dashboard', title: 'Painel', description: 'Visão geral da fazenda', path: '/', icon: 'home', status: 'disponivel' },
  { id: 'maps', title: 'ARGO Maps', description: 'Mapa da fazenda: perímetro, pastos e áreas no satélite', path: '/maps', icon: 'layers', status: 'disponivel', short: 'Maps', group: 'campo' },
  { id: 'rebanho', title: 'Rebanho', description: 'Contagem e movimentação por pasto', path: '/rebanho', icon: 'herd', status: 'disponivel', short: 'Rebanho', group: 'campo' },
  { id: 'pastos', title: 'Pastos', description: 'Pastos, lotação e serviços', path: '/pastos', icon: 'pasture', status: 'disponivel', short: 'Pastos', group: 'campo' },
  { id: 'nascimentos-mortes', title: 'Nascimentos e mortes', description: 'Registrados em Nova movimentação', path: '/rebanho/movimentar', icon: 'calf', status: 'disponivel', short: 'Nascer e morrer', group: 'campo' },
  { id: 'vendas', title: 'Vendas', description: 'Histórico de vendas e comprovantes', path: '/vendas', icon: 'receipt', status: 'disponivel', short: 'Vendas', group: 'vendas' },
  { id: 'pesagens', title: 'Pesagem de lote', description: 'Pesar primeiro, vender depois (sem comprador)', path: '/pesagens', icon: 'scale', status: 'disponivel', short: 'Pesagem', group: 'vendas' },
  { id: 'vendas-kg', title: 'Vendas por kg', description: 'Pesagens de 1 a 4 cabeças, preço do quilo', path: '/vendas/nova/kg', icon: 'scale', status: 'disponivel', short: 'Venda por kg', group: 'vendas' },
  { id: 'vendas-arroba', title: 'Vendas por arroba', description: 'Peso vivo (kg ÷ 30) ou abate (@)', path: '/vendas/nova/arroba', icon: 'scale', status: 'disponivel', short: 'Venda por @', group: 'vendas' },
  { id: 'vendas-lote', title: 'Vendas por lote', description: 'Lote com preço por cabeça', path: '/vendas/nova/cabeca', icon: 'tag', status: 'disponivel', short: 'Venda por lote', group: 'vendas' },
  { id: 'clientes', title: 'Clientes', description: 'Compradores e contatos', path: '/clientes', icon: 'handshake', status: 'disponivel', short: 'Clientes', group: 'vendas' },
  { id: 'contas-receber', title: 'Contas a receber', description: 'Parcelas em aberto e vencidas', path: '/receber', icon: 'hourglass', status: 'disponivel', short: 'A receber', group: 'vendas' },
  { id: 'pagamentos', title: 'Pagamentos parciais', description: 'Histórico de recebimentos', path: '/pagamentos', icon: 'cash', status: 'disponivel', short: 'Recebimentos', group: 'vendas' },
  { id: 'reserva', title: 'Reserva financeira', description: 'Percentual de cada venda, em conta separada', path: '/reserva', icon: 'vault', status: 'disponivel', short: 'Reserva', group: 'vendas' },
  { id: 'acesso', title: 'Como chegar à fazenda', description: 'Mapa, rotas e guia de acesso', path: '/acesso', icon: 'map', status: 'disponivel', short: 'Como chegar', group: 'fazenda' },
  { id: 'relatorios', title: 'Relatórios', description: 'Mês a mês ou por ano, em PDF', path: '/relatorios', icon: 'chart', status: 'disponivel', short: 'Relatórios', group: 'vendas' },
  { id: 'maquinas', title: 'Máquinas', description: 'Horímetro digital, serviços e histórico de cada máquina', path: '/maquinas', icon: 'tractor', status: 'disponivel', short: 'Máquinas', group: 'maquinas' },
  { id: 'tarefas', title: 'Tarefas', description: 'Anotar o que precisa ser feito, com prazo e responsável', path: '/tarefas', icon: 'clipboard', status: 'disponivel', short: 'Tarefas', group: 'maquinas' },
  { id: 'diaristas', title: 'Diaristas', description: 'Calendário de diárias, fechamento e pagamentos', path: '/diaristas', icon: 'calendar', status: 'disponivel', short: 'Diaristas', group: 'maquinas' },
  { id: 'manejo', title: 'Manejo de pastagens', description: 'Herbicidas, plantio, máquinas e custo por pasto', path: '/manejo', icon: 'sprout', status: 'disponivel', short: 'Manejo', group: 'campo' },
  { id: 'vacinacao', title: 'Vacinação', description: 'Por pasto e lote, com cobertura e pendentes', path: '/vacinacao', icon: 'syringe', status: 'disponivel', short: 'Vacinação', group: 'campo' },
  { id: 'insumos', title: 'Insumos', description: 'Sal e outros produtos em sacos, consumo no cocho', path: '/insumos', icon: 'sack', status: 'disponivel', short: 'Insumos', group: 'campo' },
  { id: 'diesel', title: 'Diesel', description: 'Compras, abastecimentos e custo médio', path: '/diesel', icon: 'fuel', status: 'disponivel', short: 'Diesel', group: 'maquinas' },
  { id: 'responsaveis', title: 'Responsáveis', description: 'Quem opera máquinas e aplica vacinas', path: '/responsaveis', icon: 'user', status: 'disponivel', short: 'Responsáveis', group: 'maquinas' },
  { id: 'novidades', title: 'Novidades', description: 'O que mudou em cada versão do ARGO', path: '/novidades', icon: 'sparkle', status: 'disponivel', short: 'Novidades', group: 'fazenda' },
  { id: 'configuracoes', title: 'Configurações', description: 'Backup, armazenamento e sistema', path: '/configuracoes', icon: 'gear', status: 'disponivel', short: 'Ajustes', group: 'fazenda' },
]

export const moduleById = (id: string) => MODULES.find((m) => m.id === id)
