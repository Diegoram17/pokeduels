import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MockStateProvider } from './state/MockStateProvider'
import './index.css'
import './assets/pokeduels-design-system.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MockStateProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </MockStateProvider>
  </StrictMode>,
)