import { useRegisterSW } from 'virtual:pwa-register/react'
import { Icon } from './Icon'

/**
 * Avisa quando há nova versão do ARGO. A atualização só é aplicada quando o
 * usuário toca em "Atualizar" — nunca no meio de um lançamento.
 * Os dados ficam no banco local e não são afetados pela atualização.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Procura nova versão a cada hora enquanto o app estiver aberto.
      if (registration) setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000)
    },
  })

  if (!needRefresh) return null
  return (
    <div className="update-banner" role="status">
      <Icon name="refresh" />
      <div style={{ flex: 1, fontSize: 15 }}>Nova versão do ARGO disponível.</div>
      <button className="btn btn-outline" onClick={() => setNeedRefresh(false)}>
        Depois
      </button>
      <button className="btn btn-gold" onClick={() => updateServiceWorker(true)}>
        Atualizar
      </button>
    </div>
  )
}
