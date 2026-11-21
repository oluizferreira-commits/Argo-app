import { Link } from 'react-router'
import { CATEGORIES } from '../../domain/categories'
import { Icon } from '../../components/Icon'
import { pastureTotal, totalsByCategory } from './herd'
import { sortMovements } from './describe'
import { MovementRow } from './MovementSummary'
import { SpecificationAlerts } from './SpecificationAlerts'
import { useBalances, useMovements, usePastureMap, usePastures } from './useHerd'

export function RebanhoPage() {
  const pastures = usePastures()
  const movements = useMovements()
  const pastureMap = usePastureMap()
  const { balances } = useBalances()
  if (!pastures || !movements) return null

  if (pastures.length === 0) {
    return (
      <div className="card empty">
        <div className="status-icon">
          <Icon name="pasture" size={28} />
        </div>
        <h2 style={{ fontSize: 21 }}>Comece pelos pastos</h2>
        <p className="muted" style={{ marginTop: 8 }}>
          O rebanho é controlado por pasto. Cadastre seus pastos e depois faça a contagem inicial de cada um.
        </p>
        <Link to="/pastos/novo" className="btn btn-gold btn-block" style={{ marginTop: 20 }}>
          <Icon name="plus" /> Cadastrar primeiro pasto
        </Link>
      </div>
    )
  }

  const ids = pastures.map((p) => p.id)
  const byCat = totalsByCategory(balances, ids)
  const total = [...byCat.values()].reduce((a, b) => a + b, 0)
  const recent = sortMovements(movements).slice(0, 5)

  return (
    <>
      <section className="hero">
        <div className="gold-rule" />
        <p style={{ marginTop: 0 }}>Total do rebanho</p>
        <div className="big-number" style={{ marginTop: 6 }} data-testid="herd-total">
          {total.toLocaleString('pt-BR')}
        </div>
        <p>cabeças em {pastures.length} pasto(s)</p>
      </section>

      <SpecificationAlerts />

      <Link to="/rebanho/movimentar" className="btn btn-gold btn-block">
        <Icon name="plus" /> Nova movimentação
      </Link>

      <h2 className="section-title">Por categoria</h2>
      <div className="card">
        <div className="cat-grid">
          {(['M', 'F'] as const).map((sex) => (
            <div key={sex}>
              <div className="group-title">{sex === 'M' ? 'Machos' : 'Fêmeas'}</div>
              {CATEGORIES.filter((c) => c.sex === sex && (!c.unspecified || (byCat.get(c.id) ?? 0) > 0)).map((c) => (
                <div className="cat-line" key={c.id}>
                  <span>{c.label}</span>
                  <span className="num">{(byCat.get(c.id) ?? 0).toLocaleString('pt-BR')}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <h2 className="section-title">Por pasto</h2>
      <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
        {pastures.map((p) => (
          <Link key={p.id} to={`/pastos/${p.id}`} className="list-link">
            <div className="status-body">
              <div className="status-label">{p.name}</div>
            </div>
            <span className="num">{pastureTotal(balances, p.id).toLocaleString('pt-BR')} cab.</span>
            <Icon name="chevronRight" size={20} className="muted" />
          </Link>
        ))}
      </div>

      <h2 className="section-title">Últimas movimentações</h2>
      <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
        {recent.length === 0 ? (
          <p className="muted" style={{ padding: '14px 0' }}>
            Nenhuma movimentação ainda. Comece pela <strong>Contagem</strong> de cada pasto.
          </p>
        ) : (
          recent.map((m) => <MovementRow key={m.id} m={m} pastures={pastureMap} />)
        )}
      </div>
      {movements.length > 0 && (
        <Link to="/rebanho/historico" className="btn btn-outline btn-block">
          <Icon name="list" /> Histórico completo
        </Link>
      )}
    </>
  )
}
