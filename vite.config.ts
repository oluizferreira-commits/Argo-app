/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// BASE_PATH é definido no deploy (ex.: "/Argo-app/" no GitHub Pages).
// Em desenvolvimento local fica "/".
const base = process.env.BASE_PATH ?? '/'
// Endereço público completo (para a prévia do link no WhatsApp). Definido no deploy.
process.env.VITE_SITE_URL ??= base
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    rollupOptions: {
      // index.html = app; acesso.html = página pública "Como chegar" (sem login)
      input: { main: 'index.html', acesso: 'acesso.html' },
    },
  },
  plugins: [
    react(),
    VitePWA({
      // "prompt": a nova versão só é ativada quando o usuário toca em "Atualizar",
      // evitando recarregar a tela no meio de um lançamento.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'logo-mark.svg', 'apple-touch-icon.png'],
      manifest: {
        id: base,
        name: 'ARGO — Gestão Pecuária',
        short_name: 'ARGO',
        description: 'Gestão pecuária profissional, com funcionamento offline.',
        lang: 'pt-BR',
        dir: 'ltr',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#276153',
        theme_color: '#276153',
        categories: ['business', 'productivity'],
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // a imagem de prévia do link é só para o WhatsApp: não precisa ficar no aparelho
        // og-acesso.jpg: só para a prévia do WhatsApp. html2canvas/purify/canvg (index.es): partes opcionais
        // do gerador de PDF que o ARGO não usa (HTML/SVG para PDF) — nunca são carregadas.
        globIgnores: ['**/og-acesso.jpg', '**/html2canvas-*.js', '**/purify.es-*.js', '**/index.es-*.js'],
        navigateFallback: 'index.html',
        // a página pública nunca é trocada pelo app
        navigateFallbackDenylist: [/acesso\.html/],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
  },
})
