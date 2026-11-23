import { describe, expect, it } from 'vitest'
import { backupDue, nextBackupIn } from './exportNow'

const now = Date.parse('2026-11-24T08:00:00Z')
const h = (n: number) => new Date(now - n * 3600_000).toISOString()

describe('lembrete de backup a cada 12 horas', () => {
  it('sem lançamentos não incomoda; com dados e sem backup, avisa', () => {
    expect(backupDue(null, false, now)).toBe(false)
    expect(backupDue(null, true, now)).toBe(true)
  })
  it('avisa a partir de 12 horas do último backup (inclusive se o app ficou fechado)', () => {
    expect(backupDue(h(11.9), true, now)).toBe(false)
    expect(backupDue(h(12), true, now)).toBe(true)
    expect(backupDue(h(72), true, now)).toBe(true)
  })
  it('tempo até o próximo lembrete', () => {
    expect(nextBackupIn(h(2), now)).toBe(10 * 3600_000)
    expect(nextBackupIn(h(20), now)).toBe(0)
    expect(nextBackupIn(null, now)).toBe(0)
  })
})
