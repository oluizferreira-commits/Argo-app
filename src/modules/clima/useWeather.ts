import { useCallback, useEffect, useRef, useState } from 'react'
import type { Farm, GeoPoint } from '../../db/types'
import { useOnline } from '../../hooks/useOnline'
import { searchPlaces } from '../acesso/geocode'
import { fetchWeather, isFresh, loadReading, placeName, saveReading, type WeatherReading } from './weather'

export type WeatherStatus = 'idle' | 'loading' | 'error' | 'sem-local' | 'negado'

const HERE_KEY = 'argo.clima.aqui'
const HERE_ON_KEY = 'argo.clima.aqui.ativo'

function flag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function setFlag(key: string, on: boolean) {
  try {
    if (on) localStorage.setItem(key, '1')
    else localStorage.removeItem(key)
  } catch {
    /* ignora */
  }
}

/** Ponto da região da fazenda: a entrada cadastrada em "Como chegar" ou, sem ela, a cidade da fazenda. */
async function farmPoint(farm: Farm): Promise<{ point: GeoPoint; place: string } | null> {
  const city = farm.city.trim()
  if (farm.entrance) return { point: farm.entrance, place: city }
  if (city.length < 3) return null
  const key = `argo.clima.cidade.${city.toLowerCase()}`
  try {
    const cached = localStorage.getItem(key)
    if (cached) return { point: JSON.parse(cached) as GeoPoint, place: city }
  } catch {
    /* busca de novo */
  }
  const found = (await searchPlaces(city))[0]
  if (!found) return null
  const point = { lat: found.lat, lng: found.lng }
  try {
    localStorage.setItem(key, JSON.stringify(point))
  } catch {
    /* ignora */
  }
  return { point, place: found.name }
}

function currentPosition(): Promise<GeoPoint> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('sem-gps'))
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(new Error(e.code === e.PERMISSION_DENIED ? 'negado' : 'gps')),
      { enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: 20000 },
    )
  })
}

async function geoPermission(): Promise<PermissionState | 'desconhecido'> {
  try {
    const r = await navigator.permissions.query({ name: 'geolocation' as PermissionName })
    return r.state
  } catch {
    return 'desconhecido'
  }
}

/**
 * Clima da fazenda (automático, quando há local da fazenda) e de onde a pessoa está
 * (só depois que ela tocar em "Clima onde estou" — o iPhone pede a permissão de localização).
 */
export function useWeather(farm: Farm) {
  const online = useOnline()
  const farmKey = `argo.clima.fazenda.${farm.id}`
  const [farmR, setFarmR] = useState<WeatherReading | null>(() => loadReading(farmKey))
  const [hereR, setHereR] = useState<WeatherReading | null>(() => loadReading(HERE_KEY))
  const [farmStatus, setFarmStatus] = useState<WeatherStatus>('idle')
  const [hereStatus, setHereStatus] = useState<WeatherStatus>('idle')
  const [hereOn, setHereOn] = useState(() => flag(HERE_ON_KEY))
  const busy = useRef({ farm: false, here: false })

  const refreshFarm = useCallback(async () => {
    if (busy.current.farm) return
    busy.current.farm = true
    setFarmStatus('loading')
    try {
      const loc = await farmPoint(farm)
      if (!loc) {
        setFarmStatus('sem-local')
        return
      }
      const weather = await fetchWeather(loc.point)
      const place = loc.place || (await placeName(loc.point))
      const r = { weather, place, at: Date.now() }
      saveReading(farmKey, r)
      setFarmR(r)
      setFarmStatus('idle')
    } catch {
      setFarmStatus('error')
    } finally {
      busy.current.farm = false
    }
  }, [farm, farmKey])

  const refreshHere = useCallback(async () => {
    if (busy.current.here) return
    busy.current.here = true
    setHereStatus('loading')
    try {
      const point = await currentPosition()
      setFlag(HERE_ON_KEY, true)
      setHereOn(true)
      const [weather, place] = await Promise.all([fetchWeather(point), placeName(point)])
      const r = { weather, place, at: Date.now() }
      saveReading(HERE_KEY, r)
      setHereR(r)
      setHereStatus('idle')
    } catch (e) {
      const denied = e instanceof Error && e.message === 'negado'
      if (denied) {
        setFlag(HERE_ON_KEY, false)
        setHereOn(false)
      }
      setHereStatus(denied ? 'negado' : 'error')
    } finally {
      busy.current.here = false
    }
  }, [])

  // ao abrir o Painel (e ao voltar a internet): atualiza o que estiver com mais de 30 min
  useEffect(() => {
    if (!online) return
    // fora do ciclo de renderização: a busca é um sistema externo (rede/GPS)
    const t = setTimeout(() => {
      const now = Date.now()
      if (!isFresh(loadReading(farmKey), now)) void refreshFarm()
      if (flag(HERE_ON_KEY) && !isFresh(loadReading(HERE_KEY), now)) {
        // só busca sozinho se a permissão já foi dada (não abre o pedido do iPhone sem a pessoa tocar)
        void geoPermission().then((st) => {
          if (st === 'granted') void refreshHere()
        })
      }
    }, 0)
    return () => clearTimeout(t)
  }, [online, farmKey, refreshFarm, refreshHere])

  return { online, farm: farmR, here: hereR, farmStatus, hereStatus, hereOn, refreshFarm, refreshHere }
}
