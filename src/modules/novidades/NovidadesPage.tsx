import { useState } from 'react'
import { CHANGELOG, compareVersions } from '../../app/changelog'
import { Icon } from '../../components/Icon'

const fmt = (d: string) => d.split('-').reverse().join('/')

/** Novidades (notas de atualização): o que mudou em cada versão do ARGO. */
export function NovidadesPage() {
  const current = __APP_VERSION__
  const [open, setOpen] = useState<Set<string>>(() => new Set(CHANGELOG.slice(0, 2).map((e) => e.version)))
  const toggle = (v: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(v)) n.delete(v)
      else n.add(v)
      return n
    })
  return (
    <>
      <section className="hero" data-testid="novidades-hero">
        <div className="gold-rule" />
        <h2 className="font-display" style={{ fontSize: 24, color: 'var(--cream)' }}>
          O que há de novo
        </h2>
        <p>
          Você está na versão <b data-testid="app-version">{current}</b>. As atualizações chegam sozinhas: quando aparecer o aviso, toque em <b>Atualizar</b>. Seus dados ficam guardados.
        </p>
      </section>
      <ol className="changelog" data-testid="changelog">
        {CHANGELOG.map((e) => {
          const isOpen = open.has(e.version)
          const installed = compareVersions(e.version, current) === 0
          return (
            <li key={e.version} className={`cl-item${isOpen ? ' is-open' : ''}`}>
              <button type="button" className="cl-head" aria-expanded={isOpen} onClick={() => toggle(e.version)}>
                <span className="cl-dot" aria-hidden="true" />
                <span className="cl-title">
                  <span className="cl-meta">
                    Versão {e.version} · {fmt(e.date)}
                    {installed && <span className="badge badge-gold">instalada</span>}
                  </span>
                  <b>{e.title}</b>
                </span>
                <Icon name="chevronRight" size={20} className="cl-chev" />
              </button>
              {isOpen && (
                <ul className="cl-list">
                  {e.items.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ol>
    </>
  )
}
