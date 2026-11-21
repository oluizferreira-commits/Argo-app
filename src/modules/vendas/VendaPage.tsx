import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { formatMoney } from '../../core/money'
import { db } from '../../db/database'
import { Icon } from '../../components/Icon'
import { saveFile } from '../../platform/files'
import { useFarm } from '../fazendas/FarmContext'
import { formatDay } from '../rebanho/herd'
import { usePastureMap } from '../rebanho/useHerd'
import { PAYMENT_LABEL, renderReceipt, salePixPayload } from './receipt'
import { cancelSale, formatSaleNumber, SaleError } from './sales'

export function VendaPage() {
  const { id = '' } = useParams()
  const location = useLocation()
  const justSaved = (location.state as { saved?: boolean } | null)?.saved === true
  const { farm } = useFarm()
  const sale = useLiveQuery(() => db.sales.get(id), [id])
  const client = useLiveQuery(async () => (sale ? ((await db.clients.get(sale.clientId)) ?? null) : undefined), [sale?.clientId])
  const pastures = usePastureMap()
  const [installment, setInstallment] = useState(0)
  const [image, setImage] = useState<{ url: string; blob: Blob } | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!sale || !client) return
    let url = ''
    let alive = true
    renderReceipt({ sale, farm, client, pastures, installmentIndex: installment })
      .then((blob) => {
        if (!alive) return
        url = URL.createObjectURL(blob)
        setImage({ url, blob })
      })
      .catch((e) => setMsg({ kind: 'error', text: `Falha ao gerar o comprovante: ${(e as Error).message}` }))
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [sale, client, farm, pastures, installment])

  if (sale === undefined || client === undefined) return null
  if (!sale || sale.farmId !== farm.id || !client) return <div className="card empty">Venda não encontrada.</div>

  const fileName = `argo-venda-${formatSaleNumber(sale.number)}.png`
  const pix = sale.status === 'ativa' ? salePixPayload(sale, farm, installment) : null

  async function share() {
    if (!image) return
    await saveFile(fileName, image.blob, 'image/png')
  }

  async function copyPix() {
    if (!pix) return
    try {
      await navigator.clipboard.writeText(pix)
      setMsg({ kind: 'ok', text: 'Pix copia e cola copiado. Cole no WhatsApp ou no app do banco.' })
    } catch {
      setMsg({ kind: 'error', text: 'Não foi possível copiar. Compartilhe o comprovante com o QR Code.' })
    }
  }

  async function cancel() {
    const reason = window.prompt(`Cancelar a venda nº ${formatSaleNumber(sale!.number)}?\n\nOs animais voltam para o rebanho. Informe o motivo:`)
    if (reason === null) return
    setBusy(true)
    try {
      await cancelSale(db, sale!.id, reason)
      setMsg({ kind: 'ok', text: 'Venda cancelada. Os animais voltaram para o rebanho.' })
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof SaleError || e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {justSaved && (
        <div className="notice notice-ok" role="status">
          <Icon name="check" />
          <div>Venda registrada e animais baixados do rebanho.</div>
        </div>
      )}

      <div className="card stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="status-label" style={{ fontSize: 19 }}>
              Venda nº {formatSaleNumber(sale.number)}
            </div>
            <div className="status-detail">
              {client.name} · {formatDay(sale.date)} · {PAYMENT_LABEL[sale.paymentKind]}
            </div>
          </div>
          {sale.status === 'cancelada' ? <span className="badge badge-warn">Cancelada</span> : <span className="num">{formatMoney(sale.totalCents)}</span>}
        </div>
        {sale.status === 'cancelada' && sale.cancelReason && <p className="muted">Motivo do cancelamento: {sale.cancelReason}</p>}
      </div>

      {!farm.pixKey && sale.status === 'ativa' && (
        <Link to="/fazenda" className="notice notice-warn" style={{ textDecoration: 'none' }}>
          <Icon name="alert" />
          <div>
            Cadastre a <strong>chave Pix da fazenda</strong> para o comprovante sair com QR Code. Toque aqui.
          </div>
        </Link>
      )}

      {sale.installments.length > 1 && pix && (
        <div className="card">
          <label className="label" htmlFor="v-inst">
            QR Code Pix da parcela
          </label>
          <select id="v-inst" className="input" value={installment} onChange={(e) => setInstallment(Number(e.target.value))}>
            {sale.installments.map((p, i) => (
              <option key={i} value={i}>
                Parcela {i + 1} · {formatDay(p.due)} · {formatMoney(p.amountCents)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="card" style={{ padding: 8 }}>
        {image ? (
          <img src={image.url} alt={`Comprovante da venda nº ${formatSaleNumber(sale.number)}`} style={{ width: '100%', display: 'block', borderRadius: 10 }} data-testid="receipt" />
        ) : (
          <p className="muted" style={{ padding: 20, textAlign: 'center' }}>
            Gerando comprovante…
          </p>
        )}
      </div>

      <button className="btn btn-gold btn-block" onClick={share} disabled={!image}>
        <Icon name="upload" /> Compartilhar comprovante
      </button>
      {pix && (
        <button className="btn btn-outline btn-block" onClick={copyPix}>
          <Icon name="clipboard" /> Copiar Pix copia e cola
        </button>
      )}
      {msg && (
        <div className={`notice notice-${msg.kind}`} role="status">
          <Icon name={msg.kind === 'ok' ? 'check' : 'alert'} />
          <div>{msg.text}</div>
        </div>
      )}
      <Link to={`/rebanho/movimentacao/${sale.movementId}`} className="btn btn-outline btn-block">
        <Icon name="herd" /> Ver saída no rebanho
      </Link>
      {sale.status === 'ativa' && (
        <button className="btn btn-danger btn-block" onClick={cancel} disabled={busy}>
          <Icon name="undo" /> Cancelar venda
        </button>
      )}
    </>
  )
}
