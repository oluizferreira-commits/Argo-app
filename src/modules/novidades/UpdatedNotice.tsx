import { useState } from 'react'
import { Link } from 'react-router'
import { changesSince, markVersionSeen, pendingUpdateNotice } from '../../app/changelog'
import { Icon } from '../../components/Icon'

/** Depois de uma atualização, avisa no Painel (uma vez) a versão nova e o que mudou. */
export function UpdatedNotice({ createdAt }: { createdAt: string }) {
  const current = __APP_VERSION__
  const [previous, setPrevious] = useState(() => pendingUpdateNotice(current, createdAt))
  if (!previous) return null
  const news = changesSince(previous, current)
  const close = () => {
    markVersionSeen(current)
    setPrevious(null)
  }
  return (
    <section className="updated-notice" data-testid="updated-notice" role="status">
      <span className="updated-icon">
        <Icon name="sparkle" size={24} />
      </span>
      <div className="updated-body">
        <b>ARGO atualizado para a versão {current}</b>
        {news[0] && <span>{news[0].title}{news.length > 1 ? ` e mais ${news.length - 1} novidade${news.length > 2 ? 's' : ''}` : ''}</span>}
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <Link to="/novidades" className="btn btn-gold btn-compact" onClick={close} data-testid="see-news">
            Ver novidades
          </Link>
          <button type="button" className="btn btn-outline btn-compact" onClick={close}>
            Fechar
          </button>
        </div>
      </div>
    </section>
  )
}
