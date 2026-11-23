import type { IconName } from '../components/Icon'

/** Abas da barra inferior (acesso rápido no campo). */
export const TABS: readonly { path: string; label: string; icon: IconName }[] = [
  { path: '/', label: 'Painel', icon: 'home' },
  { path: '/rebanho', label: 'Rebanho', icon: 'herd' },
  { path: '/pastos', label: 'Pastos', icon: 'pasture' },
  { path: '/tarefas', label: 'Tarefas', icon: 'clipboard' },
  { path: '/financeiro', label: 'Financeiro', icon: 'wallet' },
  { path: '/mais', label: 'Mais', icon: 'grid' },
]

