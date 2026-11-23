import { describe, expect, it } from 'vitest'
import { parseSpokenTask, type VoiceContext } from './voice'

// 2026-11-23 é uma segunda-feira
const ctx: VoiceContext = {
  today: '2026-11-23',
  pastures: [
    { id: 'p1', name: 'Pasto da Represa' },
    { id: 'p2', name: 'Pasto Novo' },
    { id: 'p3', name: 'Pasto Novo de Cima' },
    { id: 'p4', name: 'Ipê' },
  ],
  responsibles: [
    { id: 'r1', name: 'Zé Tratorista' },
    { id: 'r2', name: 'João Batista' },
  ],
}

describe('tarefa falada', () => {
  it('frase completa: prazo, pasto, urgência e responsável saem do texto', () => {
    const t = parseSpokenTask('Anota pra amanhã arrumar a cerca do Pasto da Represa, urgente, pro Zé', ctx)
    expect(t.description).toBe('Arrumar a cerca')
    expect(t.dueDate).toBe('2026-11-24')
    expect(t.pastureId).toBe('p1')
    expect(t.priority).toBe('alta')
    expect(t.responsibleId).toBe('r1')
    expect(t.understood).toEqual(['prioridade alta', 'prazo 24/11/2026', 'Pasto da Represa', 'Zé Tratorista'])
  })

  it('sem nada além do texto: anota como foi dito (sem prazo, geral, normal)', () => {
    const t = parseSpokenTask('comprar arame farpado e grampo', ctx)
    expect(t).toMatchObject({ description: 'Comprar arame farpado e grampo', dueDate: null, pastureId: '', responsibleId: null, priority: 'normal' })
    expect(t.understood).toEqual([])
  })

  it('palavras de comando no começo são ignoradas', () => {
    expect(parseSpokenTask('nova tarefa: trocar o pneu do trator', ctx).description).toBe('Trocar o pneu do trator')
    expect(parseSpokenTask('lembrete de vacinar os bezerros hoje', ctx)).toMatchObject({ description: 'Vacinar os bezerros', dueDate: '2026-11-23' })
    expect(parseSpokenTask('ok argo anotar uma tarefa limpar o bebedouro', ctx).description).toBe('Limpar o bebedouro')
  })

  it('prazos falados', () => {
    expect(parseSpokenTask('depois de amanhã buscar sal', ctx).dueDate).toBe('2026-11-25')
    expect(parseSpokenTask('buscar sal na sexta', ctx).dueDate).toBe('2026-11-27')
    expect(parseSpokenTask('buscar sal segunda-feira', ctx).dueDate).toBe('2026-11-30') // hoje é segunda: a próxima
    expect(parseSpokenTask('buscar sal semana que vem', ctx).dueDate).toBe('2026-11-30')
    expect(parseSpokenTask('buscar sal daqui a três dias', ctx).dueDate).toBe('2026-11-26')
    expect(parseSpokenTask('buscar sal em 10 dias', ctx).dueDate).toBe('2026-12-03')
    expect(parseSpokenTask('pagar o veterinário dia 28', ctx).dueDate).toBe('2026-11-28')
    expect(parseSpokenTask('pagar o veterinário dia 5', ctx).dueDate).toBe('2026-12-05') // dia 5 já passou: mês que vem
  })

  it('pasto: o nome mais longo ganha e acento não importa', () => {
    expect(parseSpokenTask('roçar o pasto novo de cima', ctx)).toMatchObject({ pastureId: 'p3', description: 'Roçar o pasto novo de cima' })
    expect(parseSpokenTask('consertar porteira no pasto novo', ctx)).toMatchObject({ pastureId: 'p2', description: 'Consertar porteira' })
    expect(parseSpokenTask('olhar a aguada do ipe', ctx)).toMatchObject({ pastureId: 'p4', description: 'Olhar a aguada' })
  })

  it('responsável só com preposição ("pro", "para o") — o nome solto continua no texto', () => {
    expect(parseSpokenTask('levar o diesel para o João', ctx)).toMatchObject({ responsibleId: 'r2', description: 'Levar o diesel' })
    expect(parseSpokenTask('falar com João sobre a cerca', ctx)).toMatchObject({ responsibleId: null })
  })

  it('se só sobrou comando, mantém a frase inteira', () => {
    expect(parseSpokenTask('hoje', ctx).description).toBe('Hoje')
  })
})
