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
  { id: 'rebanho', title: 'Rebanho', description: 'Cadastro e movimentação de animais', path: '/rebanho', icon: 'herd', status: 'planejado', stage: 2 },
  { id: 'pastos', title: 'Pastos', description: 'Pastos, lotação e manejo', path: '/pastos', icon: 'pasture', status: 'planejado', stage: 3 },
  { id: 'nascimentos-mortes', title: 'Nascimentos e mortes', description: 'Registro de nascimentos e óbitos', path: '/nascimentos-mortes', icon: 'calf', status: 'planejado', stage: 4 },
  { id: 'vendas-arroba', title: 'Vendas por arroba', description: 'Vendas calculadas por peso (@)', path: '/vendas-arroba', icon: 'scale', status: 'planejado', stage: 5 },
  { id: 'vendas-lote', title: 'Vendas por lote', description: 'Vendas por lote e preço por cabeça', path: '/vendas-lote', icon: 'tag', status: 'planejado', stage: 5 },
  { id: 'clientes', title: 'Clientes', description: 'Compradores e contatos', path: '/clientes', icon: 'people', status: 'planejado', stage: 6 },
  { id: 'contas-receber', title: 'Contas a receber', description: 'Valores a receber por venda', path: '/contas-receber', icon: 'receipt', status: 'planejado', stage: 7 },
  { id: 'pagamentos', title: 'Pagamentos parciais', description: 'Recebimentos parciais e saldo', path: '/pagamentos', icon: 'cash', status: 'planejado', stage: 7 },
  { id: 'reserva', title: 'Reserva financeira', description: 'Controle da reserva de 35%', path: '/reserva', icon: 'vault', status: 'planejado', stage: 8 },
  { id: 'relatorios', title: 'Relatórios', description: 'Relatórios e exportações', path: '/relatorios', icon: 'chart', status: 'planejado', stage: 9 },
  { id: 'configuracoes', title: 'Configurações', description: 'Backup, armazenamento e sistema', path: '/configuracoes', icon: 'gear', status: 'disponivel' },
]

export const moduleById = (id: string) => MODULES.find((m) => m.id === id)
