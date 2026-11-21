/**
 * Busca de cidades (OpenStreetMap): Nominatim; se falhar, Photon.
 * Só retorna localidades (cidade, município, vila…), nunca um ponto inventado.
 */

export interface PlaceResult {
  name: string
  region: string
  lat: number
  lng: number
  osm: string
  kind: string
}

const PLACE_TYPES = new Set(['city', 'town', 'village', 'municipality', 'hamlet', 'suburb', 'administrative', 'city_district', 'locality'])

/** Tipo de localidade em português (para diferenciar resultados com o mesmo nome). */
export const KIND_LABEL: Record<string, string> = {
  municipality: 'Município',
  city: 'Cidade',
  town: 'Cidade',
  village: 'Vila',
  hamlet: 'Povoado',
  locality: 'Localidade',
  city_district: 'Distrito',
  suburb: 'Bairro',
  administrative: 'Área administrativa',
}

/** Município e cidade primeiro. */
const KIND_ORDER = ['municipality', 'city', 'town', 'village', 'city_district', 'hamlet', 'locality', 'suburb', 'administrative']

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? 'Localidade'
}

export class GeocodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GeocodeError'
  }
}

async function nominatim(q: string): Promise<PlaceResult[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&countrycodes=br&accept-language=pt-BR&q=${encodeURIComponent(q)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as {
    name: string
    lat: string
    lon: string
    osm_type: string
    osm_id: number
    category: string
    type: string
    addresstype?: string
    address?: { state?: string }
  }[]
  return data
    .filter((d) => (d.category === 'place' || d.category === 'boundary') && PLACE_TYPES.has(d.type))
    .map((d) => ({
      name: d.name,
      region: d.address?.state ?? '',
      lat: Number(d.lat),
      lng: Number(d.lon),
      osm: `${d.osm_type[0].toUpperCase()}${d.osm_id}`,
      kind: d.type === 'administrative' && d.addresstype ? d.addresstype : d.type,
    }))
}

async function photon(q: string): Promise<PlaceResult[]> {
  const res = await fetch(`https://photon.komoot.io/api/?limit=8&q=${encodeURIComponent(q)}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as {
    features: {
      geometry: { coordinates: [number, number] }
      properties: { name?: string; state?: string; country?: string; countrycode?: string; osm_key?: string; osm_value?: string; osm_type?: string; osm_id?: number }
    }[]
  }
  return data.features
    .filter((f) => f.properties.countrycode === 'BR' && f.properties.osm_key === 'place' && PLACE_TYPES.has(f.properties.osm_value ?? ''))
    .map((f) => ({
      name: f.properties.name ?? '',
      region: f.properties.state ?? '',
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
      osm: `${(f.properties.osm_type ?? '?').toUpperCase()}${f.properties.osm_id ?? ''}`,
      kind: f.properties.osm_value ?? '',
    }))
}

export async function searchPlaces(q: string): Promise<PlaceResult[]> {
  const query = q.trim()
  if (query.length < 3) throw new GeocodeError('Digite ao menos 3 letras.')
  let results: PlaceResult[] = []
  try {
    results = await nominatim(query)
  } catch {
    /* tenta o Photon */
  }
  if (results.length === 0) {
    try {
      results = await photon(query)
    } catch {
      throw new GeocodeError('Sem conexão com a busca de cidades. Verifique a internet.')
    }
  }
  // remove repetidos (mesmo objeto do OSM) e põe município/cidade primeiro
  const seen = new Set<string>()
  const rank = (k: string) => (KIND_ORDER.indexOf(k) + 1 || 99)
  return results.filter((r) => r.name && !seen.has(r.osm) && seen.add(r.osm)).sort((a, b) => rank(a.kind) - rank(b.kind))
}
