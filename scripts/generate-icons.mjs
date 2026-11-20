// Gera os ícones PNG do PWA a partir de public/favicon.svg.
// Uso (ambiente com Playwright/Chromium): node scripts/generate-icons.mjs
// Os PNGs gerados ficam versionados em public/, então isto só precisa rodar
// quando o logotipo mudar.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')

const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8')
const out = (name) => new URL(`../public/${name}`, import.meta.url).pathname

const targets = [
  { name: 'pwa-192.png', size: 192, pad: 0, round: false },
  { name: 'pwa-512.png', size: 512, pad: 0, round: false },
  // iOS aplica a própria máscara arredondada: o ícone deve ser quadrado e cheio.
  { name: 'apple-touch-icon.png', size: 180, pad: 0, round: false },
  // Maskable: conteúdo dentro da "zona segura" (80%), fundo preenchendo tudo.
  { name: 'pwa-maskable-512.png', size: 512, pad: 0, round: false },
]

const browser = await chromium.launch()
const page = await browser.newPage()
for (const t of targets) {
  const body = t.round ? svg : svg.replace(/rx="112"/, 'rx="0"')
  const inner = Math.round(t.size * (1 - t.pad * 2))
  await page.setViewportSize({ width: t.size, height: t.size })
  await page.setContent(`<html><body style="margin:0;background:#276153;display:grid;place-items:center;width:${t.size}px;height:${t.size}px">
    <div style="width:${inner}px;height:${inner}px">${body.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`)
  await page.screenshot({ path: out(t.name), omitBackground: t.round })
  console.log('ok', t.name)
}
await browser.close()
