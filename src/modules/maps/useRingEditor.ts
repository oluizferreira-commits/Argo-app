import L from 'leaflet'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { areaM2, closestOnSegment, m2ToCentiHa, perimeterM, ringProblem, type LngLat, type Ring } from './geo'

/** Distâncias de encaixe na tela (px): ponto de outro contorno e linha de outro contorno. */
const SNAP_VERTEX_PX = 18
const SNAP_EDGE_PX = 12

/**
 * Encaixa o ponto tocado num canto ou numa cerca já desenhada (perímetro e pastos vizinhos),
 * para que pastos vizinhos dividam exatamente a mesma cerca.
 */
export function snap(map: L.Map, ll: L.LatLng, targets: readonly Ring[]): LngLat {
  const p = map.latLngToContainerPoint(ll)
  let best: { d: number; pt: L.Point } | null = null
  for (const r of targets)
    for (const v of r) {
      const q = map.latLngToContainerPoint([v[1], v[0]])
      const d = q.distanceTo(p)
      if (d <= SNAP_VERTEX_PX && (!best || d < best.d)) best = { d, pt: q }
    }
  if (!best) {
    for (const r of targets)
      for (let i = 0; i < r.length; i++) {
        const a = map.latLngToContainerPoint([r[i][1], r[i][0]])
        const b = map.latLngToContainerPoint([r[(i + 1) % r.length][1], r[(i + 1) % r.length][0]])
        const [c] = closestOnSegment([p.x, p.y], [a.x, a.y], [b.x, b.y])
        const q = L.point(c[0], c[1])
        const d = q.distanceTo(p)
        if (d <= SNAP_EDGE_PX && (!best || d < best.d)) best = { d, pt: q }
      }
  }
  const out = best ? map.containerPointToLatLng(best.pt) : ll
  // quando encaixa num canto, usa a coordenada exata (cerca comum idêntica)
  if (best)
    for (const r of targets)
      for (const v of r) if (map.latLngToContainerPoint([v[1], v[0]]).distanceTo(best.pt) < 0.5) return [v[0], v[1]]
  return [out.lng, out.lat]
}

const vertexIcon = (selected: boolean, first: boolean) =>
  L.divIcon({ className: `rv${selected ? ' is-sel' : ''}${first ? ' is-first' : ''}`, html: '<i></i>', iconSize: [30, 30], iconAnchor: [15, 15] })
const midIcon = L.divIcon({ className: 'rv-mid', html: '<i>+</i>', iconSize: [24, 24], iconAnchor: [12, 12] })

/**
 * Edição de um contorno no mapa: toque adiciona ponto; arrastar move; "+" no meio de um lado insere ponto;
 * toque num ponto seleciona (para remover). Desfazer/refazer. O polígono fecha sozinho.
 */
export function useRingEditor(map: L.Map | null, opts: { active: boolean; initial: Ring; targets: readonly Ring[]; color: string }) {
  const [ring, setRing] = useState<Ring>(opts.initial)
  const [past, setPast] = useState<Ring[]>([])
  const [future, setFuture] = useState<Ring[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const targetsRef = useRef(opts.targets)
  useEffect(() => {
    targetsRef.current = opts.targets
  })

  const commit = useCallback((next: Ring) => {
    setRing((cur) => {
      setPast((p) => [...p.slice(-60), cur])
      return next
    })
    setFuture([])
  }, [])

  // toque no mapa = novo ponto
  useEffect(() => {
    if (!map || !opts.active) return
    const onClick = (e: L.LeafletMouseEvent) => {
      const pt = snap(map, e.latlng, targetsRef.current)
      setSelected(null)
      setRing((cur) => {
        setPast((p) => [...p.slice(-60), cur])
        setFuture([])
        return [...cur, pt]
      })
    }
    map.on('click', onClick)
    map.getContainer().classList.add('is-drawing')
    return () => {
      map.off('click', onClick)
      map.getContainer().classList.remove('is-drawing')
    }
  }, [map, opts.active])

  // desenho do contorno, pontos e "+"
  useEffect(() => {
    if (!map || !opts.active) return
    const g = L.layerGroup().addTo(map)
    const latlngs = ring.map(([x, y]) => L.latLng(y, x))
    const shape = ring.length >= 3 ? L.polygon(latlngs, { color: opts.color, weight: 3, fillOpacity: 0.22, interactive: false }) : L.polyline(latlngs, { color: opts.color, weight: 3, dashArray: '6 6', interactive: false })
    shape.addTo(g)
    if (ring.length >= 3) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]
        const b = ring[(i + 1) % ring.length]
        const mid = L.marker([(a[1] + b[1]) / 2, (a[0] + b[0]) / 2], { icon: midIcon, keyboard: false, zIndexOffset: -10 })
        mid.on('click', () => {
          const next = [...ring.slice(0, i + 1), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as LngLat, ...ring.slice(i + 1)]
          commit(next)
          setSelected(i + 1)
        })
        mid.addTo(g)
      }
    }
    ring.forEach((v, i) => {
      const m = L.marker([v[1], v[0]], { icon: vertexIcon(selected === i, i === 0), draggable: true, keyboard: false, zIndexOffset: 100, title: `Ponto ${i + 1}` })
      m.on('click', () => setSelected((s) => (s === i ? null : i)))
      m.on('drag', (e) => {
        const ll = (e.target as L.Marker).getLatLng()
        const copy = [...latlngs]
        copy[i] = ll
        ;(shape as L.Polyline).setLatLngs(copy)
      })
      m.on('dragend', (e) => {
        const pt = snap(map, (e.target as L.Marker).getLatLng(), targetsRef.current)
        const next = [...ring]
        next[i] = pt
        commit(next)
        setSelected(i)
      })
      m.addTo(g)
    })
    return () => {
      g.remove()
    }
  }, [map, opts.active, ring, selected, opts.color, commit])

  const undo = () => {
    if (!past.length) return
    setFuture((f) => [ring, ...f])
    setRing(past[past.length - 1])
    setPast((p) => p.slice(0, -1))
    setSelected(null)
  }
  const redo = () => {
    if (!future.length) return
    setPast((p) => [...p, ring])
    setRing(future[0])
    setFuture((f) => f.slice(1))
    setSelected(null)
  }
  const removeSelected = () => {
    if (selected === null) return
    commit(ring.filter((_, i) => i !== selected))
    setSelected(null)
  }
  const clear = () => {
    if (ring.length) commit([])
    setSelected(null)
  }
  const reset = useCallback((r: Ring) => {
    setRing(r)
    setPast([])
    setFuture([])
    setSelected(null)
  }, [])

  const stats = useMemo(() => ({ centiHa: ring.length >= 3 ? m2ToCentiHa(areaM2(ring)) : 0, perimeterM: ring.length >= 2 ? perimeterM(ring) : 0, problem: ringProblem(ring) }), [ring])

  return { ring, selected, canUndo: past.length > 0, canRedo: future.length > 0, undo, redo, removeSelected, clear, reset, ...stats }
}
