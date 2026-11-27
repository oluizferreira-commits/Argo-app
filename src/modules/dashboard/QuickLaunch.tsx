import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Icon, type IconName } from '../../components/Icon'

interface Option {
  label: string
  detail: string
  icon: IconName
  /** null = o módulo ainda não existe (aparece como "Em breve", sem formulário falso) */
  to: string | null
}

/** Atalhos para os formulários que já existem nos módulos (nada de formulário paralelo). */
const QUICK_OPTIONS: Option[] = [
  { label: 'Iniciar serviço de máquina', detail: 'Horímetro digital: início, pausa e fim pelo relógio', icon: 'clock', to: '/maquinas/servico/novo' },
  { label: 'Marcar diária', detail: 'Calendário dos diaristas', icon: 'people', to: '/diaristas' },
  { label: 'Registrar animal', detail: 'Nascimento, compra, morte, perna quebrada, transferência ou contagem', icon: 'herd', to: '/rebanho/movimentar' },
  { label: 'Registrar despesa', detail: 'Em breve. Compras de diesel e de insumos já contam como despesa', icon: 'wallet', to: null },
  { label: 'Registrar receita', detail: 'Venda de gado (por arroba ou por cabeça)', icon: 'cash', to: '/vendas/nova' },
  { label: 'Entrada ou saída de estoque', detail: 'Sal, mistura e outros insumos', icon: 'sack', to: '/insumos' },
  { label: 'Compra de combustível', detail: 'Diesel: posto, litros e valor', icon: 'fuel', to: '/diesel?novo=compra' },
  { label: 'Consumo de combustível', detail: 'Abastecimento de equipamento', icon: 'fuel', to: '/diesel?novo=consumo' },
  { label: 'Aplicação de herbicida', detail: 'Operação de campo: produtos, trator, diesel e custo por pasto', icon: 'syringe', to: '/manejo/nova?tipo=herbicida' },
  { label: 'Plantio de capim', detail: 'Sementes, máquinas, diesel e custo por hectare', icon: 'pasture', to: '/manejo/nova?tipo=plantio' },
  { label: 'Registrar vacinação', detail: 'Por pasto e lote, com aplicação parcial', icon: 'syringe', to: '/vacinacao/nova' },
  { label: 'Registrar pesagem', detail: 'Em breve. Hoje a pesagem é feita dentro da venda por arroba', icon: 'scale', to: null },
  { label: 'Registrar manutenção', detail: 'Escolha a máquina e registre a manutenção', icon: 'gear', to: '/maquinas' },
  { label: 'Criar tarefa', detail: 'Anotar com prazo, responsável e pasto', icon: 'clipboard', to: '/tarefas' },
]

/** Tudo o que hoje já entra como despesa no ARGO (cada um no seu módulo, sem lançamento em dobro). */
const EXPENSE_OPTIONS: Option[] = [
  { label: 'Compra de diesel', detail: 'Posto, litros e valor — entra nas despesas do mês', icon: 'fuel', to: '/diesel?novo=compra' },
  { label: 'Compra de insumo', detail: 'Sal, mistura, herbicida, semente e outros', icon: 'sack', to: '/insumos' },
  { label: 'Manutenção de máquina', detail: 'Peças e serviço — escolha a máquina', icon: 'gear', to: '/maquinas' },
  { label: 'Pagamento de diarista', detail: 'Pelo calendário do diarista', icon: 'people', to: '/diaristas' },
  { label: 'Outras despesas (energia, impostos…)', detail: 'Em breve. Ainda não existe lançamento avulso de despesa', icon: 'wallet', to: null },
]

/** Atalhos grandes do Painel: as ações mais usadas no campo. */
const ACTIONS: { label: string; icon: IconName; to?: string; sheet?: 'despesa'; testId: string }[] = [
  { label: 'Movimentar animais', icon: 'herd', to: '/rebanho/movimentar', testId: 'qa-animais' },
  { label: 'Nova venda', icon: 'cash', to: '/vendas/nova', testId: 'qa-venda' },
  { label: 'Novo serviço', icon: 'clock', to: '/maquinas/servico/novo', testId: 'qa-servico' },
  { label: 'Abastecimento', icon: 'fuel', to: '/diesel?novo=consumo', testId: 'qa-abastecimento' },
  { label: 'Tarefa', icon: 'clipboard', to: '/tarefas', testId: 'qa-tarefa' },
  { label: 'Despesa', icon: 'wallet', sheet: 'despesa', testId: 'qa-despesa' },
]

function Sheet({ title, options, onClose }: { title: string; options: Option[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} data-testid="quick-sheet">
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <strong>{title}</strong>
          <button className="btn btn-outline btn-icon" aria-label="Fechar" onClick={onClose}>
            <Icon name="chevronLeft" size={20} />
          </button>
        </div>
        <div className="module-list sheet-list">
          {options.map((o) =>
            o.to ? (
              <Link key={o.label} to={o.to} onClick={onClose}>
                <div className="status-icon">
                  <Icon name={o.icon} />
                </div>
                <div className="status-body">
                  <div className="status-label">{o.label}</div>
                  <div className="status-detail">{o.detail}</div>
                </div>
                <Icon name="chevronRight" size={20} className="muted" />
              </Link>
            ) : (
              <div key={o.label} className="sheet-disabled" aria-disabled="true">
                <div className="status-icon">
                  <Icon name={o.icon} />
                </div>
                <div className="status-body">
                  <div className="status-label">{o.label}</div>
                  <div className="status-detail">{o.detail}</div>
                </div>
                <span className="badge badge-gold">Em breve</span>
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  )
}

export function QuickLaunch() {
  const [open, setOpen] = useState<null | 'todos' | 'despesa'>(null)
  const close = () => setOpen(null)
  return (
    <>
      <h2 className="section-title">Ações rápidas</h2>
      <div className="quick-actions" data-testid="quick-actions">
        {ACTIONS.map((a) =>
          a.to ? (
            <Link key={a.label} to={a.to} className="qa" data-testid={a.testId}>
              <span className="qa-icon">
                <Icon name={a.icon} size={24} />
              </span>
              <span className="qa-label">{a.label}</span>
            </Link>
          ) : (
            <button key={a.label} type="button" className="qa" onClick={() => setOpen('despesa')} data-testid={a.testId}>
              <span className="qa-icon">
                <Icon name={a.icon} size={24} />
              </span>
              <span className="qa-label">{a.label}</span>
            </button>
          ),
        )}
      </div>
      <button className="btn btn-gold btn-block quick-launch" onClick={() => setOpen('todos')} data-testid="quick-launch">
        <Icon name="plus" /> Todos os lançamentos
      </button>
      {open === 'todos' && <Sheet title="Novo lançamento" options={QUICK_OPTIONS} onClose={close} />}
      {open === 'despesa' && <Sheet title="Lançar despesa" options={EXPENSE_OPTIONS} onClose={close} />}
    </>
  )
}
