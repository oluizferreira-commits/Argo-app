import type { SyncAdapter } from './types'

/** Adaptador padrão: nenhum servidor configurado. Os dados ficam só no aparelho. */
export const localOnlyAdapter: SyncAdapter = {
  name: 'Somente local',
  isConfigured: () => false,
  push: () => Promise.reject(new Error('Sincronização em nuvem não configurada')),
  pull: () => Promise.reject(new Error('Sincronização em nuvem não configurada')),
}
