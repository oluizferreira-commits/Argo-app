import type { ArgoDatabase } from '../../db/database'
import { getMeta, setMeta } from '../../db/device'
import { Repository } from '../../db/repository'
import type { Farm } from '../../db/types'
import { isValidCpf, normalizePixKey, PixError, pixFitCity, pixFitName, type PixKeyType } from '../../domain/pix'

export class FarmError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FarmError'
  }
}

export interface FarmInput {
  name: string
  responsible: string
  city: string
}

const CURRENT_KEY = 'currentFarmId'

function clean(input: FarmInput): FarmInput {
  const name = input.name.trim().replace(/\s+/g, ' ')
  if (!name) throw new FarmError('Informe o nome da fazenda.')
  if (name.length > 60) throw new FarmError('Nome muito longo (máx. 60 caracteres).')
  return { name, responsible: input.responsible.trim(), city: input.city.trim() }
}

async function assertUniqueName(db: ArgoDatabase, name: string, exceptId?: string) {
  const key = name.toLocaleLowerCase('pt-BR')
  const clash = (await db.farms.toArray()).find(
    (f) => f.deletedAt === null && f.id !== exceptId && f.name.toLocaleLowerCase('pt-BR') === key,
  )
  if (clash) throw new FarmError(`Já existe uma fazenda chamada "${clash.name}".`)
}

// ------------------------------------------------------------------ PIN

export function validatePin(pin: string): void {
  if (!/^\d{4,6}$/.test(pin)) throw new FarmError('O PIN deve ter de 4 a 6 números.')
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function hashPin(pin: string): Promise<{ pinHash: string; pinSalt: string }> {
  const salt = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')
  return { pinHash: await sha256(`${salt}:${pin}`), pinSalt: salt }
}

export async function verifyPin(farm: Farm, pin: string): Promise<boolean> {
  if (!farm.pinHash || !farm.pinSalt) return true
  return (await sha256(`${farm.pinSalt}:${pin}`)) === farm.pinHash
}

// ------------------------------------------------------------------ cadastro

/**
 * Cadastra uma fazenda. A primeira fazenda "adota" dados lançados antes de existir
 * o cadastro de fazendas (registros sem farmId), para que nada se perca.
 */
export async function createFarm(db: ArgoDatabase, input: FarmInput, pin: string, idempotencyKey?: string): Promise<Farm> {
  const data = clean(input)
  if (pin) validatePin(pin)
  // O hash é calculado FORA da transação (crypto.subtle não participa de transações do banco).
  const secret = pin ? await hashPin(pin) : { pinHash: null, pinSalt: null }
  const farms = new Repository(db, 'farms')
  return db.transaction('rw', [db.farms, db.pastures, db.pastureTasks, db.movements, db.auditLog, db.outbox, db.meta], async () => {
    if (idempotencyKey) {
      const existing = await db.farms.get(idempotencyKey)
      if (existing) return existing
    }
    await assertUniqueName(db, data.name)
    const farm = await farms.create({ ...data, ...secret }, idempotencyKey)
    await adoptOrphans(db, farm.id)
    return farm
  })
}

async function adoptOrphans(db: ArgoDatabase, farmId: string) {
  const pastures = new Repository(db, 'pastures')
  const tasks = new Repository(db, 'pastureTasks')
  const movements = new Repository(db, 'movements')
  for (const p of await db.pastures.toArray()) if (!p.farmId) await pastures.update(p.id, { farmId })
  for (const t of await db.pastureTasks.toArray()) if (!t.farmId) await tasks.update(t.id, { farmId })
  for (const m of await db.movements.toArray()) if (!m.farmId) await movements.update(m.id, { farmId })
}

export async function updateFarm(db: ArgoDatabase, id: string, input: FarmInput): Promise<Farm> {
  const data = clean(input)
  const farms = new Repository(db, 'farms')
  return db.transaction('rw', [db.farms, db.auditLog, db.outbox, db.meta], async () => {
    await assertUniqueName(db, data.name, id)
    return farms.update(id, data)
  })
}

/** Define (pin preenchido) ou remove (pin vazio) a senha da fazenda. */
export async function setFarmPin(db: ArgoDatabase, id: string, pin: string): Promise<Farm> {
  if (pin) validatePin(pin)
  const secret = pin ? await hashPin(pin) : { pinHash: null, pinSalt: null }
  return new Repository(db, 'farms').update(id, secret)
}

// ------------------------------------------------------------------ Pix

export interface FarmPixInput {
  type: PixKeyType
  key: string
  name: string
  city: string
}

/** Salva a chave Pix da fazenda (validada e normalizada). */
export async function updateFarmPix(db: ArgoDatabase, id: string, input: FarmPixInput): Promise<Farm> {
  let key: string
  try {
    key = normalizePixKey(input.type, input.key)
  } catch (e) {
    throw new FarmError(e instanceof PixError ? e.message : 'Chave Pix inválida.')
  }
  // QR Code: versão abreviada (limites do Pix: nome 25, cidade 15); comprovante: nome completo
  const name = pixFitName(input.name)
  const city = pixFitCity(input.city)
  if (!name) throw new FarmError('Informe o nome do recebedor (como aparece no banco).')
  if (!city) throw new FarmError('Informe a cidade do recebedor.')
  const fullName = input.name.trim().replace(/\s+/g, ' ').slice(0, 80)
  const fullCity = input.city.trim().replace(/\s+/g, ' ').slice(0, 60)
  return new Repository(db, 'farms').update(id, { pixKeyType: input.type, pixKey: key, pixName: name, pixCity: city, pixFullName: fullName, pixFullCity: fullCity })
}

export async function removeFarmPix(db: ArgoDatabase, id: string): Promise<Farm> {
  return new Repository(db, 'farms').update(id, { pixKeyType: null, pixKey: null, pixName: '', pixCity: '', pixFullName: '', pixFullCity: '' })
}

// ------------------------------------------------------------------ fazenda atual

export async function getCurrentFarmId(db: ArgoDatabase): Promise<string | null> {
  return (await getMeta<string | null>(db, CURRENT_KEY)) ?? null
}

export async function setCurrentFarm(db: ArgoDatabase, id: string | null): Promise<void> {
  await setMeta(db, CURRENT_KEY, id)
}

// ------------------------------------------------------------------ responsável

/** Nome e CPF do responsável pela fazenda. CPF vazio = não informado. */
export async function updateFarmResponsible(db: ArgoDatabase, id: string, input: { responsible: string; cpf: string }): Promise<Farm> {
  const responsible = input.responsible.trim().replace(/\s+/g, ' ')
  if (!responsible) throw new FarmError('Informe o nome do responsável.')
  if (responsible.length > 60) throw new FarmError('Nome muito longo (máx. 60 caracteres).')
  const cpf = input.cpf.replace(/\D/g, '')
  if (cpf && !isValidCpf(cpf)) throw new FarmError('CPF inválido. Confira os números.')
  return new Repository(db, 'farms').update(id, { responsible, responsibleCpf: cpf || null })
}
