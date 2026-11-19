import fs from 'node:fs'
import path from 'node:path'

/**
 * 启动标记。
 *
 * 打包版在这台机器上一启动就死在「写第一行日志」之前，什么线索都留不下。这个
 * 文件是被 main 的第一个 import 拉起来的，它自己只做一件事：往随 APPDATA 的
 * 一个纯文本里追加一行。崩在它之前说明是 Node/Electron 层面没起来，崩在它之后
 * 就能按行往下夹。
 */
try {
  const file = path.join(process.env.APPDATA ?? '.', 'aurora-boot.log')
  fs.appendFileSync(file, 'boot ' + new Date().toISOString() + ' pid=' + process.pid + '\n', 'utf8')
} catch {
  /* 记不下来也不能影响启动 */
}
