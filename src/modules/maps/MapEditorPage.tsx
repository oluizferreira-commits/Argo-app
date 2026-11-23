import type L from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { newId } from '../../core/ids'
import { db } from '../../db/database'
import type { MapShape } from '../../db/types'
import { Icon } from '../../components/Icon'
import { useOnline } from '../../hooks/useOnline'
import { searchPlaces, type PlaceResult } from '../acesso/geocode'
import { useFarm } from '../fazendas/FarmContext'
import { verifyPin } from '../fazendas/farms'
import { createPasture } from '../pastos/pastures'
import { formatHa, formatMeters, fromGeometry, parseCoordinates, RING_PROBLEM_TEXT, type Ring } from './geo'
import { drawShapes, initialView, MAP_COLORS, shapesBounds } from './layers'
import { MapCanvas, type BaseLayer } from './MapCanvas'
import { confirmMapping, removeShape, reviewMapping, saveShape, saveView, applyMapArea } from './mapping'
import { useMapData } from './useMapData'
import { useRingEditor } from './useRingEditor'

type Step = 'local' | 'perimetro' | 'pastos' | 'estruturas' | 'revisao'
const STEPS: { id: Step; label: string }[] = [
  { id: 'local', label: 'Local' },
  { id: 'perimetro', label: 'Perímetro' },
  { id: 'pastos', label: 'Pastos' },
  { id: 'estruturas', label: 'Estruturas' },
  { id: 'revisao', label: 'Revisão' },
]

/** O que está sendo desenhado na etapa Pastos. */
interface Draft {
  id?: string
  rev?: number
  kind: 'pasto' | 'nao-produtiva'
  /** pasto do cadastro, ou 'novo' */
  pastureId: string
  newName: string
  name: string
}

