/**
 * Pix "copia e cola" / QR Code estático (BR Code, padrão EMV do Banco Central).
 * Funciona sem internet: o código é montado no próprio aparelho.
 */

export type PixKeyType = 'cpf' | 'cnpj' | 'celular' | 'email' | 'aleatoria'

export const PIX_KEY_LABELS: Record<PixKeyType, string> = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  celular: 'Celular',
  email: 'E-mail',
  aleatoria: 'Chave aleatória',
}

export class PixError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PixError'
  }
}

const digits = (s: string) => s.replace(/\D/g, '')

export function isValidCpf(value: string): boolean {
  const d = digits(value)
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false
  const calc = (len: number) => {
    let sum = 0
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i)
    const r = (sum * 10) % 11
    return r === 10 ? 0 : r
  }
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10])
}

export function isValidCnpj(value: string): boolean {
  const d = digits(value)
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const sum = weights.reduce((acc, w, i) => acc + w * Number(d[i]), 0)
    const r = sum % 11
    return r < 2 ? 0 : 11 - r
  }
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13])
}

/** Converte a chave digitada no formato exigido pelo Pix; lança PixError se inválida. */
export function normalizePixKey(type: PixKeyType, raw: string): string {
  const v = raw.trim()
  switch (type) {
    case 'cpf':
      if (!isValidCpf(v)) throw new PixError('CPF inválido.')
      return digits(v)
    case 'cnpj':
      if (!isValidCnpj(v)) throw new PixError('CNPJ inválido.')
      return digits(v)
    case 'celular': {
      let d = digits(v)
      if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
      if (d.length !== 10 && d.length !== 11) throw new PixError('Celular inválido. Use DDD + número, ex.: (34) 99999-1234.')
      return `+55${d}`
    }
    case 'email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || v.length > 77) throw new PixError('E-mail inválido.')
      return v.toLowerCase()
    case 'aleatoria':
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) throw new PixError('Chave aleatória inválida.')
      return v.toLowerCase()
  }
}

// ------------------------------------------------------------------ máscaras

/** CPF/CNPJ/celular/e-mail com parte oculta, para exibir em tela e no comprovante. */
export function maskPixKey(type: PixKeyType, key: string): string {
  switch (type) {
    case 'cpf':
      return maskCpf(key)
    case 'cnpj':
      return maskCnpj(key)
    case 'celular': {
      const d = digits(key).replace(/^55/, '')
      return `(${d.slice(0, 2)}) *****-**${d.slice(-2)}`
    }
    case 'email': {
      const [user, domain] = key.split('@')
      return `${user.slice(0, 2)}***@${domain}`
    }
    case 'aleatoria':
      return `${key.slice(0, 4)}****${key.slice(-4)}`
  }
}

export function maskCpf(value: string): string {
  const d = digits(value)
  return `${d.slice(0, 2)}*.***.***-${d.slice(-2)}`
}

export function maskCnpj(value: string): string {
  const d = digits(value)
  return `${d.slice(0, 2)}.***.***/****-${d.slice(-2)}`
}

/**
 * Telefone mascarado para o comprovante: "(34) *****-**34".
 * Sem DDD reconhecível, mostra só os 2 últimos dígitos.
 */
export function maskPhone(value: string): string {
  let d = digits(value)
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
  if (!d) return ''
  if (d.length >= 10) return `(${d.slice(0, 2)}) *****-**${d.slice(-2)}`
  return `****-**${d.slice(-2)}`
}

/** Documento do cliente (CPF ou CNPJ) mascarado; vazio se não informado. */
export function maskDocument(value: string): string {
  const d = digits(value)
  if (d.length === 11) return maskCpf(d)
  if (d.length === 14) return maskCnpj(d)
  return ''
}

// ------------------------------------------------------------------ BR Code

const field = (id: string, value: string) => `${id}${String(value.length).padStart(2, '0')}${value}`

/** Remove acentos e caracteres fora do padrão (nome/cidade do recebedor). */
export function pixText(s: string, max: number): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .toUpperCase()
}

/** CRC16-CCITT (polinômio 0x1021, valor inicial 0xFFFF), exigido pelo BR Code. */
export function crc16(payload: string): string {
  let crc = 0xffff
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

export interface PixCharge {
  key: string
  name: string
  city: string
  /** Valor em centavos (0 = valor livre). */
  amountCents: number
  /** Identificador (até 25 letras/números). */
  txid?: string
}

export function buildPixPayload(c: PixCharge): string {
  const name = pixText(c.name, 25)
  const city = pixText(c.city, 15)
  if (!name) throw new PixError('Informe o nome do recebedor Pix.')
  if (!city) throw new PixError('Informe a cidade do recebedor Pix.')
  const txid = (c.txid ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***'
  const account = field('00', 'br.gov.bcb.pix') + field('01', c.key)
  let p =
    field('00', '01') +
    field('26', account) +
    field('52', '0000') +
    field('53', '986') +
    (c.amountCents > 0 ? field('54', (c.amountCents / 100).toFixed(2)) : '') +
    field('58', 'BR') +
    field('59', name) +
    field('60', city) +
    field('62', field('05', txid))
  p += '6304'
  return p + crc16(p)
}
