import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { newId } from '../../core/ids'
import { db } from '../../db/database'
import type { PastureTask } from '../../db/types'
import { Icon } from '../../components/Icon'
import { useFarm } from '../fazendas/FarmContext'
import { removeTask } from '../pastos/pastures'
import { todayLocal } from '../rebanho/herd'
import { usePastures } from '../rebanho/useHerd'
import { useResponsibles } from '../responsaveis/useResponsibles'
import { isIOS, listen, preferKeyboardDictation, speechSupported, type SpeechFailure } from './speech'
import { createTask } from './tasks'
import { parseSpokenTask, type SpokenTask } from './voice'

type SpeechEvent = { t: 'partial'; text: string } | { t: 'final'; text: string } | { t: 'fail'; reason: SpeechFailure }

/** Liga o reconhecimento DENTRO do toque (o iPhone só libera o microfone num gesto) e repassa os eventos à tela. */
function startSession(): { stop: () => void; subscribe: (fn: (e: SpeechEvent) => void) => () => void } {
  let last: SpeechEvent | null = null
  let fn: ((e: SpeechEvent) => void) | null = null
  const emit = (e: SpeechEvent) => {
    last = e
    fn?.(e)
  }
  const stop = listen({
    onPartial: (text) => emit({ t: 'partial', text }),
    onFinal: (text) => emit({ t: 'final', text }),
    onFail: (reason) => emit({ t: 'fail', reason }),
  })
  return {
    stop,
    subscribe(f) {
      fn = f
      if (last) f(last)
      return () => {
        fn = null
      }
    },
  }
}

type Session = ReturnType<typeof startSession>

type Mode = { k: 'ouvindo'; heard: string } | { k: 'digitar'; reason: SpeechFailure | null } | { k: 'salvo'; task: PastureTask; parsed: SpokenTask; undone: boolean } | { k: 'erro'; message: string }

const FAIL_TEXT: Record<SpeechFailure, string> = {
  'sem-suporte': 'Este aparelho não liberou o reconhecimento de voz dentro do app.',
  negado: 'O microfone não foi liberado para o ARGO.',
  'sem-internet': 'Sem internet, o reconhecimento de voz do app não respondeu.',
  'nada-ouvido': 'O reconhecimento de voz do app não captou nada.',
  erro: 'O reconhecimento de voz não respondeu.',
}

/**
 * Anotar tarefa falando. Ouve, entende (prazo, pasto, responsável, urgência) e já anota.
 * Se a voz do app não estiver disponível (ou sem internet), abre o campo com o microfone do teclado do iPhone.
 */
