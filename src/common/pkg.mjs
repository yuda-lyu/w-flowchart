// 本機套件檔案定位與讀取: 供各產線把繪圖庫由 CDN 改為 node_modules 內聯注入(斷網環境可用)。
//   以 fs 實體路徑向上逐層找 node_modules/<rel>, 不走 require.resolve(不受套件 exports 白名單限制),
//   亦相容本套件被安裝後 node_modules 被 hoist 至上層的情況。
import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))

// rel 例: 'mermaid10/dist/mermaid.min.js' → 回傳實體絕對路徑
export function pkgFile(rel) {
    let dir = __dir
    for (let i = 0; i < 10; i++) {
        const fp = join(dir, 'node_modules', rel)
        if (fs.existsSync(fp)) return fp
        const up = dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到本機套件檔案 node_modules/' + rel)
}

// 讀取套件 JS 內容供 <script> 內聯(轉義 </script> 避免提早關閉標籤)
export function pkgScript(rel) {
    return fs.readFileSync(pkgFile(rel), 'utf8').replace(/<\/script/gi, '<\\/script')
}

// 讀取套件文字內容(CSS 等)
export function pkgText(rel) {
    return fs.readFileSync(pkgFile(rel), 'utf8')
}
