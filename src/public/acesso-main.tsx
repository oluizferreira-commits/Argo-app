import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles/global.css'
import { AcessoPublico } from './AcessoPublico'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AcessoPublico />
  </StrictMode>,
)
