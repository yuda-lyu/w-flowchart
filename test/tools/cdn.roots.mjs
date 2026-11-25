// CDN 根網址表之單一事實來源 = src/common/cdn.mjs 之 PKG 表(不改 src: 解析其文字取得鍵, 網址經其 cdnUrl 取得)
//   供共用庫 w-package-tools-e2e 之清單產生器(--roots 之 .mjs 檔, 具名匯出 roots 或 default)與 test/unit-cdnWiring.test.mjs 使用
//   修改 src/common/cdn.mjs 之庫或版本後, 以 `node node_modules/w-package-tools-e2e/tools/genCdnManifest.mjs --roots test/tools/cdn.roots.mjs --out test/tools/cdn.manifest.json` 重產清單(需連網; 加 --check 為核對)
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { cdnUrl } from '../../src/common/cdn.mjs'

const __dir = path.dirname(fileURLToPath(import.meta.url))

export const CDN_SRC_PATH = path.resolve(__dir, '..', '..', 'src', 'common', 'cdn.mjs')

// cdn.mjs 內 PKG 表之鍵(語意名)
export function cdnKeysFromSource(text) {
    const src = text === undefined ? fs.readFileSync(CDN_SRC_PATH, 'utf8') : text
    const m = /const PKG = \{([\s\S]*?)\n\}/.exec(src)
    if (!m) throw new Error('cdn.mjs 之 PKG 表解析失敗')
    const keys = []
    const re = /^\s*'([^']+)':\s*'([^']+)'/gm
    let k
    while ((k = re.exec(m[1]))) keys.push(k[1])
    return keys
}

export const roots = Object.fromEntries(cdnKeysFromSource().map(k => [k, cdnUrl(k)]))

export default roots
