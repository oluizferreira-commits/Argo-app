import type { SupplyCategory, SupplyUnit } from '../../db/types'
import { parseDecimal } from '../../core/money'
import { formatQty, parseKgPerSack, parseQty, SupplyError, type SupplyDetails } from './supplies'

/** Estado (texto) dos campos de cadastro de herbicidas, sementes e estoque mínimo. */
export interface SupplyFieldsState {
  category: SupplyCategory
  unit: SupplyUnit
  kgPerSack: string
  manufacturer: string
  activeIngredient: string
  species: string
  cultivar: string
  vc: string
  min: string
  notes: string
}

export function initialFields(s?: {
  category?: SupplyCategory
  unit?: SupplyUnit
  gramsPerSack?: number | null
  manufacturer?: string
  activeIngredient?: string
  species?: string
  cultivar?: string
  culturalValue?: number | null
  minQty?: number | null
  notes?: string
}, category: SupplyCategory = 'geral'): SupplyFieldsState {
  const cat = s?.category ?? category
  const unit = s?.unit ?? (cat === 'herbicida' ? 'L' : cat === 'semente' ? 'kg' : 'saco')
  const minText = s?.minQty ? formatQty(s.minQty, unit).replace(/ (sacos?|L|kg)$/, '') : ''
  return {
    category: cat,
    unit,
    kgPerSack: s?.gramsPerSack ? String(s.gramsPerSack / 1000).replace('.', ',') : '',
    manufacturer: s?.manufacturer ?? '',
    activeIngredient: s?.activeIngredient ?? '',
    species: s?.species ?? '',
    cultivar: s?.cultivar ?? '',
    vc: s?.culturalValue ? String(s.culturalValue / 10).replace('.', ',') : '',
    min: minText,
    notes: s?.notes ?? '',
  }
}

/** Converte o estado para os dados do serviço (valida números). */
export function fieldsToDetails(f: SupplyFieldsState): { gramsPerSack: number | null; details: SupplyDetails } {
  const vc = f.vc.trim() ? parseDecimal(f.vc.replace('%', ''), 1) : null
  if (f.vc.trim() && vc === null) throw new SupplyError('Valor cultural inválido (ex.: 80 ou 72,5).')
  return {
    gramsPerSack: f.kgPerSack.trim() ? parseKgPerSack(f.kgPerSack) : null,
    details: {
      category: f.category,
      unit: f.unit,
      manufacturer: f.manufacturer,
      activeIngredient: f.activeIngredient,
      species: f.species,
      cultivar: f.cultivar,
      culturalValue: vc,
      minQty: f.min.trim() ? parseQty(f.min, f.unit) : null,
      notes: f.notes,
    },
  }
}

