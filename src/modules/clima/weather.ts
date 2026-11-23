/**
 * Clima (temperatura e condição do tempo) da região da fazenda e do lugar onde a pessoa está.
 *
 * - Fonte: Open-Meteo (gratuito, sem cadastro, dados de modelos meteorológicos).
 * - Privacidade: a coordenada enviada é arredondada para 2 casas (~1 km) — suficiente para o clima,
 *   sem mandar o ponto exato da porteira nem da pessoa.
 * - Offline: a última leitura fica guardada no aparelho e aparece com a hora em que foi obtida.
 */
import type { GeoPoint } from '../../db/types'

export interface Weather {
  tempC: number
  apparentC: number | null
  code: number
  isDay: boolean
  humidity: number | null
  windKmh: number | null
  precipMm: number | null
  maxC: number | null
  minC: number | null
  rainChance: number | null
}

export interface WeatherReading {
  weather: Weather
  /** nome do lugar (ex.: "Araguaína"), quando conhecido */
  place: string
  /** quando foi obtido (ms) */
  at: number
}

export type WeatherIcon = 'sun' | 'moon' | 'cloudSun' | 'cloud' | 'fog' | 'rain' | 'storm'

/** Códigos WMO usados pelo Open-Meteo → descrição em português e ícone. */
export function describeWeather(code: number, isDay = true): { label: string; icon: WeatherIcon } {
  if (code === 0) return { label: isDay ? 'Céu limpo' : 'Céu limpo', icon: isDay ? 'sun' : 'moon' }
  if (code === 1) return { label: 'Poucas nuvens', icon: isDay ? 'cloudSun' : 'moon' }
  if (code === 2) return { label: 'Parcialmente nublado', icon: 'cloudSun' }
  if (code === 3) return { label: 'Nublado', icon: 'cloud' }
  if (code === 45 || code === 48) return { label: 'Neblina', icon: 'fog' }
  if (code >= 51 && code <= 57) return { label: 'Garoa', icon: 'rain' }
  if (code >= 61 && code <= 67) return { label: code >= 65 ? 'Chuva forte' : 'Chuva', icon: 'rain' }
  if (code >= 71 && code <= 77) return { label: 'Neve', icon: 'cloud' }
  if (code >= 80 && code <= 82) return { label: code === 82 ? 'Pancadas fortes de chuva' : 'Pancadas de chuva', icon: 'rain' }
  if (code >= 95) return { label: 'Tempestade', icon: 'storm' }
  return { label: 'Tempo variável', icon: 'cloud' }
}

/** Arredonda a coordenada (~1 km): o suficiente para o clima, sem expor o ponto exato. */
export function coarse(p: GeoPoint): GeoPoint {
  return { lat: Math.round(p.lat * 100) / 100, lng: Math.round(p.lng * 100) / 100 }
}

export function weatherUrl(p: GeoPoint): string {
  const c = coarse(p)
  return (
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${c.lat}&longitude=${c.lng}` +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m,precipitation' +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&timezone=auto&forecast_days=1'
  )
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Converte a resposta do Open-Meteo. Lança erro se faltar a temperatura atual. */
export function parseWeather(json: unknown): Weather {
  const j = json as { current?: Record<string, unknown>; daily?: Record<string, unknown[]> }
  const c = j.current ?? {}
  const temp = num(c.temperature_2m)
  if (temp === null) throw new Error('Resposta de clima sem temperatura.')
  const first = (k: string) => num(j.daily?.[k]?.[0])
  return {
    tempC: temp,
    apparentC: num(c.apparent_temperature),
    code: num(c.weather_code) ?? -1,
    isDay: c.is_day !== 0,
    humidity: num(c.relative_humidity_2m),
    windKmh: num(c.wind_speed_10m),
    precipMm: num(c.precipitation),
    maxC: first('temperature_2m_max'),
    minC: first('temperature_2m_min'),
    rainChance: first('precipitation_probability_max'),
  }
}

export async function fetchWeather(p: GeoPoint, signal?: AbortSignal): Promise<Weather> {
  const res = await fetch(weatherUrl(p), { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return parseWeather(await res.json())
}

/** Nome da cidade de uma coordenada (OpenStreetMap). Devolve '' se não conseguir. */
export async function placeName(p: GeoPoint, signal?: AbortSignal): Promise<string> {
  const c = coarse(p)
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lat=${c.lat}&lon=${c.lng}&limit=1`, { signal })
    if (res.ok) {
      const j = (await res.json()) as { features?: { properties?: { city?: string; town?: string; village?: string; county?: string; name?: string; state?: string } }[] }
      const pr = j.features?.[0]?.properties
      const name = pr?.city ?? pr?.town ?? pr?.village ?? pr?.county ?? ''
      if (name) return name
    }
  } catch {
    /* tenta o próximo serviço */
  }
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=pt-BR&lat=${c.lat}&lon=${c.lng}`, { signal })
    if (res.ok) {
      const j = (await res.json()) as { address?: { city?: string; town?: string; village?: string; municipality?: string } }
      const a = j.address
      return a?.city ?? a?.town ?? a?.municipality ?? a?.village ?? ''
    }
  } catch {
    /* sem nome: mostra só "Onde estou" */
  }
  return ''
}

// ------------------------------------------------------------------ cache no aparelho

/** Leitura com menos de 30 min não é buscada de novo. */
export const FRESH_MS = 30 * 60 * 1000

export function isFresh(r: WeatherReading | null, now: number): boolean {
  return r !== null && now - r.at < FRESH_MS
}

export function loadReading(key: string): WeatherReading | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const r = JSON.parse(raw) as WeatherReading
    return typeof r?.weather?.tempC === 'number' && typeof r.at === 'number' ? r : null
  } catch {
    return null
  }
}

export function saveReading(key: string, r: WeatherReading): void {
  try {
    localStorage.setItem(key, JSON.stringify(r))
  } catch {
    /* sem espaço/modo privado: só não guarda */
  }
}

/** "agora", "há 25 min", "há 3 h", "ontem às 18:40" */
export function ageLabel(at: number, now: number): string {
  const min = Math.floor((now - at) / 60000)
  if (min < 2) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  const d = new Date(at)
  return `em ${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

export const formatTemp = (c: number) => `${Math.round(c)}°`
