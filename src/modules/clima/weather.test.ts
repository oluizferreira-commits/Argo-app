import { describe, expect, it } from 'vitest'
import { ageLabel, coarse, describeWeather, isFresh, parseWeather, weatherUrl } from './weather'

describe('clima', () => {
  it('lê a resposta do Open-Meteo', () => {
    const w = parseWeather({
      current: { temperature_2m: 31.4, apparent_temperature: 34.1, relative_humidity_2m: 48, weather_code: 2, is_day: 1, wind_speed_10m: 9.7, precipitation: 0 },
      daily: { temperature_2m_max: [34.2], temperature_2m_min: [22.8], precipitation_probability_max: [35] },
    })
    expect(w).toEqual({ tempC: 31.4, apparentC: 34.1, code: 2, isDay: true, humidity: 48, windKmh: 9.7, precipMm: 0, maxC: 34.2, minC: 22.8, rainChance: 35 })
  })

  it('sem temperatura é erro (não inventa)', () => {
    expect(() => parseWeather({ current: {} })).toThrow()
    expect(parseWeather({ current: { temperature_2m: 20 } }).maxC).toBeNull()
  })

  it('descrição em português', () => {
    expect(describeWeather(0, true)).toEqual({ label: 'Céu limpo', icon: 'sun' })
    expect(describeWeather(0, false).icon).toBe('moon')
    expect(describeWeather(63).label).toBe('Chuva')
    expect(describeWeather(81).label).toBe('Pancadas de chuva')
    expect(describeWeather(95).icon).toBe('storm')
  })

  it('a localização enviada é aproximada (~1 km)', () => {
    expect(coarse({ lat: -10.123456, lng: -48.987654 })).toEqual({ lat: -10.12, lng: -48.99 })
    const url = weatherUrl({ lat: -10.123456, lng: -48.987654 })
    expect(url).toContain('latitude=-10.12&longitude=-48.99')
    expect(url).not.toContain('123456')
  })

  it('leitura vale 30 min; idade em texto', () => {
    const now = Date.parse('2026-11-23T15:00:00Z')
    const r = { weather: parseWeather({ current: { temperature_2m: 20 } }), place: '', at: now - 10 * 60000 }
    expect(isFresh(r, now)).toBe(true)
    expect(isFresh({ ...r, at: now - 31 * 60000 }, now)).toBe(false)
    expect(isFresh(null, now)).toBe(false)
    expect(ageLabel(now - 30000, now)).toBe('agora')
    expect(ageLabel(now - 25 * 60000, now)).toBe('há 25 min')
    expect(ageLabel(now - 3 * 3600000, now)).toBe('há 3 h')
  })
})
