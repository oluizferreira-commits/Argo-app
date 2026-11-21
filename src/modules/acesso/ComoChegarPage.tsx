import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { newId } from '../../core/ids'
import { db } from '../../db/database'
import type { AccessOrigin, CachedRoute, GeoPoint, LandmarkKind } from '../../db/types'
import { Icon } from '../../components/Icon'
import { saveFile } from '../../platform/files'
import { useFarm } from '../fazendas/FarmContext'
import {
  addLandmark,
  addOrigin,
  buildSharePayload,
  computeRoute,
  getCachedRoute,
  LANDMARK_LABELS,
  removeLandmark,
  removeOrigin,
  setEntrance,
  shareUrl,
} from './access'
import { CoordError, formatCoordinate, parseCoordinate } from './geo'
import { GeocodeError, searchPlaces, type PlaceResult } from './geocode'
import { renderGuideImage } from './guideImage'
import { RouteMap } from './RouteMap'
import { NavigationButtons, RouteSummary } from './RouteSummary'
import { RoutingError } from './routing'

type Msg = { kind: 'ok' | 'error' | 'warn'; text: string } | null

function Notice({ msg }: { msg: Msg }) {
  if (!msg) return null
  return (
    <div className={`notice notice-${msg.kind}`} role="status">
      <Icon name={msg.kind === 'ok' ? 'check' : 'alert'} />
      <div>{msg.text}</div>
    </div>
  )
}

export function ComoChegarPage() {
  const { farm } = useFarm()
  if (!farm.entrance) return <EntranceSetup />
  return <AccessView />
}

/** 1º passo: coordenada oficial da entrada principal. */
function EntranceSetup({ onDone }: { onDone?: () => void }) {
  const { farm } = useFarm()
  const [text, setText] = useState(farm.entrance ? formatCoordinate(farm.entrance) : '')
  const [msg, setMsg] = useState<Msg>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    try {
      const p = parseCoordinate(text)
      if (farm.entrance && !window.confirm(`Substituir a coordenada da entrada principal por ${formatCoordinate(p)}?`)) return
      await setEntrance(db, farm.id, p)
      onDone?.()
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof CoordError ? err.message : (err as Error).message })
    }
  }

  return (
    <form onSubmit={save} className="stack">
      <div className="card stack">
        <div className="row">
          <div className="status-icon">
            <Icon name="pin" />
          </div>
          <div className="status-body">
            <div className="status-label">Entrada principal da fazenda</div>
            <div className="status-detail">Coordenada oficial da porteira (latitude, longitude)</div>
          </div>
        </div>
        <input
          className="input"
          aria-label="Coordenada da entrada principal"
          placeholder="Ex.: -10.123456, -48.123456"
          inputMode="text"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <p className="muted" style={{ fontSize: 14 }}>
          Cole a coordenada exatamente como foi medida na porteira. Ela é o destino oficial de todas as rotas e nunca é alterada
          automaticamente.
        </p>
        <button type="submit" className="btn btn-gold btn-block" disabled={!text.trim()}>
          <Icon name="check" /> Salvar entrada principal
        </button>
        <Notice msg={msg} />
      </div>
    </form>
  )
}

