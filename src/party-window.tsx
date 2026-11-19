import { createRoot } from 'react-dom/client'
import './styles/app.css'
import './styles/player.css'
import './styles/roam.css'
import './styles/panels.css'
import { PartyWindow } from './views/PartyWindow'

/** 一起听独立窗口的入口：只挂这一块，不带播放器的其它部分。 */
const host = document.getElementById('root')
if (host) createRoot(host).render(<PartyWindow />)
