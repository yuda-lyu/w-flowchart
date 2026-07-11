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
import { DIAMOND_CASES } from './cases-diamond.mjs'
import { FIGURES } from './figures.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const SNAP = resolve(__dir, 'pics', 'p10')
const MAXDIFF = 60   // PNG 容許之反鋸齒雜訊像素上限(真 regression 量級遠超此)
const UPDATE = process.env.UPDATE_BASELINE === '1' || process.env.UPDATE_BASELINE === 'true'

// 待測清單: 合成案 + 菱形進出組合案 + 範例圖
const items = []
for (const c of CASES) items.push({ name: c.name, data: c.data, check: c.check, expect: c.expect, kind: '合成' })
for (const c of DIAMOND_CASES) items.push({ name: c.name, data: c.data, check: c.check, kind: '菱形' })
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

    // 菱形進出組合規則之單元驗證: 直接對頁內繪製函式(window.__dia)驅動 13 種組合,
    // 不受 ELK 佈局埠序限制(其中「同半側」類組合乾淨合成圖排不出來, 僅能在此層驗證; 見 cases-diamond.mjs 檔頭)。
    it('菱形 13 種進出組合規則(單元驗證)', async function() {
        const fails = await page.evaluate(() => {
            const { diamondSlantMid, diamondInAnchor, routeOutFromVertex, routeInToAnchor } = window.__dia
            const box = { x: 0, y: 0, w: 100, h: 100 }
            const bottom = { ax: 'y', sg: 1, v: { x: 50, y: 100 } }
            const near = (p, q) => Math.abs(p.x - q.x) <= 0.5 && Math.abs(p.y - q.y) <= 0.5
            const mL = diamondSlantMid(box, bottom, -1)
            const mR = diamondSlantMid(box, bottom, 1)
            const v = bottom.v
            // 合成路徑: 出=自底邊 x 下行轉出; 進=自下方沿 x 直上進入底邊
            const mkOut = (x) => [{ x, y: 100 }, { x, y: 160 }, { x: x + 25, y: 160 }, { x: x + 25, y: 300 }]
            const mkIn = (x) => [{ x: x + 40, y: 300 }, { x: x + 40, y: 160 }, { x, y: 160 }, { x, y: 100 }]
            const out = []
            function run(name, outXs, inXs, expectIn) {
                const hasOut = outXs.length > 0
                outXs.forEach((x, i) => {
                    const p = mkOut(x)
                    routeOutFromVertex(p, { ax: 'y', sg: 1, v: { x: 50, y: 100 } })
                    if (!near(p[0], v)) out.push(`${name} 出${i} 未自頂點 (${p[0].x},${p[0].y})`)
                })
                inXs.forEach((x, i) => {
                    const p = mkIn(x)
                    const a = diamondInAnchor(box, bottom, hasOut, p[p.length - 1])
                    routeInToAnchor(p, bottom, a)
                    const e = p[p.length - 1], want = expectIn[i]
                    if (!near(e, want)) out.push(`${name} 進${i} 錨點 (${e.x.toFixed(1)},${e.y.toFixed(1)}) ≠ (${want.x},${want.y})`)
                })
            }
            run('1進', [], [30], [v])
            run('1出', [30], [], [])
            run('2進(同半側)', [], [20, 35], [v, v])
            run('2進(不同半側)', [], [30, 70], [v, v])
            run('2出(同半側)', [20, 35], [], [])
            run('2出(不同半側)', [30, 70], [], [])
            run('1進1出', [30], [70], [mR])
            run('2進1出(進同半側)', [45], [60, 80], [mR, mR])
            run('2進1出(進不同半側)', [45], [20, 80], [mL, mR])
            run('1進2出(出同半側)', [20, 35], [70], [mR])
            run('1進2出(出不同半側)', [20, 80], [45], [mL])
            run('2進2出(進同,出同)', [20, 35], [60, 80], [mR, mR])
            run('2進2出(進不同,出同)', [20, 35], [10, 80], [mL, mR])
            run('2進2出(進同,出不同)', [20, 80], [55, 70], [mR, mR])
            run('2進2出(進不同,出不同)', [20, 80], [40, 60], [mL, mR])
            return out
        })
        assert.deepStrictEqual(fails, [], '規則單元驗證失敗:\n' + fails.join('\n'))
    })
})
