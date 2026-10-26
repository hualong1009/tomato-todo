import { createRoot } from 'react-dom/client'
import App from './App'
import { StickyNote } from './components/StickyNote'
import './styles.css'

const hash = window.location.hash
const stickyMatch = hash.match(/^#\/sticky\/([^/]+)$/)
const root = createRoot(document.getElementById('root')!)

if (stickyMatch) {
  document.documentElement.classList.add('sticky-route')
  root.render(<StickyNote todoId={decodeURIComponent(stickyMatch[1])} />)
} else {
  root.render(<App />)
}
