import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { StickyNote } from './components/StickyNote'
import { ensureApi } from './platform'

const hash = window.location.hash
const stickyMatch = hash.match(/^#\/sticky\/([^/]+)$/)
const root = createRoot(document.getElementById('root')!)

// Electron 里 window.api 由 preload 注入；Capacitor / 浏览器里由适配层安装。
void ensureApi().then(() => {
  if (stickyMatch) {
    document.documentElement.classList.add('sticky-route')
    root.render(<StickyNote todoId={decodeURIComponent(stickyMatch[1])} />)
  } else {
    root.render(<App />)
  }
})
