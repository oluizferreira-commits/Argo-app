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
  { id: 'contas-receber', title: 'Contas a receber', description: 'Valores a receber por venda', path: '/contas-receber', icon: 'receipt', status: 'planejado', stage: 4 },
  { id: 'pagamentos', title: 'Pagamentos parciais', description: 'Recebimentos parciais e saldo', path: '/pagamentos', icon: 'cash', status: 'planejado', stage: 4 },
  { id: 'reserva', title: 'Reserva financeira', description: 'Controle da reserva de 35%', path: '/reserva', icon: 'vault', status: 'planejado', stage: 5 },
  { id: 'relatorios', title: 'Relatórios', description: 'Relatórios e exportações', path: '/relatorios', icon: 'chart', status: 'planejado', stage: 6 },
  { id: 'configuracoes', title: 'Configurações', description: 'Backup, armazenamento e sistema', path: '/configuracoes', icon: 'gear', status: 'disponivel' },
]

export const moduleById = (id: string) => MODULES.find((m) => m.id === id)
