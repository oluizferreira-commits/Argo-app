/**
 * Ilustrações da identidade "Terra & Tecnologia" — vetoriais, leves e sem download
 * (funcionam offline e não pesam no carregamento). Nenhuma delas representa dado da fazenda.
 */

/** Silhueta de boi zebuíno (nelore), de perfil, voltado para a esquerda. viewBox 0 0 120 72. */
export const ZEBU_PATH =
  'M7 31.5C7 30 8.5 27.5 11 24.5C12.5 22.5 14 21 15.5 20L16 15L18.2 19.2C20 19.4 22 19 24 18.4C28 17 30.5 14 32.5 10.5C34.5 7 38.5 6.5 41.5 9C43.5 11 44.5 14 47.5 15.8C55 17 80 16.8 97 17.2C102 17.5 106 19 108.5 22C110 24 110.5 28 110.5 34L111 51C112 52 112.5 55 111.5 57L108.5 57C107.6 55 108 52 109 51L108.6 32C108 36 106.5 40 105 43C103.5 46 103.6 50 104 54L103.6 70L99.6 70L99.8 58C99 53 97.5 50.5 95.5 49.5L94.6 58L94.8 70L90.8 70L90.6 57C89.5 52.5 87.5 50 84 49.6C76 50 64 50 56 49.4L55 58L55.3 70L51.3 70L51 58C50.4 55 49.4 53 47.5 52L46 58L46.2 70L42.2 70L42 57C41 52 38.5 48.5 35.5 47C33 46 31 46.3 29 45.3C26 43.8 23.5 40 21 37C19.5 35.2 18 34 16.5 34C14 34.4 11.5 35.4 9 35.3C7.6 35.1 7 33.5 7 31.5ZM17 20.4C14 19.6 11 20 8.4 21.6C11 23.2 14 23.3 17.2 22.5Z'

export function ZebuSilhouette({ className, title }: { className?: string; title?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 72" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={ZEBU_PATH} fill="currentColor" />
    </svg>
  )
}

/** Curvas de nível (relevo) — fundo discreto dos cartões de pasto/território. */
export function Topography({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1">
        <path d="M120 60c0-14 14-26 32-26s34 10 34 26-16 28-34 28-32-14-32-28Z" />
        <path d="M108 60c0-22 20-38 45-38s44 16 44 38-20 40-44 40-45-18-45-40Z" />
        <path d="M95 62c0-30 26-52 58-52s58 22 58 52-26 52-58 52-58-22-58-52Z" />
        <path d="M80 64c0-38 32-66 73-66s73 28 73 66-32 64-73 64-73-26-73-64Z" />
        <path d="M-10 96c30-14 52-6 72-16s34-30 58-30" />
        <path d="M-10 110c32-12 58-4 80-14s38-30 64-28" />
        <path d="M-10 82c26-12 46-6 64-14s30-30 50-34" />
      </g>
    </svg>
  )
}

function CerradoTree({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  // árvore de cerrado: tronco retorcido e copa larga e baixa
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M0 0c.4-4-1.2-6 .6-10M.4-6c1.6-1.6 3-2 4.6-2.2M.2-7.5c-1.4-1-2.8-1.4-4.4-1.4" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinecap="round" />
      <ellipse cx="0.6" cy="-11.5" rx="9" ry="3.4" fill="currentColor" />
      <ellipse cx="5" cy="-9.6" rx="5" ry="2.4" fill="currentColor" />
      <ellipse cx="-4.6" cy="-9.8" rx="4.6" ry="2.2" fill="currentColor" />
    </g>
  )
}

/** Cavalo com vaqueiro (chapéu de aba larga), de perfil, voltado para a esquerda. viewBox 0 0 100 90, chão em y=86. */
const HORSE_PATH =
  'M9 41C6 41 4.5 39 5 37C6 34 10 29 14 24L15.5 18L18.5 22.5C22 24 25 27 28 30C31 33 35 35 40 35.5C50 36 60 35.5 68 35C75 34.5 80 36 82 39C83.5 41 84 44 83.8 47C87.5 50 89.5 57 88 66C86 62 85 56 83 52C82 55 81 58 80 60L79 70L80 86L76 86L75 71L74 62C72 60 70 59 68 59L69 70L70 86L66 86L65 70L64 60C56 61 46 61 40 60L39 72L40 86L36 86L35 72L34 60L32 60L31 72L32 86L28 86L27 72L28 58C27 54 26.5 51 25 48C23 44 20.5 39 18.5 36.5C17.5 37.5 16 38.5 14.5 39.2C12.5 40.2 11 41 9 41Z' +
  'M44 35L45 22C45 19 47 17 49 17C52 17 53 19 53 22L54 35Z' +
  'M52.3 13A3.3 3.3 0 1 1 45.7 13A3.3 3.3 0 1 1 52.3 13Z' +
  'M41.5 10.2C44 9.2 46 9 46.5 6C47 4.6 51 4.6 51.5 6C52 9 54 9.2 56.5 10.2C52 11.3 46 11.3 41.5 10.2Z' +
  'M48 33L54 34L51 46L50.6 59L47 61.5L44.5 61.5L46.8 58.5L47 46Z'

type Walk = 'a' | 'b' | 'c' | 'parado'

/**
 * Animal andando de lá para cá: (x, y) = ponto no chão. A ida e a volta (com a virada) são feitas em CSS
 * (`.walk-*`), só com transform — leve, sem JavaScript; desligada em "Reduzir movimento".
 */
