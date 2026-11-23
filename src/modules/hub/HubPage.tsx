import { useState } from 'react'
import { Link } from 'react-router'
import { MODULE_GROUPS, MODULES, type ModuleDef } from '../../app/modules'
import { Icon } from '../../components/Icon'

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

function AppTile({ m }: { m: ModuleDef }) {
  return (
    <Link to={m.path} className={`app-tile g-${m.group ?? 'fazenda'}`} data-testid={`app-${m.id}`} aria-label={`${m.title}: ${m.description}`}>
      <span className="app-icon">
        <Icon name={m.icon} size={30} />
        {m.status === 'planejado' && <span className="app-soon">Em breve</span>}
      </span>
      <span className="app-name">{m.short ?? m.title}</span>
    </Link>
  )
}

/** Tela "Mais": todos os módulos como aplicativos (ícone + nome curto), em pastas coloridas. */
export function HubPage({ ids, intro }: { ids?: string[]; intro: string }) {
  const [q, setQ] = useState('')
  const all = ids ? MODULES.filter((m) => ids.includes(m.id)) : MODULES.filter((m) => m.id !== 'dashboard')
  const query = fold(q.trim())
  const found = query ? all.filter((m) => fold(`${m.title} ${m.short ?? ''} ${m.description}`).includes(query)) : null
  return (
    <>
      <p className="visually-hidden">{intro}</p>
      <div className="search-box">
        <Icon name="search" size={20} className="muted" />
        <input className="search-input" type="search" placeholder="Procurar (ex.: vacina, diesel, venda)" aria-label="Procurar módulo" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {found ? (
        found.length ? (
          <div className="app-grid" data-testid="app-results">
            {found.map((m) => (
              <AppTile key={m.id} m={m} />
            ))}
          </div>
        ) : (
          <p className="muted" style={{ textAlign: 'center' }}>
            Nada encontrado para “{q}”.
          </p>
        )
      ) : (
        MODULE_GROUPS.map((g) => {
          const list = all.filter((m) => (m.group ?? 'fazenda') === g.id)
          if (!list.length) return null
          return (
            <section key={g.id} className={`app-folder g-${g.id}`} data-testid={`folder-${g.id}`}>
              <h2 className="app-folder-title">{g.title}</h2>
              <div className="app-grid">
                {list.map((m) => (
                  <AppTile key={m.id} m={m} />
                ))}
              </div>
            </section>
          )
        })
      )}
    </>
  )
}
