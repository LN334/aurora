import { createRoot } from 'react-dom/client'
import { applyTheme, readTheme } from './features/settings/theme'
import './styles/app.css'
import './styles/player.css'
import './styles/roam.css'
import './styles/panels.css'
import { PartyWindow } from './views/PartyWindow'

/** 一起听独立窗口的入口：只挂这一块，不带播放器的其它部分。 */
/* 和主窗读同一份选择，别让它在浅色模式下还是黑的。 */
applyTheme(readTheme())

const host = document.getElementById('root')
if (host) createRoot(host).render(<PartyWindow />)
