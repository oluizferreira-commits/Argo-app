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
}

/**
 * Registro central dos módulos do ARGO.
 * Para ativar um módulo: implemente a página em src/modules/<id>/, registre a rota
 * em src/app/routes.tsx e mude `status` para 'disponivel'.
 */
export const MODULES: readonly ModuleDef[] = [
  { id: 'dashboard', title: 'Painel', description: 'Visão geral da fazenda', path: '/', icon: 'home', status: 'disponivel' },
  { id: 'rebanho', title: 'Rebanho', description: 'Contagem e movimentação por pasto', path: '/rebanho', icon: 'herd', status: 'disponivel' },
  { id: 'pastos', title: 'Pastos', description: 'Pastos, lotação e serviços', path: '/pastos', icon: 'pasture', status: 'disponivel' },
  { id: 'nascimentos-mortes', title: 'Nascimentos e mortes', description: 'Registrados em Nova movimentação', path: '/rebanho/movimentar', icon: 'calf', status: 'disponivel' },
  { id: 'vendas', title: 'Vendas', description: 'Histórico de vendas e comprovantes', path: '/vendas', icon: 'receipt', status: 'disponivel' },
  { id: 'vendas-arroba', title: 'Vendas por arroba', description: 'Peso vivo (kg ÷ 30) ou abate (@)', path: '/vendas/nova/arroba', icon: 'scale', status: 'disponivel' },
  { id: 'vendas-lote', title: 'Vendas por lote', description: 'Lote com preço por cabeça', path: '/vendas/nova/cabeca', icon: 'tag', status: 'disponivel' },
  { id: 'clientes', title: 'Clientes', description: 'Compradores e contatos', path: '/clientes', icon: 'people', status: 'disponivel' },
  { id: 'contas-receber', title: 'Contas a receber', description: 'Parcelas em aberto e vencidas', path: '/receber', icon: 'receipt', status: 'disponivel' },
  { id: 'pagamentos', title: 'Pagamentos parciais', description: 'Histórico de recebimentos', path: '/pagamentos', icon: 'cash', status: 'disponivel' },
  { id: 'reserva', title: 'Reserva financeira', description: 'Percentual de cada venda, em conta separada', path: '/reserva', icon: 'vault', status: 'disponivel' },
  { id: 'acesso', title: 'Como chegar à fazenda', description: 'Mapa, rotas e guia de acesso', path: '/acesso', icon: 'map', status: 'disponivel' },
  { id: 'relatorios', title: 'Relatórios', description: 'Mês a mês ou por ano, em PDF', path: '/relatorios', icon: 'chart', status: 'disponivel' },
  { id: 'maquinas', title: 'Máquinas', description: 'Horímetro digital, serviços e histórico de cada máquina', path: '/maquinas', icon: 'clock', status: 'disponivel' },
  { id: 'manejo', title: 'Manejo de pastagens', description: 'Herbicidas, plantio, máquinas e custo por pasto', path: '/manejo', icon: 'pasture', status: 'disponivel' },
  { id: 'vacinacao', title: 'Vacinação', description: 'Por pasto e lote, com cobertura e pendentes', path: '/vacinacao', icon: 'syringe', status: 'disponivel' },
  { id: 'insumos', title: 'Insumos', description: 'Sal e outros produtos em sacos, consumo no cocho', path: '/insumos', icon: 'sack', status: 'disponivel' },
  { id: 'diesel', title: 'Diesel', description: 'Compras, abastecimentos e custo médio', path: '/diesel', icon: 'fuel', status: 'disponivel' },
  { id: 'responsaveis', title: 'Responsáveis', description: 'Quem opera máquinas e aplica vacinas', path: '/responsaveis', icon: 'user', status: 'disponivel' },
  { id: 'configuracoes', title: 'Configurações', description: 'Backup, armazenamento e sistema', path: '/configuracoes', icon: 'gear', status: 'disponivel' },
]

export const moduleById = (id: string) => MODULES.find((m) => m.id === id)
