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

function Cow({ x, y, s, flip, opacity = 1 }: { x: number; y: number; s: number; flip?: boolean; opacity?: number }) {
  // (x, y) = ponto no chão sob o meio do animal
  const k = flip ? -s : s
  return <path d={ZEBU_PATH} fill="currentColor" opacity={opacity} transform={`translate(${x - 60 * k} ${y - 70 * s}) scale(${k} ${s})`} />
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
      <g transform="translate(0 -44)">
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

      {/* gado nelore no pasto */}
      <g color="#e8d9b9">
        <Cow x={200} y={145} s={0.22} opacity={0.82} />
        <Cow x={226} y={147} s={0.24} flip opacity={0.85} />
        <Cow x={262} y={151} s={0.3} opacity={0.92} />
        <Cow x={128} y={150} s={0.26} flip opacity={0.88} />
        <Cow x={318} y={160} s={0.4} opacity={0.96} />
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
      <rect y="150" width="400" height="80" fill="#1d4634" />

      <rect width="400" height="230" fill="url(#ls-side)" />
      <rect width="400" height="230" fill="url(#ls-shade)" />
    </svg>
  )
}
