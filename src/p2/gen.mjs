// p2 — mermaid@11 + ELK 產線 adapter(資料驅動)
//   genPng(data): 正規化繪圖數據 → 轉 mermaid flowchart DSL → ELK 自動排版渲染 → 回傳 PNG Buffer
//   版面通用化: dir 取自 data.dir; 子群組方向自動取補方向; classDef/顏色取自 palette;
//   無逐圖魔術數字, ELK 全自動排版。
import { chromium } from 'playwright'
import { PALETTE, isGroupCls } from '../common/palette.mjs'
import { cdnUrl } from '../common/cdn.mjs'

// mermaid@11 與 layout-elk 為 chunk 式 ESM, 由 jsDelivr CDN 以 import() 動態載入(免安裝; 版本鎖定見 common/cdn.mjs)
//   (相對 chunk import 由 jsDelivr 循同 origin 自動解析)

const FM = `---\nconfig:\n  layout: elk\n---\n`

// 正規化數據 → mermaid flowchart DSL 字串
// 策略:
//   1. flowchart {dir} 開頭
//   2. 建立 group→children 樹, 遞迴輸出 subgraph 區塊
//   3. 子群組方向 = 補方向(dir=TB → innerDir=LR; dir=LR → innerDir=TB)
//   4. 純葉節點(無 group, 非 isGroupCls): 直接輸出節點行
//   5. diamond cls → {label} 語法; 其他 → ["label"] 語法
//   6. edges: dashed → -.->, solid → -->; 有 label → |"label"| 插入
//   7. classDef: 對每個出現的 cls 從 palette 取色, 統一輸出; class 行將同 cls 節點合併
export function translate(data) {
    const dir = data.dir || 'TB'
    const innerDir = dir === 'TB' ? 'LR' : 'TB'

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

    // 建立 group → children 映射(children 依 nodes 原序)
    const childrenOf = {}  // groupId → [nodeId]
    const nodeById = {}
    for (const nd of data.nodes) {
        nodeById[nd.id] = nd
        if (nd.group) {
            if (!childrenOf[nd.group]) childrenOf[nd.group] = []
            childrenOf[nd.group].push(nd.id)
        }
    }

    // 頂層節點: 無 group 屬性的節點
    const topNodes = data.nodes.filter(nd => !nd.group)

    const lines = []

    // 遞迴輸出: 若節點為群組容器(isGroupCls)→ 輸出 subgraph 區塊; 否則輸出節點行
    function renderNode(nd, indent) {
        const sp = '  '.repeat(indent)
        if (isGroupCls(nd.cls)) {
            lines.push(`${sp}subgraph ${qid(nd.id)}["${nd.label}"]`)
            lines.push(`${sp}  direction ${innerDir}`)
            const kids = childrenOf[nd.id] || []
            for (const cid of kids) renderNode(nodeById[cid], indent + 1)
            lines.push(`${sp}end`)
        } else {
            const shape = nd.cls === 'diamond'
                ? `{${nd.label}}`
                : `["${nd.label}"]`
            lines.push(`${sp}${qid(nd.id)}${shape}`)
        }
    }

    lines.push(`flowchart ${dir}`)
    for (const nd of topNodes) renderNode(nd, 1)

    // edges
    for (const ed of data.edges) {
        const arrow = ed.kind === 'dashed' ? '-.->' : '-->'
        const lbl = ed.label ? `|"${ed.label}"|` : ''
        lines.push(`  ${qid(ed.from)} ${arrow}${lbl} ${qid(ed.to)}`)
    }

    // classDef: 蒐集所有出現的 cls, 從 palette 取色
    const clsSet = new Set(data.nodes.map(nd => nd.cls))
    const clsByNodes = {}  // cls → [id]
    for (const nd of data.nodes) {
        if (!clsByNodes[nd.cls]) clsByNodes[nd.cls] = []
        clsByNodes[nd.cls].push(nd.id)
    }
    for (const cls of clsSet) {
        const p = PALETTE[cls] || PALETTE.blue
        const fillColor = p.fill
        const strokeColor = p.stroke
        const textColor = p.text
        const sw = isGroupCls(cls) ? '1.5px' : '1.5px'
        lines.push(`  classDef ${cls} fill:${fillColor},stroke:${strokeColor},stroke-width:${sw},color:${textColor};`)
    }
    for (const [cls, ids] of Object.entries(clsByNodes)) {
        lines.push(`  class ${ids.map(qid).join(',')} ${cls};`)
    }

    return lines.join('\n')
}

