// p10 測試共用 — 重用 gen.mjs 之「真實」管線(translate + PAGE_HTML + window.renderFig), 不複製渲染器(複製會與 production 分叉, 失去測試意義)。
//   openStage(): 啟一個 headless 舞台頁(elkjs + renderFig 就緒)
//   renderCase(page, data): 跑單案真實管線 → { spec, res(含 geom 幾何), svg(字串), png(Buffer) }
//   runInvariants(spec, geom): 對「任何正確 p10 輸出皆須成立」之結構不變量做斷言(spec 翻譯, 非現狀指紋)
import { chromium } from 'playwright'
import { translate, PAGE_HTML } from '../src/p10/gen.mjs'

export { translate }

export async function openStage() {
    const browser = await chromium.launch()
    const page = await browser.newPage({ deviceScaleFactor: 2 })
    const errs = []
    page.on('pageerror', e => errs.push(e.message))
    page.on('console', m => {
        if (m.type() === 'error') errs.push('c:' + m.text().slice(0, 200))
    })
    await page.setContent(PAGE_HTML, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__ready, { timeout: 60000 }).catch(() => {})
    await page.evaluate(() => document.fonts && document.fonts.ready)
    return { browser, page, errs }
}

// 跑單一案例之真實管線 → { spec, res, svg, png }
export async function renderCase(page, data) {
    const spec = translate(data)
    const res = await page.evaluate(s => window.renderFig(s), spec)
    if (!res.ok) return { spec, res, svg: null, png: null }
    await page.evaluate(() => document.fonts && document.fonts.ready)
    await page.waitForTimeout(120)
    const svg = await page.evaluate(() => document.getElementById('stage').innerHTML)
    const png = await page.locator('#stage svg').screenshot()
    return { spec, res, svg, png }
}

// 幾何便捷查詢
export function helpers(geom) {
    return {
        node: id => geom.nodes.find(n => n.id === id),
        group: id => geom.groups.find(g => g.id === id),
    }
}

const within = (c, p, tol) => c.x >= p.x - tol && c.y >= p.y - tol && c.x + c.w <= p.x + p.w + tol && c.y + c.h <= p.y + p.h + tol
const overlap = (a, b, tol) => a.x < b.x + b.w - tol && b.x < a.x + a.w - tol && a.y < b.y + b.h - tol && b.y < a.y + a.h - tol
const near = (p, box, tol) => p.x >= box.x - tol && p.x <= box.x + box.w + tol && p.y >= box.y - tol && p.y <= box.y + box.h + tol

// 通用結構不變量(對所有案例 + 9 真圖皆套用)。每項對應「正確 p10 輸出必成立」之一句 spec, 非「跟上次一樣」之指紋。
//   回 [{ name, pass, detail }]
export function runInvariants(spec, geom) {
    const out = []
    const bbox = {}; geom.groups.forEach(g => bbox[g.id] = g); geom.nodes.forEach(n => bbox[n.id] = n)

    // 1) 存在性: 每個邏輯節點/群組都被畫出(重構不可漏掉元素)
    {
        const gNodes = new Set(geom.nodes.map(n => n.id)); const gGroups = new Set(geom.groups.map(g => g.id))
        const missN = spec.nodes.filter(n => !gNodes.has(n.id)).map(n => n.id)
        const missG = spec.groups.filter(g => !gGroups.has(g.id)).map(g => g.id)
        out.push({ name: '存在性: 節點/群組無遺漏', pass: !missN.length && !missG.length, detail: (missN.length || missG.length) ? `缺節點[${missN}] 缺群組[${missG}]` : `${geom.nodes.length} 節點 / ${geom.groups.length} 群組` })
    }

    // 2) 包含: 有父者其外框 ⊆ 父外框(容器須包住成員, ELK INCLUDE_CHILDREN 合約)
    {
        const bad = []
        ;[...geom.groups, ...geom.nodes].forEach(c => {
            if (c.parent && bbox[c.parent] && !within(c, bbox[c.parent], 1.5)) bad.push(c.id + '⊄' + c.parent)
        })
        out.push({ name: '包含: 成員不逃出容器', pass: !bad.length, detail: bad.length ? bad.slice(0, 4).join(', ') : '全部成員在容器內' })
    }

    // 3) 標題不溢出: 每個容器標題寬 ≤ 容器寬(2-pass padding 撐寬機制之合約)
    {
        const bad = geom.groups.filter(g => g.labelW > g.w + 2).map(g => `${g.id}(標題${g.labelW}>框${g.w})`)
        out.push({ name: '標題不溢出容器', pass: !bad.length, detail: bad.length ? bad.slice(0, 4).join(', ') : '全部標題在框內' })
    }

    // 4) 不重疊: 同一父之葉節點互不重疊(佈局健全性)
    {
        const byParent = {}; geom.nodes.forEach(n => {
            (byParent[n.parent || '_root'] = byParent[n.parent || '_root'] || []).push(n)
        })
        const bad = []
        Object.values(byParent).forEach(arr => {
            for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) if (overlap(arr[i], arr[j], 1.5)) bad.push(arr[i].id + '∩' + arr[j].id)
        })
        out.push({ name: '不重疊: 同層節點分離', pass: !bad.length, detail: bad.length ? bad.slice(0, 4).join(', ') : '節點無重疊' })
    }

    // 5) items 框: 標題+items 節點須有標題列(headH>0)且本體高於標題列
    {
        const its = geom.nodes.filter(n => n.kind === 'items')
        const bad = its.filter(n => !(n.headH > 0 && n.h > n.headH + 4)).map(n => `${n.id}(h=${n.h} headH=${n.headH})`)
        out.push({ name: 'items 框: 標題列+本體完整', pass: !bad.length, detail: its.length ? (bad.length ? bad.join(', ') : `${its.length} 個 items 框正常`) : '(無 items 框)' })
    }

    // 6) 邊: 每條邏輯邊都有路由(≥1 段, ≥2 點), 且兩端點落在來源/目標節點邊界(LCA 容器座標正確 → 不會跑到左上角)
    {
        const idset = new Set(geom.edges.map(e => e.id))
        const missing = spec.edges.filter(e => !idset.has(e.id)).map(e => e.id)
        const noRoute = []; const offTarget = []
        spec.edges.forEach(se => {
            const ge = geom.edges.find(e => e.id === se.id); if (!ge) return
            const seg = ge.segs && ge.segs.find(s => s.length >= 2)
            if (!seg) {
                noRoute.push(se.id); return
            }
            const s0 = seg[0]; const s1 = seg[seg.length - 1]
            const src = bbox[se.from]; const tgt = bbox[se.to]
            if (src && tgt && !(near(s0, src, 6) && near(s1, tgt, 6))) offTarget.push(`${se.id}(${se.from}→${se.to})`)
        })
        const pass = !missing.length && !noRoute.length && !offTarget.length
        out.push({ name: '邊: 皆有路由且兩端接節點', pass, detail: pass ? `${geom.edges.length} 條邊正常` : `缺[${missing}] 無路由[${noRoute}] 端點脫離[${offTarget.slice(0, 4)}]` })
    }

    return out
}
