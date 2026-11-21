/** Valores em centavos (inteiros) ↔ texto em reais (pt-BR). */

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function formatMoney(cents: number): string {
  return brl.format(cents / 100)
}

/**
 * Converte "2.500", "2500,50", "2.500,50" ou "R$ 2.500,50" em centavos.
 * Retorna null se vazio ou inválido.
 */
export function parseMoney(text: string): number | null {
  return parseDecimal(text, 2)
}

/**
 * Número decimal brasileiro → inteiro escalado (ex.: casas=1 → décimos).
 * "487,5" com casas=1 → 4875. Retorna null se vazio/ inválido.
 */
export function parseDecimal(text: string, places: number): number | null {
  let t = text.replace(/[R$\s]/g, '')
  if (!t) return null
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '') // "2.500" = dois mil e quinhentos
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  const [int, frac = ''] = t.split('.')
  if (frac.length > places) return null
  return Number(int) * 10 ** places + Number(frac.padEnd(places, '0') || 0)
}

export function formatDecimal(scaled: number, places: number, minPlaces = 0): string {
  return (scaled / 10 ** places).toLocaleString('pt-BR', { minimumFractionDigits: minPlaces, maximumFractionDigits: places })
}