// 渲染後對 SVG 套用統一視覺加強(邊線加粗/箭頭顏色/框線寬度/邊標籤光暈)
const setup = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<style>
  /* 修正 A: 邊標籤光暈 — paint-order + stroke 白邊讓線段透出、文字仍清晰 */
  .edgeLabel text, .edgeLabel tspan {
    paint-order: stroke fill;
    stroke: #ffffff;
    stroke-width: 3.5px;
    stroke-linejoin: round;
  }
  /* 修正 A: 邊標籤背景框透明(移除不透明白底, 否則會遮斷轉折線) */
  .edgeLabel rect, .edgeLabel .label-container {
    fill: transparent !important;
    fill-opacity: 0 !important;
    stroke: none !important;
  }
  /* 修正 B: 節點標籤禁止英數識別字被攔腰斷行 */
  .node foreignObject div, .node foreignObject span,
  .label foreignObject div, .label foreignObject span {
    word-break: keep-all;
    overflow-wrap: break-word;
    white-space: normal;
  }
  /* 修正 C: 字型全覆蓋 — subgraph/容器標題(cluster-label)強制 Microsoft JhengHei */
  .cluster-label foreignObject div, .cluster-label foreignObject span,
  .cluster-label text, .cluster-label tspan,
  .nodeLabel, .nodeLabel span, text, tspan {
    font-family: 'Microsoft JhengHei','微軟正黑體',sans-serif !important;
  }
