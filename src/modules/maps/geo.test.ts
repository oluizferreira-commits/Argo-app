import { describe, expect, it } from 'vitest'
import {
  areaM2,
  centroid,
  distanceM,
  formatHa,
  fromGeometry,
  interiorPoint,
  m2ToCentiHa,
  parseCoordinates,
  perimeterM,
  pointInRing,
  ringInside,
  ringProblem,
  ringsOverlap,
  selfIntersects,
  toGeometry,
  type Ring,
} from './geo'

// coordenadas de teste em lugar qualquer do cerrado (não é a fazenda de ninguém)
const LAT = -10
const LNG = -48
const D = 0.01 // ~1,1 km

/** retângulo [x0,y0]-[x1,y1] em frações de D a partir do ponto de teste */
const rect = (x0: number, y0: number, x1: number, y1: number): Ring => [
  [LNG + x0 * D, LAT + y0 * D],
  [LNG + x1 * D, LAT + y0 * D],
  [LNG + x1 * D, LAT + y1 * D],
  [LNG + x0 * D, LAT + y1 * D],
]

describe('área e perímetro (estimativa cartográfica)', () => {
  it('quadrado de 0,01° no Equador ≈ 123,6 ha e 4,45 km', () => {
    const sq: Ring = [
      [0, 0],
      [0.01, 0],
      [0.01, 0.01],
      [0, 0.01],
    ]
    const side = (6371008.8 * Math.PI) / 180 / 100 // 1.111,95 m
    expect(areaM2(sq) / (side * side)).toBeCloseTo(1, 3)
    expect(perimeterM(sq) / (4 * side)).toBeCloseTo(1, 3)
    expect(m2ToCentiHa(areaM2(sq))).toBe(12364)
    expect(formatHa(12364)).toBe('123,64 ha')
  })

  it('a 10° de latitude a largura encolhe pelo cosseno', () => {
    const r = rect(0, 0, 1, 1)
    const side = (6371008.8 * Math.PI) / 180 / 100
    expect(areaM2(r) / (side * side * Math.cos((10 * Math.PI) / 180))).toBeCloseTo(1, 2)
  })

  it('área não depende do sentido nem do ponto inicial', () => {
    const r = rect(0, 0, 2, 1)
    expect(areaM2([...r].reverse())).toBeCloseTo(areaM2(r), 3)
    expect(areaM2([...r.slice(2), ...r.slice(0, 2)])).toBeCloseTo(areaM2(r), 3)
  })

  it('distância conhecida: 1° de latitude ≈ 111,2 km', () => {
    expect(distanceM([0, 0], [0, 1]) / 1000).toBeCloseTo(111.195, 2)
  })

  it('formato L (côncavo): área = soma das partes', () => {
    const L: Ring = [
      [LNG, LAT],
      [LNG + 2 * D, LAT],
      [LNG + 2 * D, LAT + D],
      [LNG + D, LAT + D],
      [LNG + D, LAT + 2 * D],
      [LNG, LAT + 2 * D],
    ]
    expect(areaM2(L)).toBeCloseTo(areaM2(rect(0, 0, 2, 1)) + areaM2(rect(0, 1, 1, 2)), -2)
    const ip = interiorPoint(L)!
    expect(pointInRing(ip, L)).toBe(1)
  })
})

describe('GeoJSON', () => {
  it('fecha o anel, padroniza sentido anti-horário e volta igual', () => {
    const r = rect(0, 0, 1, 1).reverse()
    const g = toGeometry(r)
    expect(g.type).toBe('Polygon')
    expect(g.coordinates[0][0]).toEqual(g.coordinates[0][4])
    expect(fromGeometry(g)).toHaveLength(4)
    expect(areaM2(fromGeometry(g))).toBeCloseTo(areaM2(r), 3)
  })
})

describe('validação', () => {
  it('contorno em "8" é recusado; normal passa', () => {
    const eight: Ring = [
      [LNG, LAT],
      [LNG + D, LAT + D],
      [LNG + D, LAT],
      [LNG, LAT + D],
    ]
    expect(selfIntersects(eight)).toBe(true)
    expect(ringProblem(eight)).toBe('cruza')
    expect(ringProblem(rect(0, 0, 1, 1))).toBeNull()
    expect(ringProblem(rect(0, 0, 1, 1).slice(0, 2))).toBe('poucos-pontos')
    expect(
      ringProblem([
        [LNG, LAT],
        [LNG + D, LAT],
        [LNG + 2 * D, LAT],
      ]),
    ).toBe('area-zero')
  })

  it('pastos vizinhos que dividem a cerca NÃO se sobrepõem', () => {
    expect(ringsOverlap(rect(0, 0, 1, 1), rect(1, 0, 2, 1))).toBe(false)
    // vizinho com vértice no meio da cerca comum (T)
    expect(ringsOverlap(rect(0, 0, 1, 2), rect(1, 0, 2, 1))).toBe(false)
  })

  it('sobreposição: cruzamento, um dentro do outro e desenhos iguais', () => {
    expect(ringsOverlap(rect(0, 0, 1, 1), rect(0.5, 0.5, 1.5, 1.5))).toBe(true)
    expect(ringsOverlap(rect(0, 0, 3, 3), rect(1, 1, 2, 2))).toBe(true)
    expect(ringsOverlap(rect(0, 0, 1, 1), rect(0, 0, 1, 1))).toBe(true)
    expect(ringsOverlap(rect(0, 0, 1, 1), rect(3, 3, 4, 4))).toBe(false)
  })

  it('dentro do perímetro (borda pode coincidir)', () => {
    const per = rect(0, 0, 3, 2)
    expect(ringInside(rect(0, 0, 1, 2), per)).toBe(true)
    expect(ringInside(rect(2, 1, 4, 2), per)).toBe(false)
  })

  it('ponto na borda, dentro e fora', () => {
    const r = rect(0, 0, 1, 1)
    expect(pointInRing([LNG + 0.5 * D, LAT + 0.5 * D], r)).toBe(1)
    expect(pointInRing([LNG + 0.5 * D, LAT], r)).toBe(0)
    expect(pointInRing([LNG + 2 * D, LAT], r)).toBe(-1)
    const c = centroid(r)
    expect(c[0]).toBeCloseTo(LNG + 0.5 * D, 6)
    expect(c[1]).toBeCloseTo(LAT + 0.5 * D, 6)
  })
})

describe('coordenadas digitadas', () => {
  it('aceita ponto ou vírgula decimal e devolve [lng, lat]', () => {
    expect(parseCoordinates('-10.5, -48.25')).toEqual([-48.25, -10.5])
    expect(parseCoordinates('-10,5 -48,25')).toEqual([-48.25, -10.5])
    expect(parseCoordinates('abc')).toBeNull()
    expect(parseCoordinates('-100, -48')).toBeNull()
  })
})

describe('encaixe com diferença de centímetros', () => {
  it('pasto encostado no perímetro com 2 cm de diferença continua "dentro" e sem sobreposição com o vizinho', () => {
    const e = 0.0000002 // ~2 cm
    const per = rect(0, 0, 2, 1)
    const a: Ring = [
      [LNG + e, LAT - e],
      [LNG + D + e, LAT + e],
      [LNG + D - e, LAT + D - e],
      [LNG - e, LAT + D + e],
    ]
    const b: Ring = [
      [LNG + D - e, LAT + e],
      [LNG + 2 * D, LAT],
      [LNG + 2 * D, LAT + D],
      [LNG + D + e, LAT + D - e],
    ]
    expect(ringInside(a, per)).toBe(true)
    expect(ringsOverlap(a, b)).toBe(false)
  })
})
