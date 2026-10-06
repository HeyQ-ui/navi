import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/noto-serif-sc/600.css'
import '@fontsource/noto-serif-sc/900.css'
import '@fontsource/fraunces/500.css'
import '@fontsource/fraunces/600.css'
import { App } from './App.js'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
