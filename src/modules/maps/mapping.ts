/**
 * ARGO Maps — gravação do desenho da fazenda (sempre pelo Repository: histórico, exclusão lógica e fila
 * de sincronização). A contagem de animais NÃO é guardada aqui: vem sempre do módulo Rebanho.
 */
import type { ArgoDatabase } from '../../db/database'
import { ConflictError, Repository } from '../../db/repository'
import type { FarmMap, GeoPoint, MapShape, MapVersion, Pasture } from '../../db/types'
import { nowIso } from '../../core/ids'
import { updatePasture } from '../pastos/pastures'
import { areaM2, formatHa, fromGeometry, m2ToCentiHa, perimeterM, ringInside, ringProblem, ringsOverlap, RING_PROBLEM_TEXT, toGeometry, type Ring } from './geo'

export class MapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MapError'
  }
}

const alive = <T extends { deletedAt: string | null }>(x: T) => x.deletedAt === null

export async function loadMapData(db: ArgoDatabase, farmId: string) {
  const [shapes, maps, versions] = await Promise.all([
    db.mapShapes.where('farmId').equals(farmId).toArray(),
    db.farmMaps.where('farmId').equals(farmId).toArray(),
    db.mapVersions.where('farmId').equals(farmId).toArray(),
  ])
  return {
    shapes: shapes.filter(alive),
    farmMap: maps.find(alive) ?? null,
    versions: versions.filter(alive).sort((a, b) => b.version - a.version),
  }
}

async function farmMapOf(db: ArgoDatabase, farmId: string): Promise<FarmMap> {
  const existing = (await db.farmMaps.where('farmId').equals(farmId).toArray()).find(alive)
  if (existing) return existing
  return new Repository(db, 'farmMaps').create({ farmId, status: 'rascunho', version: 0, confirmedAt: null, center: null, zoom: null })
}

/** Qualquer alteração no desenho volta o mapeamento para "rascunho" até nova confirmação. */
async function markDraft(db: ArgoDatabase, farmId: string) {
  const fm = await farmMapOf(db, farmId)
  if (fm.status !== 'rascunho') await new Repository(db, 'farmMaps').update(fm.id, { status: 'rascunho' })
}

const TABLES = (db: ArgoDatabase) => [db.mapShapes, db.farmMaps, db.pastures, db.auditLog, db.outbox, db.meta]

/** Enquadramento escolhido na etapa "Localização". */
export async function saveView(db: ArgoDatabase, farmId: string, center: GeoPoint, zoom: number): Promise<FarmMap> {
  return db.transaction('rw', TABLES(db), async () => {
    const fm = await farmMapOf(db, farmId)
    return new Repository(db, 'farmMaps').update(fm.id, { center: { lat: center.lat, lng: center.lng }, zoom: Math.round(zoom) })
  })
}

export interface ShapeInput {
  /** existente (edição) ou ausente (novo) */
  id?: string
  kind: MapShape['kind']
  pastureId: string | null
  name: string
  ring: Ring
  /** revisão que a tela tinha ao começar a editar (evita sobrescrever edição feita em outro lugar) */
  expectedRev?: number
}

/**
 * Salva um contorno. Recusa: contorno inválido, dois perímetros, pasto já desenhado, sobreposição entre
 * pastos/áreas. Dividir a mesma cerca (borda comum) é permitido.
 */
