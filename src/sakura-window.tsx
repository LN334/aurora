import { createRoot } from 'react-dom/client'
import './styles/app.css'
import './styles/player.css'
import './styles/roam.css'
import './styles/panels.css'
import { SakuraWindow } from './views/party/SakuraWindow'

const host = document.getElementById('root')
if (host) createRoot(host).render(<SakuraWindow />)
