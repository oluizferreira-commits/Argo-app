import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CHANGELOG, changesSince, compareVersions, markVersionSeen, pendingUpdateNotice } from './changelog'

// armazenamento simples do navegador para o teste (o ambiente de teste é Node)
beforeEach(() => {
  const m = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() },
  })
})
afterEach(() => localStorage.clear())

describe('novidades', () => {
  it('a versão do app tem nota de atualização e a lista está da mais nova para a mais antiga', () => {
    expect(CHANGELOG[0].version).toBe(__APP_VERSION__)
    for (let i = 1; i < CHANGELOG.length; i++) expect(compareVersions(CHANGELOG[i - 1].version, CHANGELOG[i].version)).toBeGreaterThan(0)
    expect(CHANGELOG.every((e) => e.items.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(e.date))).toBe(true)
  })

  it('compara versões e lista o que mudou desde a versão anterior', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0)
    expect(changesSince('0.20.0', '0.22.0').map((e) => e.version)).toEqual(['0.22.0', '0.21.0'])
  })

  it('instalação nova não mostra aviso; atualização mostra uma vez', () => {
    expect(pendingUpdateNotice('0.23.0', new Date().toISOString())).toBeNull()
    expect(pendingUpdateNotice('0.23.0')).toBeNull()
    expect(pendingUpdateNotice('0.24.0')).toBe('0.23.0')
    markVersionSeen('0.24.0')
    expect(pendingUpdateNotice('0.24.0')).toBeNull()
  })

  it('quem já usava o app antes desta tela vê as novidades desde a 0.22.0', () => {
    expect(pendingUpdateNotice('0.23.0', '2026-11-01T10:00:00Z')).toBe('0.22.0')
  })
})
