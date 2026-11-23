import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Icon } from '../../components/Icon'
import type { Farm } from '../../db/types'
import { useWeather, type WeatherStatus } from './useWeather'
import { ageLabel, describeWeather, formatTemp, type WeatherReading } from './weather'

function useClock(ms: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

function Pill({ r, label, status, testId, onClick }: { r: WeatherReading | null; label: string; status: WeatherStatus; testId: string; onClick: () => void }) {
  if (!r) {
    return (
      <button type="button" className="wx-pill wx-empty" onClick={onClick} data-testid={testId}>
        <Icon name={label === 'Fazenda' ? 'thermo' : 'pin'} size={16} />
        {status === 'loading' ? 'Buscando clima…' : label === 'Fazenda' ? 'Clima da fazenda' : 'Clima onde estou'}
      </button>
    )
  }
  const d = describeWeather(r.weather.code, r.weather.isDay)
  return (
    <button type="button" className="wx-pill" onClick={onClick} data-testid={testId} aria-label={`${label}: ${formatTemp(r.weather.tempC)}, ${d.label}`}>
      <Icon name={d.icon} size={18} />
      <b>{formatTemp(r.weather.tempC)}</b>
      <span className="wx-place">{label === 'Fazenda' ? 'Fazenda' : r.place || 'Onde estou'}</span>
    </button>
  )
}

function Detail({ title, r, status, now, empty, onRefresh, refreshLabel, testId }: { title: string; r: WeatherReading | null; status: WeatherStatus; now: number; empty: React.ReactNode; onRefresh: () => void; refreshLabel: string; testId: string }) {
  const d = r ? describeWeather(r.weather.code, r.weather.isDay) : null
  const w = r?.weather
  return (
    <section className="wx-card" data-testid={testId}>
      <div className="wx-card-head">
        <span className="ind-label">{title}</span>
        {r && <span className="wx-age">atualizado {ageLabel(r.at, now)}</span>}
      </div>
      {r && d && w ? (
        <>
          <div className="wx-main">
            <span className="wx-icon">
              <Icon name={d.icon} size={34} />
            </span>
            <span className="wx-temp">{formatTemp(w.tempC)}</span>
            <span className="wx-desc">
              <b>{d.label}</b>
              {r.place && <span>{r.place}</span>}
            </span>
          </div>
          <div className="wx-grid">
            {w.maxC !== null && w.minC !== null && (
              <span>
                <Icon name="thermo" size={16} /> Máx. {formatTemp(w.maxC)} · Mín. {formatTemp(w.minC)}
              </span>
            )}
            {w.apparentC !== null && (
              <span>
                <Icon name="thermo" size={16} /> Sensação {formatTemp(w.apparentC)}
              </span>
            )}
            {w.rainChance !== null && (
              <span>
                <Icon name="rain" size={16} /> Chuva hoje {Math.round(w.rainChance)}%
              </span>
            )}
            {w.humidity !== null && (
              <span>
                <Icon name="droplet" size={16} /> Umidade {Math.round(w.humidity)}%
              </span>
            )}
            {w.windKmh !== null && (
              <span>
                <Icon name="wind" size={16} /> Vento {Math.round(w.windKmh)} km/h
              </span>
            )}
          </div>
        </>
      ) : (
        <div className="muted">{empty}</div>
      )}
      {status === 'error' && <div className="wx-error">Não consegui atualizar agora. {r ? 'Mostrando a última leitura.' : 'Verifique a internet.'}</div>}
      {status === 'negado' && <div className="wx-error">A localização foi negada. Para liberar: Ajustes do iPhone › Privacidade › Serviços de Localização.</div>}
      <button type="button" className="btn btn-outline btn-block" onClick={onRefresh} disabled={status === 'loading'}>
        <Icon name="refresh" size={20} /> {status === 'loading' ? 'Buscando…' : refreshLabel}
      </button>
    </section>
  )
}

/** Clima no cartão principal do Painel: fazenda e onde a pessoa está. Toque abre os detalhes. */
export function HeroWeather({ farm }: { farm: Farm }) {
  const w = useWeather(farm)
  const [open, setOpen] = useState(false)
  const now = useClock(60000)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  const hasFarmPlace = Boolean(farm.entrance || farm.city.trim().length >= 3)

  return (
    <>
      <div className="hero-weather" data-testid="hero-weather">
        <Pill r={w.farm} label="Fazenda" status={w.farmStatus} testId="wx-farm" onClick={() => setOpen(true)} />
        <Pill
          r={w.here}
          label="Aqui"
          status={w.hereStatus}
          testId="wx-here"
          onClick={() => {
            if (!w.here && !w.hereOn && w.online) void w.refreshHere()
            setOpen(true)
          }}
        />
      </div>
      {open && (
        <div className="sheet-backdrop" onClick={() => setOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Clima" onClick={(e) => e.stopPropagation()} data-testid="wx-sheet">
            <div className="sheet-grip" aria-hidden="true" />
            <div className="sheet-head">
              <strong>Clima</strong>
              <button className="btn btn-outline btn-icon" aria-label="Fechar" onClick={() => setOpen(false)}>
                <Icon name="chevronLeft" size={20} />
              </button>
            </div>
            <div className="stack">
              {!w.online && (
                <div className="notice notice-warn">
                  <Icon name="cloudOff" />
                  <div>Sem internet: mostrando a última leitura guardada no aparelho.</div>
                </div>
              )}
              <Detail
                title="Região da fazenda"
                r={w.farm}
                status={w.farmStatus}
                now={now}
                testId="wx-farm-detail"
                refreshLabel="Atualizar clima da fazenda"
                onRefresh={() => void w.refreshFarm()}
                empty={
                  hasFarmPlace ? (
                    'Ainda sem leitura. Toque em atualizar com internet.'
                  ) : (
                    <>
                      Para ver o clima da fazenda, marque a entrada em{' '}
                      <Link to="/acesso" className="inline-link">
                        Como chegar
                      </Link>{' '}
                      ou informe a cidade em{' '}
                      <Link to="/fazenda" className="inline-link">
                        Fazenda
                      </Link>
                      .
                    </>
                  )
                }
              />
              <Detail
                title="Onde estou agora"
                r={w.here}
                status={w.hereStatus}
                now={now}
                testId="wx-here-detail"
                refreshLabel={w.here ? 'Atualizar onde estou' : 'Usar minha localização'}
                onRefresh={() => void w.refreshHere()}
                empty="Toque abaixo: o iPhone vai pedir permissão para usar a localização. Ela serve só para buscar o clima da cidade onde você está."
              />
              <p className="muted" style={{ fontSize: 13 }}>
                Previsão: Open-Meteo. Para proteger a privacidade, a localização enviada é aproximada (cerca de 1 km).
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
