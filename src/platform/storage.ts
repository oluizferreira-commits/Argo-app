export interface StorageStatus {
  supported: boolean
  persisted: boolean
  usage?: number
  quota?: number
}

/** Situação do armazenamento local (persistente = protegido contra limpeza automática). */
export async function getStorageStatus(): Promise<StorageStatus> {
  const s = navigator.storage
  if (!s?.persisted) return { supported: false, persisted: false }
  const [persisted, est] = await Promise.all([s.persisted(), s.estimate?.() ?? Promise.resolve(undefined)])
  return { supported: true, persisted, usage: est?.usage, quota: est?.quota }
}

/** Pede ao navegador para não apagar os dados do ARGO automaticamente. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

/** true quando aberto pelo ícone da tela inicial (modo app). */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches
}
