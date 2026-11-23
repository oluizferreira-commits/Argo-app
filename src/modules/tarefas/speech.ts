/**
 * Reconhecimento de fala do próprio navegador (no iPhone, o mesmo da digitação por voz da Apple).
 * Quando não existir ou falhar (ex.: sem internet num aparelho sem ditado no próprio aparelho),
 * a tela oferece o microfone do teclado do iPhone, que também funciona sem internet nos modelos recentes.
 */

interface RecognitionResult {
  readonly isFinal: boolean
  readonly 0: { readonly transcript: string }
}
interface RecognitionEvent {
  readonly resultIndex: number
  readonly results: { readonly length: number; readonly [i: number]: RecognitionResult }
}
interface Recognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  onresult: ((e: RecognitionEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type RecognitionCtor = new () => Recognition

function ctor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && ctor() !== null
}

export type SpeechFailure = 'sem-suporte' | 'negado' | 'sem-internet' | 'nada-ouvido' | 'erro'

export interface ListenHandlers {
  onPartial: (text: string) => void
  onFinal: (text: string) => void
  onFail: (reason: SpeechFailure) => void
}

/** Começa a ouvir (português do Brasil). Devolve a função que para de ouvir. */
export function listen(h: ListenHandlers): () => void {
  const C = ctor()
  if (!C) {
    h.onFail('sem-suporte')
    return () => {}
  }
  const rec = new C()
  rec.lang = 'pt-BR'
  rec.interimResults = true
  rec.continuous = false
  rec.maxAlternatives = 1
  let finalText = ''
  let lastHeard = ''
  let done = false
  const finish = (fn: () => void) => {
    if (done) return
    done = true
    fn()
  }
  rec.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      if (r.isFinal) finalText += r[0].transcript
      else interim += r[0].transcript
    }
    lastHeard = (finalText + ' ' + interim).trim()
    h.onPartial(lastHeard)
  }
  rec.onerror = (e) => {
    const reason: SpeechFailure =
      e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'negado' : e.error === 'network' ? 'sem-internet' : e.error === 'no-speech' || e.error === 'aborted' ? 'nada-ouvido' : 'erro'
    // se algo já foi ouvido, aproveita (o iPhone às vezes encerra com erro depois de entender)
    if (lastHeard && reason === 'nada-ouvido') finish(() => h.onFinal(lastHeard))
    else finish(() => h.onFail(reason))
  }
  rec.onend = () => {
    const heard = finalText.trim() || lastHeard
    finish(() => (heard ? h.onFinal(heard) : h.onFail('nada-ouvido')))
  }
  try {
    rec.start()
  } catch {
    finish(() => h.onFail('erro'))
  }
  return () => {
    try {
      rec.stop()
    } catch {
      /* já parou */
    }
  }
}
