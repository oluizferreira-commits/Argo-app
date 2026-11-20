import { createHashRouter, type RouteObject } from 'react-router'
import { Layout } from '../components/Layout'
import { DashboardPage } from '../modules/dashboard/DashboardPage'
import { HubPage } from '../modules/hub/HubPage'
import { PlannedModulePage } from '../modules/planned/PlannedModulePage'
import { SettingsPage } from '../modules/settings/SettingsPage'
import { MODULES } from './modules'
import { FINANCE_MODULE_IDS } from './navigation'

/** Páginas já implementadas. Módulos fora desta lista usam a página "planejado". */
const IMPLEMENTED: Record<string, RouteObject['element']> = {
  dashboard: <DashboardPage />,
  configuracoes: <SettingsPage />,
}

const moduleRoutes: RouteObject[] = MODULES.map((m) => ({
  path: m.path,
  element: IMPLEMENTED[m.id] ?? <PlannedModulePage module={m} />,
}))

// HashRouter (#/rota): funciona em qualquer hospedagem estática e offline, sem configurar o servidor.
export const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      ...moduleRoutes,
      { path: '/financeiro', element: <HubPage ids={FINANCE_MODULE_IDS} intro="Vendas, clientes, recebimentos e reserva financeira." /> },
      { path: '/mais', element: <HubPage intro="Todos os módulos do ARGO." /> },
      { path: '*', element: <DashboardPage /> },
    ],
  },
])
