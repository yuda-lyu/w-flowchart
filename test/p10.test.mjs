// p10 渲染回歸(mocha) — 10 合成案 + 9 真圖, 兩層把關:
//   A. 結構不變量(spec 翻譯, 硬失敗): 存在性/包含/標題不溢出/不重疊/items框/邊路由
//   B. 快照基準(回歸偵測): SVG 逐字比對 + PNG 像素(pixelmatch includeAA:false, 容差 MAXDIFF)
// 用法:
//   npm test                                                            全部測試
//   npx mocha "test/p10.test.mjs" --timeout 60000           只跑本回歸
//   npx mocha "test/p10.test.mjs" --timeout 60000 --grep fold   只跑名稱含 fold 之案
//   重建基準(確認變動為預期後才做): 設環境變數 UPDATE_BASELINE=1 再跑
import assert from 'assert'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { openStage, renderCase, runInvariants, helpers } from './lib.mjs'
import { CASES } from './cases.mjs'
import { FIGURES } from './figures.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const SNAP = resolve(__dir, 'pics')
const MAXDIFF = 60   // PNG 容許之反鋸齒雜訊像素上限(真 regression 量級遠超此)
const UPDATE = process.env.UPDATE_BASELINE === '1' || process.env.UPDATE_BASELINE === 'true'

// 待測清單: 合成案 + 9 真圖(真圖為最重要之回歸案)
const items = []
for (const c of CASES) items.push({ name: c.name, data: c.data, check: c.check, expect: c.expect, kind: '合成' })
for (const f of FIGURES) items.push({ name: f.key, data: f.data, kind: '真圖' })

// PNG 像素比對(反鋸齒容差): 回 { same, detail }
function pngCompare(baseBuf, curBuf, diffPath) {
    const a = PNG.sync.read(baseBuf), b = PNG.sync.read(curBuf)
    if (a.width !== b.width || a.height !== b.height) return { same: false, detail: `尺寸 ${a.width}x${a.height} → ${b.width}x${b.height}` }
    const diff = new PNG({ width: a.width, height: a.height })
    const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { includeAA: false, threshold: 0.1 })
    if (n > MAXDIFF) { fs.writeFileSync(diffPath, PNG.sync.write(diff)); return { same: false, detail: `${n} 像素差 (>${MAXDIFF}) → ${diffPath}` } }
    return { same: true, detail: `${n} 像素差` }
}

describe('p10 渲染回歸(結構不變量 + 快照基準)', function() {
    let browser = null
    let page = null

    before(async function() {
        this.timeout(120000)
        fs.mkdirSync(SNAP, { recursive: true })
        const s = await openStage()
        browser = s.browser
        page = s.page
    })

    after(async function() {
        if (browser) await browser.close()
    })

    for (const tc of items) {
        it(`[${tc.kind}] ${tc.name}`, async function() {
            const r = await renderCase(page, tc.data)
            assert.ok(r.res && r.res.ok, '渲染失敗: ' + (r.res && r.res.err))
            const geom = r.res.geom
            const h = helpers(geom)

            // A. 不變量 + 案例專屬斷言 + 比例期望
            const checks = runInvariants(r.spec, geom)
            if (tc.check) checks.push(...tc.check(r.spec, geom, h).filter(Boolean))
            if (tc.expect) {
                const R = geom.H / geom.W
                if (tc.expect.ratioMax != null) checks.push({ name: `比例 H/W ≤ ${tc.expect.ratioMax}`, pass: R <= tc.expect.ratioMax + 0.02, detail: `R=${R.toFixed(3)}` })
                if (tc.expect.ratioMin != null) checks.push({ name: `比例 H/W ≥ ${tc.expect.ratioMin}`, pass: R >= tc.expect.ratioMin - 0.02, detail: `R=${R.toFixed(3)}` })
            }
            const failed = checks.filter(c => !c.pass)
            assert.ok(!failed.length, '不變量失敗: ' + failed.map(c => `${c.name}(${c.detail || ''})`).join('; '))

            // B. 快照基準(無基準或 UPDATE_BASELINE=1 時建立/重建)
            const svgP = resolve(SNAP, tc.name + '.svg')
            const pngP = resolve(SNAP, tc.name + '.png')
            if (UPDATE || !fs.existsSync(svgP)) fs.writeFileSync(svgP, r.svg)
            else {
                const base = fs.readFileSync(svgP, 'utf8')
                if (base !== r.svg) fs.writeFileSync(resolve(SNAP, tc.name + '.new.svg'), r.svg)
                assert.ok(base === r.svg, `SVG 與基準不同(長 ${base.length}→${r.svg.length}; 已輸出 ${tc.name}.new.svg, 確認為預期後以 UPDATE_BASELINE=1 重建)`)
            }
            if (UPDATE || !fs.existsSync(pngP)) fs.writeFileSync(pngP, r.png)
            else {
                const c = pngCompare(fs.readFileSync(pngP), r.png, resolve(SNAP, tc.name + '.diff.png'))
                assert.ok(c.same, `PNG 與基準不同: ${c.detail}(確認為預期後以 UPDATE_BASELINE=1 重建)`)
            }
        })
    }
})
