import { createRoot } from 'react-dom/client'
import { applyTheme, readTheme } from './features/settings/theme'
import './styles/app.css'
import './styles/player.css'
import './styles/roam.css'
import './styles/panels.css'
import { ChatWindow } from './views/party/ChatWindow'

/*
 * 独立窗口也要跟着主题走：它和主窗同一个 origin，localStorage 里存的是同一份
 * 选择。不调用这一句，data-theme 就永远是默认的深色——浅色模式下这扇窗会
 * 又黑又硬地岔出去。
 */
applyTheme(readTheme())

const host = document.getElementById('root')
if (host) createRoot(host).render(<ChatWindow />)