function VoiceSheet({ session: first, onClose }: { session: Session | null; onClose: () => void }) {
  const { farm } = useFarm()
  const pastures = usePastures() ?? []
  const people = (useResponsibles() ?? []).filter((r) => r.active)
  const [mode, setMode] = useState<Mode>(() => (first ? { k: 'ouvindo', heard: '' } : { k: 'digitar', reason: null }))
  const [typed, setTyped] = useState('')
  const textRef = useRef<HTMLTextAreaElement>(null)
  // o teclado já foi aberto no toque do botão (campo auxiliar); aqui o foco passa para o campo da tarefa
  useLayoutEffect(() => {
    if (mode.k === 'digitar') textRef.current?.focus()
  }, [mode.k])
  const preview = typed.trim().length > 3 ? parseSpokenTask(typed, { today: todayLocal(), pastures, responsibles: people }) : null
  const [session, setSession] = useState<Session | null>(first)
  const ctxRef = useRef({ pastures, people })
  useEffect(() => {
    ctxRef.current = { pastures, people }
  })

  async function save(text: string) {
    const today = todayLocal()
    const parsed = parseSpokenTask(text, { today, pastures: ctxRef.current.pastures, responsibles: ctxRef.current.people })
    try {
      const { understood: _u, ...input } = parsed
      void _u
      const task = await createTask(db, farm.id, input, newId())
      setMode({ k: 'salvo', task, parsed, undone: false })
    } catch (e) {
      setMode({ k: 'erro', message: (e as Error).message })
    }
  }

  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  })

  // eventos da escuta (iniciada no toque)
  useEffect(() => {
    if (!session) return
    const off = session.subscribe((e) => {
      if (e.t === 'partial') setMode({ k: 'ouvindo', heard: e.text })
      else if (e.t === 'final') void saveRef.current(e.text)
      else setMode({ k: 'digitar', reason: e.reason })
    })
    return off
  }, [session])

  function start() {
    session?.stop()
    setMode({ k: 'ouvindo', heard: '' })
    setSession(startSession())
  }
  const close = () => {
    session?.stop()
    onClose()
  }
  const stopListening = () => session?.stop()

  const names = (p: SpokenTask) => p.understood

  return (
    <div className="sheet-backdrop" onClick={close}>
      <div className="sheet voice-sheet" role="dialog" aria-modal="true" aria-label="Tarefa por voz" onClick={(e) => e.stopPropagation()} data-testid="voice-sheet">
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <strong>Tarefa por voz</strong>
          <button className="btn btn-outline btn-icon" aria-label="Fechar" onClick={close}>
            <Icon name="chevronLeft" size={20} />
          </button>
        </div>

        {mode.k === 'ouvindo' && (
          <div className="voice-listen" data-testid="voice-listening">
            <button type="button" className="voice-orb is-on" aria-label="Parar e anotar" onClick={stopListening}>
              <Icon name="mic" size={40} />
            </button>
            <p className="voice-heard" aria-live="polite">
              {mode.heard || 'Pode falar… ex.: “amanhã arrumar a cerca do Pasto da Represa, urgente”'}
            </p>
            <button type="button" className="btn btn-outline btn-block" onClick={stopListening}>
              Terminei de falar
            </button>
          </div>
        )}

        {mode.k === 'digitar' && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              if (typed.trim()) void save(typed)
            }}
            data-testid="voice-type"
          >
            {mode.reason ? (
              <div className="notice notice-warn">
                <Icon name="mic" />
                <div>{FAIL_TEXT[mode.reason]} Use o ditado do teclado, como explicado abaixo.</div>
              </div>
            ) : null}
            <ol className="dictation-steps" data-testid="dictation-steps">
              <li>
                Toque no <b>microfone</b> <Icon name="mic" size={16} /> do teclado{isIOS() ? ' (embaixo, à direita)' : ''}.
              </li>
              <li>Fale a tarefa. Ex.: “amanhã arrumar a cerca do Pasto da Represa, urgente, pro Zé”.</li>
              <li>
                Toque em <b>Anotar tarefa</b>.
              </li>
            </ol>
            <textarea
              ref={textRef}
              className="input"
              rows={3}
              autoFocus
              aria-label="Fale ou escreva a tarefa"
              placeholder="Ex.: amanhã arrumar a cerca do Pasto da Represa, urgente"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
            {preview && preview.understood.length > 0 && (
              <div className="herd-cats" data-testid="voice-preview">
                <span className="muted" style={{ fontSize: 13 }}>
                  Entendi:
                </span>
                {preview.understood.map((u) => (
                  <span key={u} className="herd-cat">
                    {u}
                  </span>
                ))}
              </div>
            )}
            <button type="submit" className="btn btn-gold btn-block" disabled={!typed.trim()} data-testid="voice-save">
              <Icon name="check" /> Anotar tarefa
            </button>
            {isIOS() && (
              <p className="muted" style={{ fontSize: 13 }}>
                Não aparece o microfone no teclado? Ative em Ajustes › Geral › Teclado › Ativar Ditado.
              </p>
            )}
            {speechSupported() && !isIOS() && (
              <button type="button" className="btn btn-outline btn-block" onClick={start}>
                <Icon name="mic" /> Tentar falar de novo
              </button>
            )}
          </form>
        )}

        {mode.k === 'salvo' && (
          <div className="stack" data-testid="voice-saved">
            <div className={`voice-done${mode.undone ? ' is-undone' : ''}`}>
              <span className="voice-done-icon">
                <Icon name={mode.undone ? 'undo' : 'check'} size={26} />
              </span>
              <div>
                <div className="ind-label">{mode.undone ? 'Desfeito' : 'Tarefa anotada'}</div>
                <div className="voice-done-text">{mode.task.description}</div>
                {names(mode.parsed).length > 0 && (
                  <div className="herd-cats" style={{ marginTop: 8 }}>
                    {names(mode.parsed).map((u) => (
                      <span key={u} className="herd-cat">
                        {u}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="row">
              {!mode.undone && (
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ flex: 1 }}
                  onClick={() => void removeTask(db, mode.task.id).then(() => setMode({ ...mode, undone: true }))}
                  data-testid="voice-undo"
                >
                  <Icon name="undo" size={20} /> Desfazer
                </button>
              )}
              <Link to="/tarefas" className="btn btn-outline" style={{ flex: 1 }} onClick={close}>
                Ver tarefas
              </Link>
            </div>
            <button
              type="button"
              className="btn btn-gold btn-block"
              onClick={() => {
                setTyped('')
                if (!preferKeyboardDictation()) start()
                else setMode({ k: 'digitar', reason: null })
              }}
            >
              <Icon name="mic" /> Anotar outra
            </button>
          </div>
        )}

        {mode.k === 'erro' && (
          <div className="stack">
            <div className="notice notice-error">
              <Icon name="alert" />
              <div>{mode.message}</div>
            </div>
            <button type="button" className="btn btn-outline btn-block" onClick={() => setMode({ k: 'digitar', reason: null })}>
              Escrever a tarefa
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** Botão "Falar tarefa" (Painel e aba Tarefas). */
export function VoiceTaskButton({ variant = 'cta' }: { variant?: 'cta' | 'icon' }) {
  const [open, setOpen] = useState<{ session: Session | null } | null>(null)
  const proxy = useRef<HTMLInputElement>(null)
  const openSheet = () => {
    if (preferKeyboardDictation()) {
      // iPhone: só abre o teclado se o foco acontecer dentro do toque; foca um campo auxiliar já existente
      proxy.current?.focus()
      setOpen({ session: null })
    } else setOpen({ session: startSession() })
  }
  return (
    <>
      <input ref={proxy} className="kb-proxy" aria-hidden="true" tabIndex={-1} />
      {variant === 'cta' ? (
        <button type="button" className="voice-cta" onClick={openSheet} data-testid="qa-voz">
          <span className="voice-cta-mic">
            <Icon name="mic" size={26} />
          </span>
          <span className="voice-cta-text">
            <b>Anotar tarefa por voz</b>
            <span>Fale e o ARGO anota: prazo, pasto e responsável</span>
          </span>
          <Icon name="chevronRight" size={20} className="muted" />
        </button>
      ) : (
        <button type="button" className="btn btn-gold btn-icon" style={{ minHeight: 56, width: 56 }} aria-label="Falar tarefa" onClick={openSheet} data-testid="voice-btn">
          <Icon name="mic" />
        </button>
      )}
      {open && <VoiceSheet session={open.session} onClose={() => setOpen(null)} />}
    </>
  )
}
