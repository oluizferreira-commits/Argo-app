import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { router } from './app/routes'
import { db } from './db/database'
import { getDeviceId } from './db/device'
import { requestPersistentStorage } from './platform/storage'
import './styles/global.css'

async function boot() {
  try {
    await db.open()
    await getDeviceId(db)
  } catch (e) {
    showFatal(`Não foi possível abrir o banco de dados local: ${(e as Error).message}`)
    return
  }
  // Pede proteção contra limpeza automática (não bloqueia a abertura do app).
  void requestPersistentStorage()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  )
}

function showFatal(message: string) {
  const root = document.getElementById('root')!
  root.innerHTML = ''
  const box = document.createElement('div')
  box.style.cssText = 'padding:24px;font-family:-apple-system,sans-serif;color:#7a1912'
  box.textContent = message
  root.appendChild(box)
}

void boot()
