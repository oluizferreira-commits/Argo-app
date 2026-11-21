import { createContext, useContext } from 'react'
import type { Farm } from '../../db/types'

export interface FarmContextValue {
  farm: Farm
  /** Volta para a tela "Escolha a fazenda". */
  switchFarm: () => Promise<void>
}

export const FarmContext = createContext<FarmContextValue | null>(null)

/** Fazenda aberta no momento. Só pode ser usado dentro do FarmGate. */
export function useFarm(): FarmContextValue {
  const v = useContext(FarmContext)
  if (!v) throw new Error('useFarm fora do FarmGate')
  return v
}
