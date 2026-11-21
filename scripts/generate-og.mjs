// Gera public/og-acesso.jpg (prévia do link "Como chegar" no WhatsApp). Uso: node scripts/generate-og.mjs
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
const logo = readFileSync(new URL('../public/logo-mark.svg', import.meta.url), 'utf8')
const html = `<html><body style="margin:0;width:1200px;height:630px;background:radial-gradient(120% 120% at 80% 0%,#276153,#16392f 60%,#0c241e);display:flex;align-items:center;gap:56px;padding:0 90px;box-sizing:border-box;font-family:-apple-system,Helvetica,Arial,sans-serif">
<div style="width:300px;height:300px;flex:none">${logo.replace('<svg ', '<svg width="300" height="300" ')}</div>
<div><div style="color:#ebcb94;font-size:84px;font-weight:800;letter-spacing:.22em">ARGO</div>
<div style="color:rgba(255,255,255,.7);font-size:26px;letter-spacing:.2em;margin-top:6px">GESTÃO PECUÁRIA</div>
<div style="width:90px;height:5px;background:#c9a376;border-radius:3px;margin:34px 0"></div>
<div style="color:#fff;font-size:56px;font-weight:700">Como chegar à fazenda</div>
<div style="color:rgba(255,255,255,.75);font-size:30px;margin-top:14px">Mapa de satélite · rota · navegação</div></div></body></html>`
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1200, height: 630 } })
await p.setContent(html); await p.screenshot({ path: new URL('../public/og-acesso.jpg', import.meta.url).pathname, type: 'jpeg', quality: 86 }); await b.close()
console.log('ok og-acesso.jpg')