function AccessView() {
  const { farm } = useFarm()
  const entrance = farm.entrance!
  const origins = farm.accessOrigins ?? []
  const landmarks = useLiveQuery(
    async () => (await db.landmarks.where('farmId').equals(farm.id).toArray()).filter((l) => l.deletedAt === null).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [farm.id],
  )
  const [originId, setOriginId] = useState<string>(origins[0]?.id ?? '')
  const origin = origins.find((o) => o.id === originId) ?? origins[0] ?? null
  const [route, setRoute] = useState<CachedRoute | null>(null)
  const [loading, setLoading] = useState(false)
  const [routeMsg, setRouteMsg] = useState<Msg>(null)
  const [msg, setMsg] = useState<Msg>(null)
  const [editingEntrance, setEditingEntrance] = useState(false)
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<GeoPoint | null>(null)

  const load = useCallback(
    async (o: AccessOrigin, force: boolean) => {
      setRouteMsg(null)
      if (!force) {
        const cached = await getCachedRoute(db, farm, o)
        if (cached) {
          setRoute(cached)
          return
        }
      }
      setRoute(null)
      setLoading(true)
      try {
        setRoute(await computeRoute(db, farm, o))
      } catch (e) {
        setRouteMsg({ kind: 'error', text: e instanceof RoutingError || e instanceof CoordError ? e.message : (e as Error).message })
      } finally {
        setLoading(false)
      }
    },
    [farm],
  )

  useEffect(() => {
    if (origin) void load(origin, false)
    else setRoute(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin?.id, entrance.lat, entrance.lng])

  if (!landmarks) return null
  if (editingEntrance) return <EntranceSetup onDone={() => setEditingEntrance(false)} />

  const mapLandmarks = landmarks.map((l) => ({ name: l.name, kind: l.kind, note: l.note, lat: l.lat, lng: l.lng }))

  async function share() {
    setMsg(null)
    const url = shareUrl(buildSharePayload(farm, landmarks!))
    const text = `Como chegar à ${farm.name}`
    try {
      if (navigator.share) await navigator.share({ title: text, text, url })
      else {
        await navigator.clipboard.writeText(url)
        setMsg({ kind: 'ok', text: 'Link copiado.' })
      }
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') {
        try {
          await navigator.clipboard.writeText(url)
          setMsg({ kind: 'ok', text: 'Link copiado.' })
        } catch {
          setMsg({ kind: 'error', text: 'Não foi possível compartilhar o link.' })
        }
      }
    }
  }

  async function guideImage() {
    if (!route || !origin) return
    setMsg({ kind: 'ok', text: 'Gerando o guia…' })
    try {
      const blob = await renderGuideImage({
        farmName: farm.name,
        originName: `${origin.name}${origin.region ? ` - ${regionAbbr(origin.region)}` : ''}`,
        route,
        landmarks: mapLandmarks,
        shareLink: shareUrl(buildSharePayload(farm, landmarks!)),
      })
      setMsg(null)
      await saveFile(`como-chegar-${slug(origin.name)}.png`, blob, 'image/png')
    } catch (e) {
      setMsg({ kind: 'error', text: `Falha ao gerar o guia: ${(e as Error).message}. Verifique a internet (o mapa de satélite precisa dela).` })
    }
  }

  return (
    <>
      <div className="card stack">
        <div className="row">
          <div className="status-icon">
            <Icon name="pin" />
          </div>
          <div className="status-body">
            <div className="status-label">Entrada principal</div>
            <div className="status-detail" data-testid="entrance">
              {formatCoordinate(entrance)}
            </div>
          </div>
          <button className="btn btn-outline btn-icon" aria-label="Alterar entrada principal" onClick={() => setEditingEntrance(true)}>
            <Icon name="edit" size={20} />
          </button>
        </div>
      </div>

      <OriginPicker origins={origins} selected={origin?.id ?? ''} onSelect={setOriginId} />

      <RouteMap
        entrance={entrance}
        origin={origin && route ? { name: origin.name, lat: origin.lat, lng: origin.lng } : null}
        coords={route?.coords ?? null}
        landmarks={mapLandmarks}
        onPick={picking ? setPicked : undefined}
        picked={picking ? picked : null}
      />

      {picking ? (
        <LandmarkForm
          picked={picked}
          setPicked={setPicked}
          onClose={() => {
            setPicking(false)
            setPicked(null)
          }}
        />
      ) : (
        <>
          {loading && <p className="muted" style={{ textAlign: 'center' }}>Calculando a rota pelas estradas…</p>}
          <Notice msg={routeMsg} />
          {route && origin && <RouteSummary route={route} originName={origin.name} landmarks={mapLandmarks} />}
          {origin && !loading && (
            <button className="btn btn-outline btn-block" onClick={() => void load(origin, true)}>
              <Icon name="refresh" /> Recalcular rota
            </button>
          )}

          <NavigationButtons dest={entrance} />

          <h2 className="section-title">Compartilhar</h2>
          <div className="card stack">
            <button className="btn btn-gold btn-block" onClick={share}>
              <Icon name="share" /> Compartilhar página de acesso
            </button>
            <button className="btn btn-outline btn-block" onClick={guideImage} disabled={!route}>
              <Icon name="download" /> Guia de chegada (imagem para WhatsApp)
            </button>
            <p className="muted" style={{ fontSize: 14 }}>
              Quem receber o link vê o mapa, as rotas e os pontos, e pode abrir a navegação. O link contém a localização da porteira:
              compartilhe só com quem deve chegar à fazenda.
            </p>
            <Notice msg={msg} />
          </div>

          <h2 className="section-title">Pontos de referência e bifurcações</h2>
          <div className="card stack">
            {landmarks.length === 0 ? (
              <p className="muted">Nenhum ponto cadastrado. Marque bifurcações, pontes, mata-burros e referências do caminho.</p>
            ) : (
              <div>
                {landmarks.map((l, i) => (
                  <div className="task" key={l.id}>
                    <div className="status-icon" style={{ fontWeight: 800 }}>
                      {i + 1}
                    </div>
                    <div className="status-body">
                      <div className="status-label">{l.name}</div>
                      <div className="status-detail">
                        {LANDMARK_LABELS[l.kind].split(' (')[0]}
                        {l.note && ` · ${l.note}`}
                      </div>
                    </div>
                    <button
                      className="btn btn-danger btn-icon"
                      aria-label={`Remover ${l.name}`}
                      onClick={() => window.confirm(`Remover o ponto "${l.name}"?`) && removeLandmark(db, l.id)}
                    >
                      <Icon name="trash" size={20} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button className="btn btn-primary btn-block" onClick={() => setPicking(true)}>
              <Icon name="plus" /> Adicionar ponto
            </button>
          </div>
        </>
      )}
    </>
  )
}

function OriginPicker({ origins, selected, onSelect }: { origins: AccessOrigin[]; selected: string; onSelect: (id: string) => void }) {
  const { farm } = useFarm()
  const [adding, setAdding] = useState(origins.length === 0)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<PlaceResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  async function search(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    setBusy(true)
    try {
      const r = await searchPlaces(q)
      setResults(r)
      if (r.length === 0) setMsg({ kind: 'warn', text: 'Nenhuma cidade encontrada. Tente "Nome da cidade, Estado".' })
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof GeocodeError ? err.message : (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  async function add(p: PlaceResult) {
    try {
      const f = await addOrigin(db, farm, { name: p.name, region: p.region, lat: p.lat, lng: p.lng, osm: p.osm })
      const created = f.accessOrigins?.at(-1)
      if (created) onSelect(created.id)
      setAdding(false)
      setQ('')
      setResults(null)
    } catch (err) {
      setMsg({ kind: 'error', text: (err as Error).message })
    }
  }

  const current = origins.find((o) => o.id === selected)

  return (
    <div className="card stack">
      <div className="label">Saindo de</div>
      {origins.length > 0 && (
        <div className="chips" role="tablist">
          {origins.map((o) => (
            <button key={o.id} type="button" role="tab" aria-selected={o.id === selected} className={`chip${o.id === selected ? ' active' : ''}`} onClick={() => onSelect(o.id)}>
              {o.name}
            </button>
          ))}
        </div>
      )}
      {adding ? (
        <form onSubmit={search} className="stack">
          <div className="row">
            <input className="input" aria-label="Buscar cidade" placeholder="Ex.: Redenção, PA" value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="submit" className="btn btn-primary" disabled={busy || q.trim().length < 3}>
              {busy ? '…' : 'Buscar'}
            </button>
          </div>
          {results && results.length > 0 && (
            <div>
              {results.map((r) => (
                <button key={r.osm} type="button" className="list-link" style={{ width: '100%', background: 'none', border: 0, textAlign: 'left' }} onClick={() => add(r)}>
                  <div className="status-body">
                    <div className="status-label">{r.name}</div>
                    <div className="status-detail">
                      {r.region || 'Brasil'} · {r.kind}
                    </div>
                  </div>
                  <Icon name="plus" size={20} />
                </button>
              ))}
            </div>
          )}
          {origins.length > 0 && (
            <button type="button" className="btn btn-outline btn-block" onClick={() => setAdding(false)}>
              Cancelar
            </button>
          )}
        </form>
      ) : (
        <div className="row">
          <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setAdding(true)}>
            <Icon name="plus" /> Cidade
          </button>
          {current && (
            <button
              type="button"
              className="btn btn-danger"
              aria-label={`Remover ${current.name}`}
              onClick={() => window.confirm(`Remover ${current.name} das cidades de origem?`) && removeOrigin(db, farm, current.id)}
            >
              <Icon name="trash" size={20} />
            </button>
          )}
        </div>
      )}
      <Notice msg={msg} />
    </div>
  )
}

function LandmarkForm({ picked, setPicked, onClose }: { picked: GeoPoint | null; setPicked: (p: GeoPoint) => void; onClose: () => void }) {
  const { farm } = useFarm()
  const [key] = useState(newId)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<LandmarkKind>('referencia')
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState<Msg>(null)
  const [saving, setSaving] = useState(false)

  function useMyLocation() {
    if (!navigator.geolocation) return setMsg({ kind: 'error', text: 'Localização indisponível neste aparelho.' })
    setMsg({ kind: 'ok', text: 'Obtendo localização…' })
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPicked({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setMsg({ kind: 'ok', text: `Localização obtida (precisão de ${Math.round(pos.coords.accuracy)} m).` })
      },
      () => setMsg({ kind: 'error', text: 'Não foi possível obter a localização. Permita o acesso à localização ou toque no mapa.' }),
      { enableHighAccuracy: true, timeout: 20000 },
    )
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!picked) return setMsg({ kind: 'error', text: 'Toque no mapa para marcar o local (ou use sua localização).' })
    setSaving(true)
    try {
      await addLandmark(db, farm, { name, kind, note, lat: picked.lat, lng: picked.lng }, key)
      onClose()
    } catch (err) {
      setMsg({ kind: 'error', text: (err as Error).message })
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="card stack">
      <div className="notice notice-warn">
        <Icon name="crosshair" />
        <div>
          <strong>Toque no mapa</strong> no local exato do ponto (use o zoom no satélite) ou use sua localização se estiver no lugar.
        </div>
      </div>
      <button type="button" className="btn btn-outline btn-block" onClick={useMyLocation}>
        <Icon name="navigate" /> Usar minha localização
      </button>
      {picked && <p className="muted">Local marcado: {formatCoordinate(picked)}</p>}
      <div className="field">
        <label className="label" htmlFor="lm-kind">
          Tipo
        </label>
        <select id="lm-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as LandmarkKind)}>
          {(Object.keys(LANDMARK_LABELS) as LandmarkKind[]).map((k) => (
            <option key={k} value={k}>
              {LANDMARK_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="label" htmlFor="lm-name">
          Nome
        </label>
        <input id="lm-name" className="input" value={name} maxLength={60} placeholder="Ex.: Bifurcação após a ponte" onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label className="label" htmlFor="lm-note">
          Instrução (opcional)
        </label>
        <input id="lm-note" className="input" value={note} maxLength={200} placeholder="Ex.: siga à direita" onChange={(e) => setNote(e.target.value)} />
      </div>
      <Notice msg={msg} />
      <button type="submit" className="btn btn-gold btn-block" disabled={saving || !name.trim() || !picked}>
        <Icon name="check" /> Salvar ponto
      </button>
      <button type="button" className="btn btn-outline btn-block" onClick={onClose}>
        Cancelar
      </button>
    </form>
  )
}

const UF: Record<string, string> = {
  Acre: 'AC', Alagoas: 'AL', Amapá: 'AP', Amazonas: 'AM', Bahia: 'BA', Ceará: 'CE', 'Distrito Federal': 'DF', 'Espírito Santo': 'ES', Goiás: 'GO',
  Maranhão: 'MA', 'Mato Grosso': 'MT', 'Mato Grosso do Sul': 'MS', 'Minas Gerais': 'MG', Pará: 'PA', Paraíba: 'PB', Paraná: 'PR', Pernambuco: 'PE',
  Piauí: 'PI', 'Rio de Janeiro': 'RJ', 'Rio Grande do Norte': 'RN', 'Rio Grande do Sul': 'RS', Rondônia: 'RO', Roraima: 'RR', 'Santa Catarina': 'SC',
  'São Paulo': 'SP', Sergipe: 'SE', Tocantins: 'TO',
}

function regionAbbr(region: string): string {
  return UF[region] ?? region
}

function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