function Walker({ x, y, s, walk, dur, delay, opacity = 1, horse }: { x: number; y: number; s: number; walk: Walk; dur: number; delay: number; opacity?: number; horse?: boolean }) {
  const body = horse ? (
    <g transform={`scale(${s}) translate(-47 -86)`}>
      <path d={HORSE_PATH} fill="currentColor" />
      <path d="M47 21L41 28L36 30" stroke="currentColor" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M36 30L10 39" stroke="currentColor" strokeWidth="0.6" fill="none" />
    </g>
  ) : (
    <path d={ZEBU_PATH} fill="currentColor" transform={`scale(${s}) translate(-60 -70)`} />
  )
  return (
    <g transform={`translate(${x} ${y})`} opacity={opacity}>
      <g className={`walk walk-${walk}`} style={{ animationDuration: `${dur}s`, animationDelay: `${delay}s` }}>
        <g className={walk === 'parado' ? 'graze' : 'bob'} style={{ animationDelay: `${delay / 7}s` }}>
          {body}
        </g>
      </g>
    </g>
  )
}

/**
 * Paisagem de pastagem brasileira ao entardecer: serras ao fundo, cerrado no horizonte,
 * gado nelore no pasto e cerca em primeiro plano. Ilustração (não é foto da fazenda).
 */
export function FarmLandscape({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 400 230" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="ls-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#123a2d" />
          <stop offset="0.5" stopColor="#2c5a40" />
          <stop offset="0.78" stopColor="#7d7a4a" />
          <stop offset="1" stopColor="#c9a46a" />
        </linearGradient>
        <radialGradient id="ls-sun" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#f6e2b0" stopOpacity="0.95" />
          <stop offset="0.35" stopColor="#e0c088" stopOpacity="0.55" />
          <stop offset="1" stopColor="#c9a46a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ls-field" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3d6a45" />
          <stop offset="1" stopColor="#1d4634" />
        </linearGradient>
        <linearGradient id="ls-shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.42" stopColor="#102f26" stopOpacity="0" />
          <stop offset="0.72" stopColor="#102f26" stopOpacity="0.6" />
          <stop offset="1" stopColor="#102f26" stopOpacity="0.94" />
        </linearGradient>
        <linearGradient id="ls-side" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0c271f" stopOpacity="0.35" />
          <stop offset="0.5" stopColor="#0c271f" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect width="400" height="230" fill="url(#ls-sky)" />
      <g transform="translate(0 -54)">
      <circle cx="292" cy="112" r="70" fill="url(#ls-sun)" />
      <circle cx="292" cy="114" r="13" fill="#f3dca4" opacity="0.9" />

      {/* serras ao fundo */}
      <path d="M0 118 40 104l34 8 40-20 36 14 30-10 44 18 38-16 40 12 34-10 64 16v104H0Z" fill="#46714c" opacity="0.55" />
      <path d="M0 128 52 114l46 10 38-12 52 14 48-8 44 10 50-14 70 14v94H0Z" fill="#355f42" opacity="0.85" />

      {/* horizonte de cerrado */}
      <g color="#21452f">
        <CerradoTree x={30} y={131} s={1} />
        <CerradoTree x={58} y={129} s={0.7} />
        <CerradoTree x={154} y={128} s={0.85} />
        <CerradoTree x={238} y={127} s={0.6} />
        <CerradoTree x={344} y={128} s={1.1} />
        <CerradoTree x={372} y={130} s={0.75} />
      </g>

      {/* pasto */}
      <path d="M0 134c60-8 120-6 200-2s150 2 200-4v102H0Z" fill="url(#ls-field)" />
      <g stroke="#5c8550" strokeOpacity="0.35" strokeWidth="0.8" fill="none">
        <path d="M0 150c80-6 170-4 260 0s110-2 140-4" />
        <path d="M0 166c90-6 180-2 270 2s100-2 130-6" />
      </g>

      {/* gado nelore no pasto, andando de lá para cá, e o vaqueiro tocando a boiada */}
      <g color="#e8d9b9" className="herd-scene">
        <Walker x={205} y={146} s={0.21} walk="c" dur={38} delay={-11} opacity={0.82} />
        <Walker x={242} y={149} s={0.25} walk="parado" dur={9} delay={-2} opacity={0.86} />
        <Walker x={268} y={153} s={0.29} walk="a" dur={44} delay={-20} opacity={0.92} />
        <Walker x={302} y={160} s={0.35} walk="c" dur={40} delay={-30} opacity={0.95} />
        <Walker x={128} y={168} s={0.44} walk="b" dur={52} delay={-14} opacity={0.97} horse />
      </g>

      {/* cerca em primeiro plano */}
      <g color="#0d2a21">
        <path d="M0 186 400 170" stroke="currentColor" strokeWidth="1.2" />
        <path d="M0 196 400 179" stroke="currentColor" strokeWidth="1.2" />
        {[8, 70, 132, 194, 256, 318, 380].map((x) => {
          const top = 180 - x * 0.04
          return <rect key={x} x={x} y={top} width="4.2" height={34} rx="1" fill="currentColor" />
        })}
      </g>

      </g>
      <rect y="140" width="400" height="90" fill="#1d4634" />

      <rect width="400" height="230" fill="url(#ls-side)" />
      <rect width="400" height="230" fill="url(#ls-shade)" />
    </svg>
  )
}