</style>
</head>
<body style="margin:0;background:#fff;font-family:'微軟正黑體','Microsoft JhengHei',sans-serif">
<div id="box" style="display:inline-block;padding:24px"></div>
<script type="module">
try {
  const mermaid = (await import('${cdnUrl('mermaid11-esm')}')).default
  const elk = (await import('${cdnUrl('layout-elk-esm')}')).default
  mermaid.registerLayoutLoaders(elk)
  mermaid.initialize({ startOnLoad:false, theme:'base', flowchart:{ useMaxWidth:false }, themeVariables:{ fontFamily:"'微軟正黑體','Microsoft JhengHei',sans-serif", fontSize:'17px', primaryColor:'#eef4fb', primaryBorderColor:'#3f6fb0', lineColor:'#44505a', primaryTextColor:'#1c2b36' } })
  window.renderFig = async (code, idx) => {
    try {
      const { svg } = await mermaid.render('g'+idx, code)
      const box = document.getElementById('box'); box.innerHTML = svg
      const svgEl = box.querySelector('svg')
      try {
        const vb = svgEl.viewBox && svgEl.viewBox.baseVal
        let w = vb && vb.width, h = vb && vb.height
        if (!w || !h) { const bb = svgEl.getBBox(); w = bb.width; h = bb.height }
        svgEl.style.maxWidth = 'none'
        svgEl.setAttribute('width', Math.ceil(w))
        svgEl.setAttribute('height', Math.ceil(h))
      } catch(e){}
      const DK='#333333', W='3px'
      box.querySelectorAll('.edgePaths path, .edgePath path, path.flowchart-link, g.edgePaths path').forEach(p=>{p.style.setProperty('stroke',DK,'important');p.style.setProperty('stroke-width',W,'important')})
      box.querySelectorAll('marker path, .marker, .marker path').forEach(m=>{m.style.setProperty('fill',DK,'important');m.style.setProperty('stroke',DK,'important')})
      box.querySelectorAll('.node rect, .node polygon, .node circle, .node path').forEach(n=>n.style.setProperty('stroke-width','2px','important'))
      box.querySelectorAll('.cluster rect, .cluster polygon, .cluster path').forEach(c=>{c.style.setProperty('stroke','#777','important');c.style.setProperty('stroke-width','1.5px','important')})
      // 修正 A (JS 層): 邊標籤背景矩形透明 + 文字白色光暈(JS inline style 強制覆蓋 mermaid 注入的樣式)
      box.querySelectorAll('.edgeLabel rect, .edgeLabel .label-container').forEach(r=>{
        r.style.setProperty('fill','transparent','important')
        r.style.setProperty('fill-opacity','0','important')
        r.style.setProperty('stroke','none','important')
      })
      box.querySelectorAll('.edgeLabel text, .edgeLabel tspan').forEach(t=>{
        t.style.setProperty('paint-order','stroke fill','important')
        t.style.setProperty('stroke','#ffffff','important')
        t.style.setProperty('stroke-width','3.5px','important')
        t.style.setProperty('stroke-linejoin','round','important')
      })
      // 修正 C (JS 層): 字型全覆蓋 — subgraph/容器標題 cluster-label + 所有 SVG text/tspan
      const FF = "'Microsoft JhengHei','微軟正黑體',sans-serif"
      box.querySelectorAll('.cluster-label foreignObject div, .cluster-label foreignObject span').forEach(el=>{
        el.style.setProperty('font-family',FF,'important')
      })
      box.querySelectorAll('text, tspan').forEach(el=>{
        el.style.setProperty('font-family',FF,'important')
      })
      if (document.fonts && document.fonts.ready) await document.fonts.ready
      return { ok:true }
    } catch(e){ return { ok:false, err:(e&&(e.message||e.stack))||String(e) } }
  }
  window.__ready = true
} catch(e){ window.__setupErr = (e&&(e.message||e.stack))||String(e) }
</script></body></html>`

// 渲染單張至就緒頁面(renderFig 完成); caller 負責 close browser
// data: 正規化繪圖數據 { dir, nodes, edges }(caller 已先做 label 衍生)
async function renderFigPage(data) {
    const code = FM + translate(data)
    const browser = await chromium.launch()
    try {
        const page = await browser.newPage({ deviceScaleFactor: 2 })
        await page.setContent(setup, { waitUntil: 'load' })
        await page.waitForFunction(() => window.__ready || window.__setupErr, { timeout: 90000 }).catch(() => {})
        const setupErr = await page.evaluate(() => window.__setupErr)
        if (setupErr) throw new Error(setupErr)
        const r = await page.evaluate(([c, idx]) => window.renderFig(c, idx), [code, 0])
        if (!r.ok) throw new Error(r.err)
        await page.waitForTimeout(250)
        return { browser, page }
    }
    catch (err) {
        await browser.close()
        throw err
    }
}

// 單張渲染 → PNG Buffer
export async function genPng(data, opt = {}) {
    const { browser, page } = await renderFigPage(data)
    try {
        return await page.locator('#box svg').screenshot()
    } finally {
        await browser.close()
    }
}

// 單張渲染 → SVG 字串(#box 內後處理完成之 SVG; &nbsp; 正規化為 &#160; 使其為合法 standalone SVG)
//   頁面 <head><style> 之視覺修正 CSS(邊標籤透明底/光暈/字型覆蓋)序列化後會遺失 → 內嵌進 SVG 根使其 standalone
export async function genSvg(data, opt = {}) {
    const { browser, page } = await renderFigPage(data)
    try {
        return (await page.evaluate(() => {
            const el = document.querySelector('#box svg')
            const css = Array.from(document.querySelectorAll('head style')).map(s => s.textContent).join('\n')
            const st = document.createElementNS('http://www.w3.org/2000/svg', 'style')
            st.textContent = css
            el.insertBefore(st, el.firstChild)
            const out = document.getElementById('box').innerHTML
            st.remove()
            return out
        })).replace(/&nbsp;/g, '&#160;').trim()
    } finally {
        await browser.close()
    }
}
