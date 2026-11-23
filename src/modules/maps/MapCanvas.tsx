import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'

/** Imagem de satélite (Esri World Imagery) — precisa de internet; nada é baixado para guardar. */
export const SATELLITE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
export const SATELLITE_ATTRIBUTION = 'Imagens © Esri, Maxar, Earthstar Geographics'

export type BaseLayer = 'satelite' | 'ilustrado'

/**
 * Mapa base do ARGO Maps. Satélite (com internet) ou "Desenho" (só os contornos da fazenda, funciona offline).
 * As camadas de pastos/edição são colocadas pelas telas, usando o mapa recebido em `onReady`.
 */
export function MapCanvas({
  base,
  center,
  zoom,
  onReady,
  className,
  testId,
}: {
  base: BaseLayer
  center: [number, number]
  zoom: number
  onReady: (map: L.Map) => void
  className?: string
  testId?: string
}) {
  const el = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<L.Map | null>(null)
  const init = useRef({ center, zoom, onReady })

  useEffect(() => {
    if (!el.current) return
    const m = L.map(el.current, { zoomControl: false, attributionControl: true, maxZoom: 20, zoomSnap: 0.5, tap: true } as L.MapOptions)
    m.attributionControl.setPrefix(false)
    m.setView(init.current.center, init.current.zoom)
    L.control.zoom({ position: 'topright' }).addTo(m)
    setMap(m)
    init.current.onReady(m)
    // o contêiner pode mudar de tamanho (painel de baixo, rotação do iPhone)
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      m.stop()
      // Leaflet termina a animação de zoom num temporizador (250 ms): se a tela fechar no meio,
      // remove o mapa só depois, para o temporizador não encontrar o mapa já desmontado
      if ((m as unknown as { _animatingZoom?: boolean })._animatingZoom) setTimeout(() => m.remove(), 400)
      else m.remove()
    }
  }, [])

  useEffect(() => {
    if (!map || base !== 'satelite') return
    const layer = L.tileLayer(SATELLITE_URL, { maxZoom: 20, maxNativeZoom: 18, attribution: SATELLITE_ATTRIBUTION, crossOrigin: true }).addTo(map)
    return () => {
      layer.remove()
    }
  }, [map, base])

  return <div ref={el} className={`farm-map base-${base}${className ? ` ${className}` : ''}`} data-testid={testId} />
}
