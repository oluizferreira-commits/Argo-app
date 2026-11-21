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
  { label: 'Registrar animal', detail: 'Nascimento, compra, morte, transferência ou contagem', icon: 'herd', to: '/rebanho/movimentar' },
  { label: 'Registrar despesa', detail: 'Em breve. Compras de diesel e de insumos já contam como despesa', icon: 'wallet', to: null },
  { label: 'Registrar receita', detail: 'Venda de gado (por arroba ou por cabeça)', icon: 'cash', to: '/vendas/nova' },
  { label: 'Entrada ou saída de estoque', detail: 'Sal, mistura e outros insumos', icon: 'sack', to: '/insumos' },
  { label: 'Compra de combustível', detail: 'Diesel: posto, litros e valor', icon: 'fuel', to: '/diesel?novo=compra' },
  { label: 'Consumo de combustível', detail: 'Abastecimento de equipamento', icon: 'fuel', to: '/diesel?novo=consumo' },
  { label: 'Registrar vacinação', detail: 'Em breve (próxima etapa)', icon: 'syringe', to: null },
  { label: 'Registrar pesagem', detail: 'Em breve. Hoje a pesagem é feita dentro da venda por arroba', icon: 'scale', to: null },
  { label: 'Registrar manutenção', detail: 'Em breve', icon: 'gear', to: null },
  { label: 'Criar tarefa', detail: 'Escolha o pasto e anote o serviço', icon: 'clipboard', to: '/pastos' },
]

export function QuickLaunch() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  return (
    <>
      <button className="btn btn-gold btn-block quick-launch" onClick={() => setOpen(true)} data-testid="quick-launch">
        <Icon name="plus" /> Novo lançamento
      </button>
      {open && (
        <div className="sheet-backdrop" onClick={() => setOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Novo lançamento" onClick={(e) => e.stopPropagation()} data-testid="quick-sheet">
            <div className="sheet-head">
              <strong>Novo lançamento</strong>
              <button className="btn btn-outline btn-icon" aria-label="Fechar" onClick={() => setOpen(false)}>
                <Icon name="chevronLeft" size={20} />
              </button>
            </div>
            <div className="module-list sheet-list">
              {QUICK_OPTIONS.map((o) =>
                o.to ? (
                  <Link key={o.label} to={o.to} onClick={() => setOpen(false)}>
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
      )}
    </>
  )
}
