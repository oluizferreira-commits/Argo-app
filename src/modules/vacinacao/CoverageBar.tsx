import type { Coverage } from './vaccination'

/** Barra de cobertura: vacinados x previstos, com os pendentes à parte (nunca contados como vacinados). */
export function CoverageBar({ cov, compact }: { cov: Coverage; compact?: boolean }) {
  return (
    <span className={`coverage${compact ? ' coverage-compact' : ''}`} data-testid="coverage">
      <span className="coverage-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={cov.percent} aria-label={`Cobertura ${cov.percent}%`}>
        <span className={`coverage-fill${cov.pending === 0 ? ' done' : ''}`} style={{ width: `${Math.min(100, cov.percent)}%` }} />
      </span>
      <span className="coverage-text">
        <strong>{cov.vaccinated.toLocaleString('pt-BR')}</strong> de {cov.planned.toLocaleString('pt-BR')} vacinados ·{' '}
        <span className={cov.pending ? 'coverage-pending' : ''}>{cov.pending.toLocaleString('pt-BR')} pendentes</span> · <strong>{cov.percent}%</strong>
      </span>
    </span>
  )
}
