// p1 — mermaid@10 dagre 產線 adapter(資料驅動)
//   genPng(data): 正規化繪圖數據 → translate → mermaid flowchart DSL → Playwright 渲染 → 回傳 PNG Buffer
//   自動排版: mermaid dagre 自行排版, 無任何逐圖魔術數字。
import { chromium } from 'playwright'
import { PALETTE, isGroupCls } from '../common/palette.mjs'
import { cdnScript } from '../common/cdn.mjs'

// mermaid@10 由 jsDelivr CDN 載入(免安裝; 版本鎖定見 common/cdn.mjs)

// label 內 \n 強制換行 → mermaid htmlLabels 之 <br/>(字面換行在 subgraph 標題會遺失第二行)
const nl = (s) => String(s).replace(/\n/g, '<br/>')

// 把標準節點 label 轉成 mermaid 節點形狀語法(id 經 qid 消歧)
//   diamond → {label}  / 其餘 → ["label"]
function nodeShape(nd, qid) {
    if (nd.cls === 'diamond') return `${qid(nd.id)}{"${nl(nd.label)}"}`
    return `${qid(nd.id)}["${nl(nd.label)}"]`
}

// 正規化數據 → mermaid flowchart DSL 字串
// 流程:
//   1. 收集所有出現的 cls → 產生 classDef 區塊(依 palette 取色)
//   2. 分析群組包含關係(支援二層巢狀, 如 DET 在 CORE 內)
//   3. 輸出 flowchart <dir>
//      a. 先宣告無 group 的非容器節點
//      b. 頂層 subgraph → 直接子節點 → 巢狀 subgraph → 巢狀子節點 → end → end
//      c. edges(dashed 用 -.->, 有 label 用 |".."|)
//      d. classDef + class 指派
function translate(data) {
    const { dir, nodes, edges } = data

    // mermaid 保留字(end/click/style/class/subgraph/direction 等)不可作節點 id → 一律加前綴消歧
    //   僅影響 DSL 內部識別(顯示文字仍用 label); 不同原 id 淨化後若同名, 以序號區隔避免節點被合併
    const used = new Set()
    const qidMap = {}
    const qid = (id) => {
        if (qidMap[id]) return qidMap[id]
        const base = 'n_' + String(id).replace(/[^A-Za-z0-9_]/g, '_')
        let q = base, k = 2
        while (used.has(q)) q = base + '_' + (k++)
        used.add(q)
        qidMap[id] = q
        return q
    }

    // 索引: id → node
    const byId = {}
    for (const nd of nodes) byId[nd.id] = nd

    // 群組容器 id set
    const groupIds = new Set(nodes.filter(nd => isGroupCls(nd.cls)).map(nd => nd.id))

    // 收集所有出現的 cls
    const clsSet = new Set(nodes.map(nd => nd.cls))

    // classDef 行: 每個 cls 對應 palette 色票
    const classDefLines = []
    for (const cls of clsSet) {
        const p = PALETTE[cls] || PALETTE.blue
        if (isGroupCls(cls)) {
            // 容器: text-valign top, bold 不在 classDef 裡控制; 只設填色/框色/字色
            classDefLines.push(`  classDef ${cls} fill:${p.fill},stroke:${p.stroke},stroke-width:1.8px,color:${p.text}`)
        } else if (cls === 'diamond') {
            classDefLines.push(`  classDef ${cls} fill:${p.fill},stroke:${p.stroke},stroke-width:1.6px,color:${p.text}`)
        } else {
            classDefLines.push(`  classDef ${cls} fill:${p.fill},stroke:${p.stroke},stroke-width:1.5px,color:${p.text}`)
        }
    }

    // class 指派行: 每個 cls 一行, 收集該 cls 的所有節點 id
    const clsToIds = {}
    for (const nd of nodes) {
        if (!clsToIds[nd.cls]) clsToIds[nd.cls] = []
        clsToIds[nd.cls].push(nd.id)
    }
    const classLines = []
    for (const [cls, ids] of Object.entries(clsToIds)) {
        classLines.push(`  class ${ids.map(qid).join(',')} ${cls}`)
    }

    // 拓樸: 哪些節點直接屬於哪個容器(含巢狀)
    // topLevel 容器: 自身無 group 的容器
    // nested 容器: 自身有 group 的容器(巢狀放在父容器 subgraph 內)
    const topGroupIds = nodes.filter(nd => isGroupCls(nd.cls) && !nd.group).map(nd => nd.id)
    // 獨立節點(非容器、無 group): 直接輸出在 flowchart 頂層
    const standaloneNodes = nodes.filter(nd => !isGroupCls(nd.cls) && !nd.group)

    // 建立 subgraph 內容產生器(支援巢狀)
    function renderSubgraph(gid, indent) {
        const g = byId[gid]
        const lines = []
        // mermaid10 subgraph 標題不支援 <br/>(後段遺失) → \n 降級為空格(不丟資訊)
        lines.push(`${indent}subgraph ${qid(gid)}["${String(g.label).replace(/\n/g, ' ')}"]`)
        // 直接子節點(非容器)
        const directChildren = nodes.filter(nd => nd.group === gid && !isGroupCls(nd.cls))
        for (const nd of directChildren) {
            lines.push(`${indent}  ${nodeShape(nd, qid)}`)
        }
        // 巢狀容器(容器的 group === gid)
        const nestedGroups = nodes.filter(nd => isGroupCls(nd.cls) && nd.group === gid)
        for (const ng of nestedGroups) {
            lines.push(...renderSubgraph(ng.id, indent + '  '))
        }
        lines.push(`${indent}end`)
        return lines
    }

    // edges DSL
    const edgeLines = []
    for (const ed of edges) {
        const arrow = ed.kind === 'dashed' ? '-..->' : '-->'
        const lbl = ed.label ? `|"${nl(ed.label)}"| ` : ''
        edgeLines.push(`  ${qid(ed.from)} ${arrow} ${lbl}${qid(ed.to)}`)
    }

    // 組裝 DSL
    const lines = [`flowchart ${dir}`]
    // 1. 獨立節點
    for (const nd of standaloneNodes) {
        lines.push(`  ${nodeShape(nd, qid)}`)
    }
    // 2. 頂層 subgraph
    for (const gid of topGroupIds) {
        lines.push(...renderSubgraph(gid, '  '))
    }
    // 3. edges
    lines.push(...edgeLines)
    // 4. classDef + class
    lines.push(...classDefLines)
    lines.push(...classLines)

    return lines.join('\n')
}

