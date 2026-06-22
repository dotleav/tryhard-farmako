import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import Quiz from './components/Quiz'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Quiz />
  </StrictMode>
)
