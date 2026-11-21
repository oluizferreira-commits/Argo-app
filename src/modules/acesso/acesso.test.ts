import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/ids'
import { createDatabase, type ArgoDatabase } from '../../db/database'
import { createFarm } from '../fazendas/farms'
import { addLandmark, addOrigin, buildSharePayload, cacheIsValid, decodeShare, encodeShare, setEntrance } from './access'
import { formatDuration, formatKm, haversine, navigationLinks, parseCoordinate, projectOnRoute } from './geo'
import { buildGuide, stepText } from './instructions'
import { parseOsrm, reachesGate, RoutingError } from './routing'

// Coordenadas SINTÉTICAS (não são de nenhuma fazenda real).
const GATE = { lat: -10.5, lng: -48.3 }
const CITY = { lat: -10.6, lng: -48.4 }

let db: ArgoDatabase
afterEach(async () => db?.delete())

describe('coordenadas', () => {
  it('lê os formatos mais comuns e recusa fora do Brasil', () => {
    expect(parseCoordinate('-10.500000, -48.300000')).toEqual(GATE)
    expect(parseCoordinate('-10,5 -48,3')).toEqual(GATE)
    expect(parseCoordinate('-10.5;-48.3')).toEqual(GATE)
    expect(() => parseCoordinate('-48.3, -10.5')).toThrow(/fora do Brasil/)
    expect(() => parseCoordinate('abc')).toThrow()
  })

  it('distância e formatação', () => {
    // 1 grau de latitude ≈ 111,2 km
    expect(haversine({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeGreaterThan(111000)
    expect(haversine({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeLessThan(111400)
    expect(formatKm(850)).toBe('850 m')
    expect(formatKm(44500)).toBe('45 km')
    expect(formatDuration(5460)).toBe('1 h 31 min')
  })

  it('projeta um ponto na rota (km percorrido e afastamento)', () => {
    const route: [number, number][] = [
      [0, 0],
      [0, 0.01],
      [0, 0.02],
    ]
    const p = projectOnRoute(route, { lat: 0.001, lng: 0.015 })
    expect(Math.round(p.along)).toBeGreaterThan(1600)
    expect(Math.round(p.along)).toBeLessThan(1700)
    expect(Math.round(p.offset)).toBeGreaterThan(100)
    expect(Math.round(p.offset)).toBeLessThan(120)
  })

  it('links de navegação usam só o destino (o app calcula da localização do visitante)', () => {
    const l = navigationLinks(GATE)
    expect(l.google).toContain('destination=-10.5,-48.3')
    expect(l.google).not.toContain('origin=')
    expect(l.waze).toContain('ll=-10.5,-48.3')
    expect(l.apple).toContain('daddr=-10.5,-48.3')
  })
})

describe('roteamento', () => {
  const osrm = {
    code: 'Ok',
    routes: [
      {
        distance: 15000,
        duration: 1800,
        geometry: { coordinates: [[-48.4, -10.6], [-48.35, -10.55], [-48.3, -10.5]] as [number, number][] },
        legs: [
          {
            steps: [
              { distance: 500, name: 'Avenida A', maneuver: { type: 'depart', location: [-48.4, -10.6] as [number, number] } },
              { distance: 9000, name: 'Estrada B', ref: 'PA-000', maneuver: { type: 'turn', modifier: 'right', location: [-48.39, -10.59] as [number, number] } },
              { distance: 5500, name: 'Estrada B', maneuver: { type: 'new name', modifier: 'straight', location: [-48.35, -10.55] as [number, number] } },
              { distance: 0, name: '', maneuver: { type: 'arrive', location: [-48.3, -10.5] as [number, number] } },
            ],
          },
        ],
      },
    ],
    waypoints: [
      { distance: 12, location: [-48.4, -10.6] as [number, number] },
      { distance: 13, location: [-48.3, -10.5] as [number, number] },
    ],
  }

  it('converte a resposta e valida a chegada à porteira', () => {
    const r = parseOsrm(osrm, CITY, GATE)
    expect(r.coords[0]).toEqual([-10.6, -48.4])
    expect(r.distance).toBe(15000)
    expect(r.snapEnd).toBe(13)
    expect(reachesGate(r)).toBe(true)
    expect(reachesGate({ snapEnd: 2000 })).toBe(false)
    expect(r.dest).toEqual(GATE) // coordenada oficial nunca é substituída
  })

  it('erro claro quando não há rota', () => {
    expect(() => parseOsrm({ code: 'NoRoute' }, CITY, GATE)).toThrow(RoutingError)
  })

  it('instruções em português e junção de trechos da mesma via', () => {
    const r = parseOsrm(osrm, CITY, GATE)
    const g = buildGuide(r.steps, 'Cidade X')
    expect(g.map((x) => x.text)).toEqual([
      'Saia de Cidade X pela Avenida A',
      'Vire à direita na Estrada B (PA-000)',
      'Continue na Estrada B',
      'Chegada à entrada principal da fazenda',
    ])
    expect(stepText({ type: 'fork', modifier: 'slight left', name: 'Vicinal', ref: '', distance: 1, lat: 0, lng: 0 }, '')).toBe(
      'Na bifurcação, mantenha-se à esquerda na Vicinal',
    )
    expect(stepText({ type: 'roundabout', modifier: '', name: '', ref: '', distance: 1, lat: 0, lng: 0, exit: 2 }, '')).toBe('Na rotatória, pegue a 2ª saída')
  })
})

describe('dados de acesso da fazenda', () => {
  it('entrada, cidades, pontos e link público', async () => {
    db = createDatabase(`test-${newId()}`)
    let farm = await createFarm(db, { name: 'Fazenda Teste', responsible: '', city: '' }, '')
    farm = await setEntrance(db, farm.id, GATE)
    expect(farm.entrance).toEqual(GATE)
    farm = await addOrigin(db, farm, { name: 'Cidade X', region: 'Estado', lat: CITY.lat, lng: CITY.lng, osm: 'R1' })
    await expect(addOrigin(db, farm, { name: 'Cidade X', region: 'Estado', lat: 0, lng: 0, osm: 'R1' })).rejects.toThrow(/já está/)
    const lm = await addLandmark(db, farm, { name: 'Ponte', kind: 'atencao', note: 'Devagar', lat: -10.55, lng: -48.35 })
    await expect(addLandmark(db, farm, { name: 'Longe', kind: 'referencia', note: '', lat: -20, lng: -48 })).rejects.toThrow(/150 km/)
    const hist = await db.auditLog.where('[entity+entityId]').equals(['landmarks', lm.id]).count()
    expect(hist).toBe(1)

    const payload = buildSharePayload(farm, [lm])
    const decoded = decodeShare(encodeShare(payload))
    expect(decoded).toEqual(payload)
    expect(decoded?.entrance).toEqual(GATE)
    expect(decodeShare('lixo')).toBeNull()
    expect(decodeShare(encodeShare({ ...payload, entrance: { lat: 999, lng: 0 } }))).toBeNull()
  })

  it('cópia da rota fica inválida se a porteira ou a cidade mudar', () => {
    const r = { origin: CITY, dest: GATE } as never
    expect(cacheIsValid(r, CITY, GATE)).toBe(true)
    expect(cacheIsValid(r, CITY, { lat: -10.51, lng: -48.3 })).toBe(false)
    expect(cacheIsValid(undefined, CITY, GATE)).toBe(false)
  })
})