export async function saveShape(db: ArgoDatabase, farmId: string, input: ShapeInput, key?: string): Promise<MapShape> {
  const problem = ringProblem(input.ring)
  if (problem) throw new MapError(RING_PROBLEM_TEXT[problem])
  const name = input.name.trim()
  if (input.kind === 'nao-produtiva' && !name) throw new MapError('Dê um nome para a área (ex.: Reserva legal, Sede, Represa).')
  if (input.kind === 'pasto' && !input.pastureId) throw new MapError('Escolha o pasto do cadastro (ou crie um novo).')

  return db.transaction('rw', TABLES(db), async () => {
    if (key && !input.id) {
      const ex = await db.mapShapes.get(key)
      if (ex) return ex
    }
    const shapes = (await db.mapShapes.where('farmId').equals(farmId).toArray()).filter(alive).filter((s) => s.id !== input.id)
    if (input.kind === 'perimetro' && shapes.some((s) => s.kind === 'perimetro')) throw new MapError('A fazenda já tem perímetro. Edite o que existe.')
    if (input.kind === 'pasto') {
      const p = await db.pastures.get(input.pastureId!)
      if (!p || p.farmId !== farmId || p.deletedAt !== null) throw new MapError('Pasto não encontrado no cadastro.')
      if (shapes.some((s) => s.kind === 'pasto' && s.pastureId === input.pastureId)) throw new MapError(`"${p.name}" já está desenhado no mapa.`)
    }
    if (input.kind !== 'perimetro') {
      const clash = shapes.find((s) => s.kind !== 'perimetro' && ringsOverlap(input.ring, fromGeometry(s.geometry)))
      if (clash) {
        const other = clash.kind === 'pasto' ? ((await db.pastures.get(clash.pastureId ?? ''))?.name ?? 'outro pasto') : clash.name
        throw new MapError(`Este contorno está por cima de "${other}". Os pastos podem dividir a cerca, mas não a área.`)
      }
    }
    const data = {
      farmId,
      kind: input.kind,
      pastureId: input.kind === 'pasto' ? input.pastureId : null,
      name: input.kind === 'nao-produtiva' ? name : '',
      geometry: toGeometry(input.ring),
      areaCentiHa: m2ToCentiHa(areaM2(input.ring)),
      perimeterM: Math.round(perimeterM(input.ring)),
    }
    const repo = new Repository(db, 'mapShapes')
    let saved: MapShape
    if (input.id) {
      const before = await db.mapShapes.get(input.id)
      if (!before || before.farmId !== farmId || before.deletedAt !== null) throw new MapError('Desenho não encontrado.')
      try {
        saved = await repo.update(input.id, { ...data, geometryVersion: before.geometryVersion + 1 }, input.expectedRev)
      } catch (e) {
        if (e instanceof ConflictError)
          throw new MapError('Este desenho foi alterado em outra tela enquanto você editava. Abra de novo para ver a versão atual.')
        throw e
      }
    } else {
      saved = await repo.create({ ...data, geometryVersion: 1 }, key)
    }
    await markDraft(db, farmId)
    return saved
  })
}

/** Apaga (exclusão lógica) um contorno. O pasto do cadastro e seus animais não são afetados. */
export async function removeShape(db: ArgoDatabase, id: string): Promise<void> {
  await db.transaction('rw', TABLES(db), async () => {
    const s = await db.mapShapes.get(id)
    if (!s || s.deletedAt !== null) return
    await new Repository(db, 'mapShapes').softDelete(id)
    await markDraft(db, s.farmId)
  })
}

// ------------------------------------------------------------------ revisão

export interface MappingReview {
  perimeter: MapShape | null
  pastures: { shape: MapShape; pasture: Pasture | null }[]
  otherAreas: MapShape[]
  /** soma de pastos + áreas não produtivas */
  mappedCentiHa: number
  /** dentro do perímetro e fora de qualquer pasto/área (estimado por diferença) */
  unassignedCentiHa: number | null
  /** pastos do cadastro que ainda não foram desenhados */
  notDrawn: Pasture[]
  warnings: string[]
  /** pode confirmar? (precisa ao menos do perímetro) */
  canConfirm: boolean
}