// mermaid@10 CDN HTML 外殼: 渲染 DSL → SVG 注入 #box, 截 #box svg
// 沿用舊版完整邏輯(themeCSS 覆蓋邊線色/寬/箭頭, 截圖前確保字型載入)
// 修正 A: 邊標籤白底→透明; 文字加白色光暈(paint-order:stroke + stroke:#fff/stroke-width:3.5px)
// 修正 B: 英數識別字不攔腰斷(word-break:normal; overflow-wrap:break-word)
function mermaidHtml(code) {
    return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
${cdnScript('mermaid10')}
</head><body style="margin:0;background:#fff;font-family:'微軟正黑體','Microsoft JhengHei',sans-serif">
<div id="box" style="display:inline-block;padding:24px"></div>
<script>
mermaid.initialize({ startOnLoad:false, theme:'base', themeVariables:{ fontFamily:"'Microsoft JhengHei','微軟正黑體',sans-serif", fontSize:'17px', primaryColor:'#eef4fb', primaryBorderColor:'#3f6fb0', lineColor:'#44505a', primaryTextColor:'#1c2b36' }, themeCSS: '.flowchart-link{stroke:#44505a !important;stroke-width:2.5px !important;} .edgePaths .path{stroke:#44505a !important;stroke-width:2.5px !important;} .marker,.marker path{fill:#44505a !important;stroke:#44505a !important;} .edgeLabel .label{background:transparent !important;} .edgeLabel{background:transparent !important;} .edgeLabel rect{fill:transparent !important;opacity:0 !important;} .label foreignObject{overflow:visible;} .cluster-label text,.cluster-label span,.cluster-label div,.edgeLabel span{font-family:"Microsoft JhengHei","微軟正黑體",sans-serif !important;}' });
(async () => {
    try {
        const { svg } = await mermaid.render('g', ${JSON.stringify(code)})
        document.getElementById('box').innerHTML = svg
        const DK = '#333333', W = '3px'
        document.querySelectorAll('#box .edgePaths path, #box .edgePath path, #box path.flowchart-link, #box g.edgePaths path').forEach((p) => { p.style.setProperty('stroke', DK, 'important'); p.style.setProperty('stroke-width', W, 'important') })
        document.querySelectorAll('#box marker path, #box .marker, #box .marker path').forEach((m) => { m.style.setProperty('fill', DK, 'important'); m.style.setProperty('stroke', DK, 'important') })
        document.querySelectorAll('#box .node rect, #box .node polygon, #box .node circle, #box .node path').forEach((n) => { n.style.setProperty('stroke-width', '2px', 'important') })
        document.querySelectorAll('#box .cluster rect, #box .cluster polygon, #box .cluster path').forEach((c) => { c.style.setProperty('stroke', '#777777', 'important'); c.style.setProperty('stroke-width', '1.5px', 'important') })
        // 修正 A: 邊標籤背景透明 + 白色光暈(透過 foreignObject 內 span 的 CSS)
        document.querySelectorAll('#box .edgeLabel rect, #box .edgeLabel .label').forEach((el) => {
            el.style.setProperty('fill', 'transparent', 'important')
            el.style.setProperty('background', 'transparent', 'important')
            el.style.setProperty('opacity', '1', 'important')
        })
        document.querySelectorAll('#box .edgeLabel foreignObject').forEach((fo) => {
            fo.style.setProperty('overflow', 'visible', 'important')
        })
        document.querySelectorAll('#box .edgeLabel span, #box .edgeLabel .edgeLabel').forEach((sp) => {
            sp.style.setProperty('background', 'transparent', 'important')
            sp.style.setProperty('color', '#4a5560', 'important')
            // 字型覆蓋: 邊標籤 span 可能繼承系統字型, 強制指定
            sp.style.setProperty('font-family', "'Microsoft JhengHei', '微軟正黑體', sans-serif", 'important')
            // 白色光暈: CSS text-shadow 多向
            sp.style.setProperty('text-shadow', '-1.5px -1.5px 0 #fff, 1.5px -1.5px 0 #fff, -1.5px 1.5px 0 #fff, 1.5px 1.5px 0 #fff, 0 -2px 0 #fff, 0 2px 0 #fff, -2px 0 0 #fff, 2px 0 0 #fff', 'important')
            // 修正 B: 英數識別字不攔腰斷
            sp.style.setProperty('word-break', 'normal', 'important')
            sp.style.setProperty('overflow-wrap', 'break-word', 'important')
        })
        // 字型覆蓋: cluster(subgraph)標題文字 — mermaid@10 的 .cluster-label text/span 不繼承 fontFamily themeVariable
        document.querySelectorAll('#box .cluster-label text, #box .cluster-label span, #box .cluster-label div').forEach((el) => {
            el.style.setProperty('font-family', "'Microsoft JhengHei', '微軟正黑體', sans-serif", 'important')
        })
        document.title = 'DONE'
    }
    catch (e) {
        document.title = 'FAIL'
        console.log('mmErr', e.message)
    }
})()
</script></body></html>`
}

// 渲染單張至就緒頁面(mermaid DONE + 字型就緒), deviceScaleFactor:4(向量圖放大提高清晰度); caller 負責 close browser
async function renderFigPage(code) {
    const browser = await chromium.launch()
    try {
        const page = await browser.newPage({ deviceScaleFactor: 4 })
        await page.setContent(mermaidHtml(code), { waitUntil: 'load' })
        await page.waitForFunction(() => document.title === 'DONE' || document.title === 'FAIL', { timeout: 30000 })
        const title = await page.title()
        if (title !== 'DONE') {
            const msg = await page.evaluate(() => { const el = document.getElementById('box'); return el ? el.innerText : '' })
            throw new Error(`mermaid render failed: ${msg}`)
        }
        await page.evaluate(() => document.fonts.ready)
        return { browser, page }
    }
    catch (err) {
        await browser.close()
        throw err
    }
}

// 單張渲染 → PNG Buffer(供 WFlowchart 統一入口呼叫; 自帶瀏覽器生命週期)
async function genPng(data, opt = {}) {
    const { browser, page } = await renderFigPage(translate(data))
    try {
        return await page.locator('#box svg').screenshot()
    }
    finally {
        await browser.close()
    }
}

// 單張渲染 → SVG 字串(#box 內後處理完成之 SVG; &nbsp; 正規化為 &#160; 使其為合法 standalone SVG)
//   mermaid 之 svg 為響應式(width:100% + max-width), 脫離頁面尺寸會漂移 → 序列化前依 viewBox 寫死 width/height
async function genSvg(data, opt = {}) {
    const { browser, page } = await renderFigPage(translate(data))
    try {
        return (await page.evaluate(() => {
            const el = document.querySelector('#box svg')
            const vb = el.viewBox.baseVal
            el.style.maxWidth = 'none'
            el.setAttribute('width', Math.ceil(vb.width))
            el.setAttribute('height', Math.ceil(vb.height))
            return document.getElementById('box').innerHTML
        })).replace(/&nbsp;/g, '&#160;').trim()
    }
    finally {
        await browser.close()
    }
}

export { genPng, genSvg }