/** Assistente de mapeamento: Local → Perímetro → Pastos → (Estruturas) → Revisão e confirmação. */
export function MapEditorPage() {
  const { farm } = useFarm()
  const d = useMapData()
  const online = useOnline()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const step = (STEPS.find((s) => s.id === params.get('etapa'))?.id ?? (d?.shapes.length ? 'pastos' : 'local')) as Step
  const go = (s: Step) => setParams({ etapa: s }, { replace: true })
  const [map, setMap] = useState<L.Map | null>(null)
  const [base, setBase] = useState<BaseLayer>('satelite')
  const effectiveBase: BaseLayer = online ? base : 'desenho'
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const perimeter = d?.shapes.find((s) => s.kind === 'perimetro') ?? null
  const drawing = step === 'perimetro' || (step === 'pastos' && draft !== null)
  const editingId = step === 'perimetro' ? (perimeter?.id ?? null) : (draft?.id ?? null)
  const targets = useMemo<Ring[]>(() => (d ? d.shapes.filter((s) => s.id !== editingId).map((s) => fromGeometry(s.geometry)) : []), [d, editingId])
  const editor = useRingEditor(map, { active: drawing, initial: [], targets, color: step === 'perimetro' ? MAP_COLORS.perimetro : MAP_COLORS.selecionado })

  // ao entrar no perímetro, carrega o desenho existente para editar
  const { reset } = editor
  useEffect(() => {
    if (step === 'perimetro') reset(perimeter ? fromGeometry(perimeter.geometry) : [])
    // só ao mudar de etapa
  }, [step, reset]) // eslint-disable-line react-hooks/exhaustive-deps

  // contornos já salvos (esmaecidos quando desenhando)
  const views = d?.views
  useEffect(() => {
    if (!map || !views) return
    const shown = views.filter((v) => v.shape.id !== editingId || !drawing)
    const g = drawShapes(map, shown, { dim: drawing, labels: !drawing || step === 'pastos', onSelect: step === 'pastos' && !drawing ? (id) => startEdit(views.find((v) => v.shape.id === id)!.shape) : undefined })
    return () => {
      g.remove()
    }
  }, [map, views, drawing, editingId, step]) // eslint-disable-line react-hooks/exhaustive-deps

  const framed = useRef(false)
  useEffect(() => {
    if (!map || !views || framed.current) return
    const b = shapesBounds(views)
    if (b) map.fitBounds(b, { padding: [24, 24] })
    framed.current = true
  }, [map, views])

  if (!d) return <div className="argo-loading">Carregando o mapa</div>

  const view = initialView(d.farmMap, farm.entrance)
  const drawnPastures = new Set(d.shapes.filter((s) => s.kind === 'pasto').map((s) => s.pastureId))

  function startEdit(s: MapShape) {
    setError(null)
    setDraft({ id: s.id, rev: s.rev, kind: s.kind === 'nao-produtiva' ? 'nao-produtiva' : 'pasto', pastureId: s.pastureId ?? '', newName: '', name: s.name })
    editor.reset(fromGeometry(s.geometry))
  }
  function startNew(kind: Draft['kind']) {
    setError(null)
    const free = d!.pastures.find((p) => !drawnPastures.has(p.id))
    setDraft({ kind, pastureId: kind === 'pasto' ? (free?.id ?? 'novo') : '', newName: '', name: '' })
    editor.reset([])
  }

  async function run(fn: () => Promise<unknown>) {
    setError(null)
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const savePerimeter = () =>
    run(async () => {
      await saveShape(db, farm.id, { id: perimeter?.id, kind: 'perimetro', pastureId: null, name: '', ring: editor.ring, expectedRev: perimeter?.rev }, newId())
      go('pastos')
    })

  const saveDraft = () =>
    run(async () => {
      if (!draft) return
      let pastureId: string | null = null
      if (draft.kind === 'pasto') {
        // valida o desenho antes de criar o pasto novo no cadastro
        if (editor.problem) throw new Error(RING_PROBLEM_TEXT[editor.problem])
        if (draft.pastureId === 'novo') {
          if (!draft.newName.trim()) throw new Error('Escreva o nome do pasto novo.')
          pastureId = (await createPasture(db, farm.id, { name: draft.newName, areaHa: editor.centiHa / 100, notes: '' })).id
        } else pastureId = draft.pastureId
      }
      await saveShape(db, farm.id, { id: draft.id, kind: draft.kind, pastureId, name: draft.name, ring: editor.ring, expectedRev: draft.rev }, draft.id ? undefined : newId())
      setDraft(null)
      editor.reset([])
    })

  return (
    <div className="maps-screen editor">
      <ol className="steps" aria-label="Etapas do mapeamento">
        {STEPS.map((s, i) => (
          <li key={s.id}>
            <button type="button" className={s.id === step ? 'on' : ''} aria-current={s.id === step ? 'step' : undefined} onClick={() => (setDraft(null), go(s.id))} data-testid={`step-${s.id}`}>
              <i>{i + 1}</i>
              {s.label}
            </button>
          </li>
        ))}
      </ol>

      <div className="maps-stage">
        <MapCanvas base={effectiveBase} center={view.center} zoom={view.zoom} onReady={setMap} testId="editor-map" />
        <div className="maps-fabs">
          <button type="button" className="round-btn" aria-label={effectiveBase === 'satelite' ? 'Ver só o desenho' : 'Ver satélite'} disabled={!online} onClick={() => setBase(effectiveBase === 'satelite' ? 'desenho' : 'satelite')}>
            <Icon name="layers" size={22} />
          </button>
        </div>
        {drawing && <div className="maps-hint">Toque no mapa para marcar os cantos. Arraste um ponto para ajustar; “+” no meio de um lado cria ponto.</div>}
        {!online && <div className="maps-offline">Sem internet: sem imagem de satélite. Dá para ajustar os desenhos já feitos.</div>}
      </div>

      <section className="maps-panel" data-testid={`panel-${step}`}>
        {step === 'local' && <LocalStep map={map} onDone={() => go('perimetro')} />}

        {step === 'perimetro' && (
          <>
            <h2 className="maps-panel-title">Perímetro da fazenda</h2>
            <p className="muted">Contorne a divisa da propriedade, ponto por ponto. O contorno fecha sozinho.</p>
            <DrawTools editor={editor} />
            {error && <div className="notice notice-error">{error}</div>}
            <button type="button" className="btn btn-gold btn-block" disabled={busy || editor.problem !== null} onClick={() => void savePerimeter()} data-testid="save-perimeter">
              <Icon name="check" /> Salvar perímetro
            </button>
          </>
        )}

        {step === 'pastos' &&
          (draft ? (
            <>
              <h2 className="maps-panel-title">{draft.id ? 'Editar contorno' : draft.kind === 'pasto' ? 'Novo pasto no mapa' : 'Área não produtiva'}</h2>
              {draft.kind === 'pasto' ? (
                <div className="field" style={{ margin: 0 }}>
                  <label className="label" htmlFor="mp-pasture">
                    Pasto do cadastro
                  </label>
                  <select id="mp-pasture" className="input" value={draft.pastureId} onChange={(e) => setDraft({ ...draft, pastureId: e.target.value })} disabled={Boolean(draft.id)}>
                    {d.pastures
                      .filter((p) => !drawnPastures.has(p.id) || p.id === draft.pastureId)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    {!draft.id && <option value="novo">+ Criar pasto novo</option>}
                  </select>
                  {draft.pastureId === 'novo' && (
                    <input className="input" style={{ marginTop: 8 }} aria-label="Nome do pasto novo" placeholder="Nome do pasto novo" maxLength={60} value={draft.newName} onChange={(e) => setDraft({ ...draft, newName: e.target.value })} />
                  )}
                </div>
              ) : (
                <input className="input" aria-label="Nome da área" placeholder="Ex.: Reserva legal, Sede, Represa" maxLength={60} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              )}
              <DrawTools editor={editor} />
              {error && <div className="notice notice-error">{error}</div>}
              <div className="row">
                <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => (setDraft(null), editor.reset([]))}>
                  Cancelar
                </button>
                <button type="button" className="btn btn-gold" style={{ flex: 1 }} disabled={busy || editor.problem !== null} onClick={() => void saveDraft()} data-testid="save-shape">
                  <Icon name="check" /> Salvar
                </button>
              </div>
              {draft.id && (
                <button
                  type="button"
                  className="btn btn-danger btn-block"
                  onClick={() => {
                    if (window.confirm('Apagar este contorno do mapa? O pasto do cadastro e os animais não são apagados.'))
                      void run(async () => {
                        await removeShape(db, draft.id!)
                        setDraft(null)
                        editor.reset([])
                      })
                  }}
                >
                  <Icon name="trash" /> Apagar contorno
                </button>
              )}
            </>
          ) : (
            <PastureList d={d} onNew={startNew} onEdit={startEdit} onNext={() => go('estruturas')} />
          ))}

        {step === 'estruturas' && (
          <>
            <h2 className="maps-panel-title">Estruturas</h2>
            <div className="notice notice-warn">
              <Icon name="clock" />
              <div>
                <strong>Em breve.</strong> Sede, currais, cochos, porteiras, açudes, cercas e estradas entram numa próxima fase do ARGO Maps. Por enquanto, áreas como sede e represa podem ser desenhadas como “área não produtiva”.
              </div>
            </div>
            <button type="button" className="btn btn-gold btn-block" onClick={() => go('revisao')}>
              Ir para a revisão
            </button>
          </>
        )}

        {step === 'revisao' && <ReviewStep d={d} needsPin={Boolean(farm.pinHash)} onConfirmed={() => navigate('/maps', { replace: true })} />}
      </section>
    </div>
  )
}

function DrawTools({ editor }: { editor: ReturnType<typeof useRingEditor> }) {
  return (
    <>
      <div className="draw-stats" data-testid="draw-stats">
        <span>
          <b>{editor.ring.length}</b> pontos
        </span>
        <span>
          <b data-testid="draw-area">{formatHa(editor.centiHa)}</b> área
        </span>
        <span>
          <b>{formatMeters(editor.perimeterM)}</b> perímetro
        </span>
      </div>
      {editor.ring.length > 0 && editor.problem && <div className="draw-problem">{RING_PROBLEM_TEXT[editor.problem]}</div>}
      <div className="draw-tools">
        <button type="button" className="btn btn-outline" disabled={!editor.canUndo} onClick={editor.undo} aria-label="Desfazer">
          <Icon name="undo" size={20} />
        </button>
        <button type="button" className="btn btn-outline" disabled={!editor.canRedo} onClick={editor.redo} aria-label="Refazer">
          <Icon name="redo" size={20} />
        </button>
        <button type="button" className="btn btn-outline" disabled={editor.selected === null} onClick={editor.removeSelected} data-testid="remove-vertex">
          <Icon name="trash" size={20} /> Ponto
        </button>
        <button
          type="button"
          className="btn btn-outline"
          disabled={!editor.ring.length}
          onClick={() => {
            if (window.confirm('Apagar todos os pontos deste contorno?')) editor.clear()
          }}
        >
          Limpar
        </button>
      </div>
    </>
  )
}

function LocalStep({ map, onDone }: { map: L.Map | null; onDone: () => void }) {
  const { farm } = useFarm()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<PlaceResult[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function search() {
    setMsg(null)
    const coords = parseCoordinates(q)
    if (coords) {
      map?.setView([coords[1], coords[0]], 16)
      setResults([])
      return
    }
    setBusy(true)
    try {
      const r = await searchPlaces(q)
      setResults(r.slice(0, 5))
      if (!r.length) setMsg('Nada encontrado. Tente o nome da cidade ou as coordenadas (ex.: -10,1234 -48,5678).')
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h2 className="maps-panel-title">Onde fica a fazenda?</h2>
      <p className="muted">Procure a cidade ou digite as coordenadas. Depois aproxime com dois dedos até ver a fazenda e confirme.</p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          void search()
        }}
      >
        <input className="input" aria-label="Cidade, endereço ou coordenadas" placeholder="Cidade ou coordenadas" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn btn-primary btn-icon" style={{ minHeight: 56, width: 56, flex: 'none' }} aria-label="Procurar" disabled={busy || q.trim().length < 3}>
          <Icon name="search" />
        </button>
      </form>
      {results.length > 0 && (
        <div className="card module-list" style={{ padding: '4px 14px' }}>
          {results.map((r) => (
            <button key={r.osm} type="button" className="list-link" style={{ width: '100%', background: 'none', border: 0, textAlign: 'left', color: 'inherit', font: 'inherit' }} onClick={() => (map?.setView([r.lat, r.lng], 13), setResults([]))}>
              <span className="status-body">
                <span className="status-label">{r.name}</span>
                <span className="status-detail"> {r.region}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {msg && <p className="muted">{msg}</p>}
      <div className="row">
        {farm.entrance && (
          <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => map?.setView([farm.entrance!.lat, farm.entrance!.lng], 16)}>
            <Icon name="pin" size={20} /> Entrada
          </button>
        )}
        <button
          type="button"
          className="btn btn-outline"
          style={{ flex: 1 }}
          onClick={() =>
            navigator.geolocation?.getCurrentPosition(
              (p) => map?.setView([p.coords.latitude, p.coords.longitude], 16),
              () => setMsg('Não consegui a sua localização. Libere em Ajustes › Privacidade › Localização.'),
              { enableHighAccuracy: true, timeout: 20000 },
            )
          }
        >
          <Icon name="crosshair" size={20} /> Estou aqui
        </button>
      </div>
      <button
        type="button"
        className="btn btn-gold btn-block"
        disabled={!map}
        data-testid="confirm-view"
        onClick={() => {
          if (!map) return
          const c = map.getCenter()
          void saveView(db, farm.id, { lat: c.lat, lng: c.lng }, map.getZoom()).then(onDone)
        }}
      >
        <Icon name="check" /> A fazenda está no centro do mapa
      </button>
    </>
  )
}

function PastureList({ d, onNew, onEdit, onNext }: { d: NonNullable<ReturnType<typeof useMapData>>; onNew: (k: Draft['kind']) => void; onEdit: (s: MapShape) => void; onNext: () => void }) {
  const review = reviewMapping(d.shapes, d.pastures)
  return (
    <>
      <h2 className="maps-panel-title">Pastos e áreas</h2>
      {!review.perimeter && <div className="notice notice-warn">Desenhe primeiro o perímetro (etapa 2) para conferir as áreas.</div>}
      <div className="draw-stats">
        <span>
          <b>{review.perimeter ? formatHa(review.perimeter.areaCentiHa) : '—'}</b> fazenda
        </span>
        <span>
          <b>{formatHa(review.mappedCentiHa)}</b> desenhado
        </span>
        <span>
          <b data-testid="unassigned">{review.unassignedCentiHa === null ? '—' : formatHa(review.unassignedCentiHa)}</b> sem pasto
        </span>
      </div>
      {(review.pastures.length > 0 || review.otherAreas.length > 0) && (
        <div className="card shape-list">
          {[...review.pastures.map((x) => x.shape), ...review.otherAreas].map((s) => {
            const v = d.views.find((x) => x.shape.id === s.id)!
            return (
              <button key={s.id} type="button" className="shape-row" onClick={() => onEdit(s)} data-testid="shape-row">
                <i style={{ background: s.kind === 'pasto' ? MAP_COLORS.pastoComAnimais : MAP_COLORS.naoProdutiva }} />
                <span className="status-body">
                  <span className="status-label">{v.label}</span>
                  <span className="status-detail">
                    {formatHa(s.areaCentiHa)} · {formatMeters(s.perimeterM)}
                    {s.kind === 'nao-produtiva' ? ' · não produtiva' : ''}
                  </span>
                </span>
                <Icon name="edit" size={18} className="muted" />
              </button>
            )
          })}
        </div>
      )}
      {review.notDrawn.length > 0 && <p className="muted">Ainda sem desenho: {review.notDrawn.map((p) => p.name).join(', ')}.</p>}
      <div className="row">
        <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={() => onNew('pasto')} data-testid="new-pasture-shape">
          <Icon name="plus" size={20} /> Pasto
        </button>
        <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => onNew('nao-produtiva')} data-testid="new-area-shape">
          <Icon name="plus" size={20} /> Área não produtiva
        </button>
      </div>
      <button type="button" className="btn btn-gold btn-block" onClick={onNext}>
        Continuar
      </button>
    </>
  )
}

function ReviewStep({ d, needsPin, onConfirmed }: { d: NonNullable<ReturnType<typeof useMapData>>; needsPin: boolean; onConfirmed: () => void }) {
  const { farm } = useFarm()
  const review = reviewMapping(d.shapes, d.pastures)
  const [ok, setOk] = useState(false)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setError(null)
    if (!ok) return setError('Marque a confirmação.')
    if (needsPin && !(await verifyPin(farm, pin))) return setError('PIN incorreto.')
    setBusy(true)
    try {
      await confirmMapping(db, farm.id, d.pastures)
      onConfirmed()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h2 className="maps-panel-title">Revisão do mapeamento</h2>
      <dl className="kv">
        <dt>Área total (perímetro)</dt>
        <dd data-testid="review-total">{review.perimeter ? formatHa(review.perimeter.areaCentiHa) : '—'}</dd>
        <dt>Perímetro</dt>
        <dd>{review.perimeter ? formatMeters(review.perimeter.perimeterM) : '—'}</dd>
        <dt>Pastos desenhados</dt>
        <dd>{review.pastures.length}</dd>
        <dt>Áreas não produtivas</dt>
        <dd>{formatHa(review.otherAreas.reduce((a, s) => a + s.areaCentiHa, 0))}</dd>
        <dt>Sem pasto atribuído</dt>
        <dd>{review.unassignedCentiHa === null ? '—' : formatHa(review.unassignedCentiHa)}</dd>
      </dl>
      {review.pastures.length > 0 && (
        <div className="card shape-list" data-testid="review-pastures">
          {review.pastures.map(({ shape, pasture }) => {
            const cad = pasture?.areaHa != null ? Math.round(pasture.areaHa * 100) : null
            return (
              <div key={shape.id} className="shape-row">
                <span className="status-body">
                  <span className="status-label">{pasture?.name ?? 'Pasto removido'}</span>
                  <span className="status-detail">
                    Mapa {formatHa(shape.areaCentiHa)} · Cadastro {cad === null ? 'não informado' : formatHa(cad)}
                  </span>
                </span>
                {pasture && cad !== shape.areaCentiHa && (
                  <button type="button" className="chip" onClick={() => void applyMapArea(db, pasture.id, shape.areaCentiHa)}>
                    Usar área do mapa
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
      {review.warnings.length > 0 ? (
        <div className="notice notice-warn" data-testid="review-warnings">
          <Icon name="alert" />
          <ul className="plain-list">
            {review.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="notice notice-ok">
          <Icon name="check" />
          <div>Nenhum alerta de geometria.</div>
        </div>
      )}
      {review.notDrawn.length > 0 && <p className="muted">Pastos do cadastro ainda sem desenho: {review.notDrawn.map((p) => p.name).join(', ')}.</p>}
      <p className="muted" style={{ fontSize: 13 }}>
        As áreas são estimativas cartográficas calculadas a partir do desenho sobre a imagem de satélite. Não são georreferenciamento legal (CAR, SIGEF) nem levantamento topográfico certificado.
      </p>
      <label className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} style={{ width: 22, height: 22, marginTop: 2 }} data-testid="confirm-check" />
        <span>Conferi o desenho e confirmo que ele representa a minha fazenda.</span>
      </label>
      {needsPin && <input className="input" type="password" inputMode="numeric" autoComplete="off" maxLength={6} aria-label="PIN da fazenda" placeholder="PIN da fazenda" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />}
      {error && <div className="notice notice-error">{error}</div>}
      <button type="button" className="btn btn-gold btn-block" disabled={busy || !review.canConfirm} onClick={() => void confirm()} data-testid="confirm-mapping">
        <Icon name="check" /> Confirmar e salvar versão {(d.farmMap?.version ?? 0) + 1}
      </button>
      {d.versions.length > 0 && (
        <p className="muted" style={{ fontSize: 13 }}>
          Versões confirmadas: {d.versions.map((v) => `v${v.version} (${v.confirmedAt.slice(8, 10)}/${v.confirmedAt.slice(5, 7)})`).join(' · ')}
        </p>
      )}
    </>
  )
}