export function reviewMapping(shapes: readonly MapShape[], pastures: readonly Pasture[]): MappingReview {
  const live = shapes.filter(alive)
  const perimeter = live.find((s) => s.kind === 'perimetro') ?? null
  const byId = new Map(pastures.map((p) => [p.id, p]))
  const pastureShapes = live.filter((s) => s.kind === 'pasto').map((shape) => ({ shape, pasture: byId.get(shape.pastureId ?? '') ?? null }))
  const otherAreas = live.filter((s) => s.kind === 'nao-produtiva')
  const inner = [...pastureShapes.map((x) => x.shape), ...otherAreas]
  const mappedCentiHa = inner.reduce((a, s) => a + s.areaCentiHa, 0)
  const warnings: string[] = []

  if (!perimeter) warnings.push('Falta desenhar o perímetro da fazenda.')
  if (perimeter) {
    const outer = fromGeometry(perimeter.geometry)
    for (const s of inner) {
      if (!ringInside(fromGeometry(s.geometry), outer)) {
        const label = s.kind === 'pasto' ? (byId.get(s.pastureId ?? '')?.name ?? 'Pasto') : s.name
        warnings.push(`"${label}" passa para fora do perímetro.`)
      }
    }
  }
  for (const { shape, pasture } of pastureShapes) {
    if (!pasture || pasture.deletedAt !== null) warnings.push('Há um desenho de pasto que não existe mais no cadastro.')
    else if (pasture.areaHa !== null && pasture.areaHa > 0) {
      const cad = Math.round(pasture.areaHa * 100)
      if (Math.abs(shape.areaCentiHa - cad) > Math.max(cad * 0.1, 50))
        warnings.push(`"${pasture.name}": área do cadastro ${formatHa(cad)} e do mapa ${formatHa(shape.areaCentiHa)} (diferença acima de 10%).`)
    }
  }
  const unassignedCentiHa = perimeter ? Math.max(0, perimeter.areaCentiHa - mappedCentiHa) : null
  if (perimeter && mappedCentiHa > perimeter.areaCentiHa * 1.005) warnings.push('A soma dos pastos e áreas é maior que o perímetro: confira os contornos.')
  const drawn = new Set(pastureShapes.map((x) => x.shape.pastureId))
  const notDrawn = pastures.filter((p) => p.deletedAt === null && !drawn.has(p.id))
  return { perimeter, pastures: pastureShapes, otherAreas, mappedCentiHa, unassignedCentiHa, notDrawn, warnings, canConfirm: perimeter !== null }
}

/**
 * Confirmação explícita do proprietário: grava uma versão imutável do mapeamento (histórico e recuperação).
 */
export async function confirmMapping(db: ArgoDatabase, farmId: string, pastures: readonly Pasture[]): Promise<MapVersion> {
  return db.transaction('rw', [db.mapShapes, db.farmMaps, db.mapVersions, db.auditLog, db.outbox, db.meta], async () => {
    const shapes = (await db.mapShapes.where('farmId').equals(farmId).toArray()).filter(alive)
    const review = reviewMapping(shapes, pastures)
    if (!review.canConfirm) throw new MapError('Desenhe o perímetro da fazenda antes de confirmar.')
    const fm = await farmMapOf(db, farmId)
    const version = fm.version + 1
    const at = nowIso()
    const v = await new Repository(db, 'mapVersions').create({
      farmId,
      version,
      confirmedAt: at,
      shapes: shapes.map((s) => ({ kind: s.kind, pastureId: s.pastureId, name: s.name, geometry: s.geometry, areaCentiHa: s.areaCentiHa, perimeterM: s.perimeterM })),
      totalCentiHa: review.perimeter!.areaCentiHa,
      warnings: review.warnings,
    })
    await new Repository(db, 'farmMaps').update(fm.id, { status: 'confirmado', version, confirmedAt: at })
    return v
  })
}

/** "Usar a área do mapa" no cadastro do pasto (só quando a pessoa pede; nunca automático). */
export async function applyMapArea(db: ArgoDatabase, pastureId: string, centiHa: number): Promise<Pasture> {
  const p = await db.pastures.get(pastureId)
  if (!p || p.deletedAt !== null) throw new MapError('Pasto não encontrado.')
  return updatePasture(db, pastureId, { name: p.name, areaHa: centiHa / 100, notes: p.notes })
}
