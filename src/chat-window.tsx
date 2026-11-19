import { createRoot } from 'react-dom/client'
import './styles/app.css'
import './styles/player.css'
import './styles/roam.css'
import './styles/panels.css'
import { ChatWindow } from './views/party/ChatWindow'

const host = document.getElementById('root')
if (host) createRoot(host).render(<ChatWindow />)
