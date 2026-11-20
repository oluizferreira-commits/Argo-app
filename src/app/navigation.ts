import type { IconName } from '../components/Icon'

/** Abas da barra inferior (acesso rápido no campo). */
export const TABS: readonly { path: string; label: string; icon: IconName }[] = [
  { path: '/', label: 'Painel', icon: 'home' },
  { path: '/rebanho', label: 'Rebanho', icon: 'herd' },
  { path: '/pastos', label: 'Pastos', icon: 'pasture' },
  { path: '/financeiro', label: 'Financeiro', icon: 'wallet' },
  { path: '/mais', label: 'Mais', icon: 'grid' },
]

export const FINANCE_MODULE_IDS = ['vendas-arroba', 'vendas-lote', 'clientes', 'contas-receber', 'pagamentos', 'reserva']
