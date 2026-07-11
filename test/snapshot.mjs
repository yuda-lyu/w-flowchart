// pN 渲染回歸共用層 — 以與 p10 相同之測試輸入(16 合成案 + 12 範例圖)對指定產線跑 PNG 快照基準。
//   p1~p9 無 geom 幾何輸出(結構不變量為 p10 專屬), 其把關層為 PNG 像素基準:
//   pixelmatch(includeAA:false, 反鋸齒容差 MAXDIFF)比對 pics/<mode>/<案>.png, 無基準或 UPDATE_BASELINE=1 時建立。
import assert from 'assert'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { deriveLabels } from '../src/common/derive.mjs'
import { CASES } from './cases.mjs'
import { FIGURES } from './figures.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const MAXDIFF = 60   // PNG 容許之反鋸齒雜訊像素上限(真 regression 量級遠超此)
const UPDATE = process.env.UPDATE_BASELINE === '1' || process.env.UPDATE_BASELINE === 'true'

// 測試輸入(同 p10): 合成案數據為原始形(rich 節點無 label), genPng 合約要求 caller 先衍生 → clone 後 deriveLabels
const items = [
    ...CASES.map(c => ({ name: c.name, data: () => deriveLabels(structuredClone(c.data)), kind: '合成' })),
    ...FIGURES.map(f => ({ name: f.key, data: () => structuredClone(f.data), kind: '範例圖' })), //figures.mjs 已衍生
]

// PNG 像素比對(反鋸齒容差): 回 { same, detail }
function pngCompare(baseBuf, curBuf, diffPath) {
    const a = PNG.sync.read(baseBuf), b = PNG.sync.read(curBuf)
    if (a.width !== b.width || a.height !== b.height) return { same: false, detail: `尺寸 ${a.width}x${a.height} → ${b.width}x${b.height}` }
    const diff = new PNG({ width: a.width, height: a.height })
    const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { includeAA: false, threshold: 0.1 })
    if (n > MAXDIFF) { fs.writeFileSync(diffPath, PNG.sync.write(diff)); return { same: false, detail: `${n} 像素差 (>${MAXDIFF}) → ${diffPath}` } }
    return { same: true, detail: `${n} 像素差` }
}

// 對指定產線掛載整組 PNG 快照回歸測試(供各 pN.test.mjs 兩行調用)
//   opt.timeout: 單案逾時毫秒(覆蓋 mocha 全域值; 供渲染較慢之引擎如 p5 D2 WASM 放寬)
export function definePngSuite(mode, genPng, opt = {}) {
    const SNAP = resolve(__dir, 'pics', mode)

    describe(`${mode} 渲染回歸(PNG 快照基準)`, function() {

        before(function() {
            fs.mkdirSync(SNAP, { recursive: true })
        })

        for (const tc of items) {
            it(`[${tc.kind}] ${tc.name}`, async function() {
                if (opt.timeout) this.timeout(opt.timeout)
                const png = await genPng(tc.data())
                assert.ok(Buffer.isBuffer(png) && png[0] === 0x89 && png[1] === 0x50, '非合法 PNG Buffer')
                const pngP = resolve(SNAP, tc.name + '.png')
                if (UPDATE || !fs.existsSync(pngP)) { fs.writeFileSync(pngP, png); return }
                const c = pngCompare(fs.readFileSync(pngP), png, resolve(SNAP, tc.name + '.diff.png'))
                if (c.same) return
                // 替代基準: 少數引擎存在佈局雙吸子非決定性(同輸入隨機落在兩種合法佈局, 如 G6 之 antv-dagre+combo),
                // 主基準不符時改比對 <案>.alt.png(兩者皆須為人工複審過之合法輸出)
                const altP = resolve(SNAP, tc.name + '.alt.png')
                if (fs.existsSync(altP)) {
                    const c2 = pngCompare(fs.readFileSync(altP), png, resolve(SNAP, tc.name + '.diff.png'))
                    if (c2.same) return
                }
                fs.writeFileSync(resolve(SNAP, tc.name + '.new.png'), png)
                assert.ok(false, `PNG 與基準不同: ${c.detail}(已輸出 ${tc.name}.new.png, 確認為預期後以 UPDATE_BASELINE=1 重建)`)
            })
        }

    })
}
