import { describe, expect, it } from 'vitest'
import { buildPixPayload, crc16, isValidCnpj, isValidCpf, maskCpf, maskDocument, maskPhone, maskPixKey, normalizePixKey, PixError, pixText, pixFitName, pixFitCity } from './pix'

describe('pix', () => {
  it('CRC16-CCITT confere com o valor de referência', () => {
    // Valor de verificação padrão do CRC-16/CCITT-FALSE para "123456789".
    expect(crc16('123456789')).toBe('29B1')
  })

  it('confere com o exemplo oficial do manual do Pix (Banco Central): CRC 1D3D', () => {
    const exemplo =
      '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304'
    expect(crc16(exemplo)).toBe('1D3D')
    // Mesma estrutura gerada pelo ARGO (nome em maiúsculas, sem acento):
    const p = buildPixPayload({ key: '123e4567-e12b-12d1-a456-426655440000', name: 'Fulano de Tal', city: 'BRASILIA', amountCents: 0 })
    expect(p.slice(0, -4)).toBe(exemplo.replace('Fulano de Tal', 'FULANO DE TAL'))
  })

  it('inclui valor e identificador da venda', () => {
    const p = buildPixPayload({ key: '+5534999991234', name: 'Fazenda São José', city: 'Uberlândia', amountCents: 250000, txid: 'ARGO-0007' })
    expect(p).toContain('54072500.00')
    expect(p).toContain('5916FAZENDA SAO JOSE')
    expect(p).toContain('6010UBERLANDIA')
    expect(p).toContain('0508ARGO0007')
    expect(p.slice(-8, -4)).toBe('6304')
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)))
  })

  it('valida e normaliza chaves', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true)
    expect(isValidCpf('111.111.111-11')).toBe(false)
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true)
    expect(normalizePixKey('cpf', '529.982.247-25')).toBe('52998224725')
    expect(normalizePixKey('celular', '(34) 99999-1234')).toBe('+5534999991234')
    expect(normalizePixKey('email', 'Luiz@Exemplo.com')).toBe('luiz@exemplo.com')
    expect(() => normalizePixKey('cpf', '123')).toThrow(PixError)
  })

  it('mascara documentos para não expor dados', () => {
    expect(maskCpf('52998224725')).toBe('52*.***.***-25')
    expect(maskPixKey('celular', '+5534999991234')).toBe('(34) *****-**34')
    expect(maskPixKey('email', 'luiz@exemplo.com')).toBe('lu***@exemplo.com')
    expect(maskDocument('11222333000181')).toBe('11.***.***/****-81')
    expect(maskDocument('')).toBe('')
    expect(maskPhone('(34) 99999-1234')).toBe('(34) *****-**34')
    expect(maskPhone('+55 34 3333-1234')).toBe('(34) *****-**34')
    expect(maskPhone('')).toBe('')
    expect(pixText('José da Silva Ção', 25)).toBe('JOSE DA SILVA CAO')
  })
})

describe('nome e cidade no QR Code (limites do Pix)', () => {
  it('nome que cabe fica igual (só sem acento e em maiúsculas)', () => {
    expect(pixFitName('João da Silva')).toBe('JOAO DA SILVA')
  })
  it('nome longo: abrevia os nomes do meio, mantém primeiro e último', () => {
    expect(pixFitName('Luiz Eduardo Nunes Garcia Ferreira')).toBe('LUIZ EDUARDO N G FERREIRA')
    expect(pixFitName('Luiz Eduardo Nunes Garcia Ferreira').length).toBeLessThanOrEqual(25)
    expect(pixFitName('Maria Aparecida dos Santos Albuquerque Cavalcanti')).toBe('MARIA A S A CAVALCANTI')
  })
  it('cidade: tira "do/da" e só corta se ainda não couber', () => {
    expect(pixFitCity('Redenção')).toBe('REDENCAO')
    expect(pixFitCity('Floresta do Araguaia')).toBe('FLORESTA ARAGUA')
    expect(pixFitCity('Floresta do Araguaia').length).toBeLessThanOrEqual(15)
  })
})
