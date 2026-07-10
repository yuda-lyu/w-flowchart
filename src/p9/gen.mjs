// p9 — React Flow + dagre 產線 adapter(資料驅動)
//   genPng(data): 正規化繪圖數據 → translate() 轉成 page9.html 之 renderFig spec(layout:'dagrec')
//   → React Flow 渲染 + compound dagre 自動排版 → 截圖回傳 PNG Buffer
//   版面通用化: rankDir 取自數據 dir; 節點尺寸由標籤字數/行數量測(page9.html sizeOf);
//   群組容器尺寸/位置/畫布大小全由 dagre cluster 自動推算; 無逐圖魔術數字。
import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import fs from 'fs'

import { pkgScript, pkgText } from '../common/pkg.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
// React / ReactDOM / @xyflow/react(UMD)/ @dagrejs/dagre 由本機 node_modules 內聯注入(取代 esm.sh, 斷網環境可用)
//   replace 用函式形式回傳, 避免庫碼內 $ 序列被當作替換樣板
const html = fs.readFileSync(`${__dir}/page9.html`, 'utf8')
    .replace('/*__XYFLOW_CSS__*/', () => pkgText('@xyflow/react/dist/style.css'))
    .replace('/*__REACT_JS__*/', () => pkgScript('react/umd/react.production.min.js'))
    .replace('/*__REACT_DOM_JS__*/', () => pkgScript('react-dom/umd/react-dom.production.min.js'))
    .replace('/*__XYFLOW_JS__*/', () => pkgScript('@xyflow/react/dist/umd/index.js'))
    .replace('/*__DAGRE_JS__*/', () => pkgScript('@dagrejs/dagre/dist/dagre.min.js'))

// 正規化數據 → page9.html renderFig spec
//   標籤「不預折」, 原樣傳入, 由 page9.html 量測 div(max-width + overflow-wrap)自然折行:
//   中文於字間斷行、英數 token 於空白/標點斷, 不會攔腰斷字; diamond 由 kind 自動成菱形; dashed 邊保留; dir → dagre rankDir。
//   nodesep/ranksep 為通用常數(非逐圖客製), 控制節點/層間距。
function translate(data) {
    const nodes = data.nodes.map((n) => {
        const o = { id: n.id, label: n.label, kind: n.cls }
        if (n.group) o.parent = n.group
        return o
    })
    const edges = data.edges.map((e) => {
        const o = { s: e.from, t: e.to }
        if (e.label) o.l = e.label
        if (e.kind === 'dashed') o.dashed = true
        return o
    })
    return { layout: 'dagrec', rankDir: data.dir || 'TB', nodesep: 38, ranksep: 44, nodes, edges }
}

// 單張渲染: 輸入正規化繪圖數據(結構同 FIGURES[n].data), 回傳 PNG 的 Node Buffer
export async function genPng(data, opt = {}) {
    const browser = await chromium.launch()
    try {
        const page = await browser.newPage({ deviceScaleFactor: 2 })
        const errs = []
        page.on('pageerror', e => errs.push(e.message))
        page.on('console', m => { if (m.type() === 'error') errs.push('c:' + m.text().slice(0, 200)) })
        await page.setContent(html, { waitUntil: 'load' })
        await page.waitForFunction(() => document.title === 'READY' || document.title === 'FAIL', { timeout: 60000 }).catch(() => {})
        const boot = await page.evaluate(() => ({ t: document.title, err: window.__err }))
        if (boot.t !== 'READY') throw new Error('BOOT FAIL :: ' + boot.err + ' | ' + errs.slice(0, 6).join(' | '))
        const spec = translate(data)
        const res = await page.evaluate(s => window.renderFig(s), spec)
        if (!res.ok) throw new Error('FAIL :: ' + res.err)
        await page.evaluate(() => document.fonts && document.fonts.ready)
        await page.waitForTimeout(250)
        return await page.locator('#shot').screenshot()
    } finally {
        await browser.close()
    }
}
