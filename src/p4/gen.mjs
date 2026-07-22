// p4 — cytoscape + dagre 產線 adapter(資料驅動)
//   genPng(data): 正規化繪圖數據 → 轉 cytoscape els → dagre 自動排版渲染 → 回傳 PNG Buffer
//   版面通用化: rankDir 取自數據 dir; nodeSep/rankSep 為通用常數; full:true + 自動尺寸, 無逐圖魔術數字。
import { chromium } from 'playwright'
import { cdnScript } from '../common/cdn.mjs'

// cytoscape + dagre + cytoscape-dagre + cytoscape-svg 由 jsDelivr CDN 載入(免安裝; 版本鎖定見 common/cdn.mjs)

// 正規化數據 → cytoscape elements(節點帶 parent=group; 邊 dashed→classes）
function toEls(data) {
    const els = []
    for (const nd of data.nodes) els.push({ data: { id: nd.id, label: nd.label, parent: nd.group }, classes: nd.cls })
    for (const ed of data.edges) els.push({ data: { source: ed.from, target: ed.to, label: ed.label }, classes: ed.kind === 'dashed' ? 'dashed' : undefined })
    return els
}

// 樣式(語意類別→色/形, 對應 common/palette.mjs)
const style = `[
  { "selector":"node", "style":{ "shape":"round-rectangle","background-color":"#eef4fb","border-color":"#3f6fb0","border-width":1.8,"label":"data(label)","text-valign":"center","text-halign":"center","font-family":"Microsoft JhengHei, sans-serif","font-size":14,"color":"#1c2b36","width":"label","height":"label","padding":"10px","text-wrap":"wrap","text-max-width":"360px" } },
  { "selector":"node.green", "style":{ "background-color":"#eaf4ef","border-color":"#348a5c" } },
  { "selector":"node.orange", "style":{ "background-color":"#fcf0e2","border-color":"#c46e1a" } },
  { "selector":"node.purple", "style":{ "background-color":"#f4f0fa","border-color":"#8163ad" } },
  { "selector":"node.red", "style":{ "background-color":"#fbecea","border-color":"#c0392b" } },
  { "selector":"node.done", "style":{ "background-color":"#eaf4ef","border-color":"#256046","color":"#256046" } },
  { "selector":"node.diamond", "style":{ "shape":"diamond","background-color":"#fcf0e2","border-color":"#c46e1a","padding":"34px","text-max-width":"120px" } },
  { "selector":":parent", "style":{ "text-valign":"top","text-halign":"center","font-family":"Microsoft JhengHei, sans-serif","font-weight":"bold","padding":"16px","background-opacity":0.35,"border-width":2,"z-compound-depth":"bottom" } },
  { "selector":"node.blueG", "style":{ "background-color":"#f5f9fe","border-color":"#3f6fb0","color":"#3f6fb0" } },
  { "selector":"node.blueG2", "style":{ "background-color":"#eef4fb","border-color":"#3f6fb0","color":"#3f6fb0" } },
  { "selector":"node.greenG", "style":{ "background-color":"#f0f7f3","border-color":"#348a5c","color":"#348a5c" } },
  { "selector":"node.greenG2", "style":{ "background-color":"#eaf4ef","border-color":"#348a5c","color":"#348a5c" } },
  { "selector":"node.orangeG", "style":{ "background-color":"#fdf6ec","border-color":"#c46e1a","color":"#c46e1a" } },
  { "selector":"node.purpleG", "style":{ "background-color":"#faf7fd","border-color":"#8163ad","color":"#8163ad" } },
  { "selector":"edge", "style":{ "width":2.2,"line-color":"#44505a","target-arrow-color":"#44505a","target-arrow-shape":"triangle","curve-style":"bezier","label":"data(label)","font-family":"Microsoft JhengHei, sans-serif","font-size":12.5,"color":"#4a5560","text-background-opacity":0,"text-outline-color":"#ffffff","text-outline-width":3,"text-margin-y":-2,"text-wrap":"wrap" } },
  { "selector":"edge.dashed", "style":{ "line-style":"dashed" } }
]`

const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
${cdnScript('cytoscape')}
${cdnScript('dagre')}
${cdnScript('cytoscape-dagre')}
${cdnScript('cytoscape-svg')}
</head><body style="margin:0;background:#fff">
<div id="cy" style="width:1400px;height:1400px;background:#fff"></div>
<script>
if (window.cytoscapeDagre) { try { cytoscape.use(window.cytoscapeDagre) } catch(e){} }
if (window.cytoscapeSvg) { try { cytoscape.use(window.cytoscapeSvg) } catch(e){} }
// mode: 'png'(預設) 或 'svg' — 版面/元素/樣式建置流程共用, 僅末端輸出格式不同(genPng 行為不變)
window.renderFig = function(els, styleJson, rankDir, mode){ return new Promise(function(resolve){
  try {
    var cy = cytoscape({ container: document.getElementById('cy'), elements: els, style: JSON.parse(styleJson) })
    els.forEach(function(x){ if (x.classes && x.data && x.data.id) cy.getElementById(x.data.id).addClass(x.classes) })
    var l = cy.layout({ name:'dagre', rankDir:rankDir, nodeSep:42, rankSep:55, edgeSep:18 })
    l.promiseOn('layoutstop').then(function(){
      setTimeout(function(){
        try {
          var bb=cy.elements().boundingBox()
          if (mode === 'svg') { window.__svg = cy.svg({ full:true, scale:2, bg:'#ffffff' }) }
          else { window.__png = cy.png({ full:true, scale:2, bg:'#ffffff', output:'base64' }) }
          resolve({ ok:true, w:Math.round(bb.w), h:Math.round(bb.h) })
        }
        catch(e){ resolve({ ok:false, err:String(e.message||e) }) }
      }, 250)
    })
    l.run()
  } catch(e){ resolve({ ok:false, err:String(e.message||e) }) }
})}
window.__ready = true
</script></body></html>`

// 共用渲染流程 — 啟動 headless 頁面, 建置 cytoscape + dagre 版面, 回傳指定 mode 之末端輸出(base64 png 或 svg 字串)
// 供 genPng/genSvg 共用(genPng 行為不變: mode 傳 'png' 與原本 3 參數呼叫等價)
async function renderPage(data, mode) {
    const browser = await chromium.launch()
    try {
        const page = await browser.newPage({ deviceScaleFactor: 1 })
        await page.setContent(html, { waitUntil: 'load' })
        await page.waitForFunction(() => window.__ready, { timeout: 60000 }).catch(() => {})
        await page.evaluate(() => document.fonts && document.fonts.ready)
        const res = await page.evaluate(([els, st, rd, md]) => window.renderFig(els, st, rd, md), [toEls(data), style, data.dir, mode])
        if (!res.ok) throw new Error(res.err)
        return await page.evaluate((m) => (m === 'svg' ? window.__svg : window.__png), mode)
    } finally {
        await browser.close()
    }
}

// 單張渲染 — 供其他模組 import 使用
// data: 正規化繪圖數據 { dir, nodes, edges }(caller 已先做 label 衍生)
// 回傳: PNG 圖片的 Node Buffer
export async function genPng(data, opt = {}) {
    const b64 = await renderPage(data, 'png')
    return Buffer.from(b64, 'base64')
}

// 單張渲染 — 供其他模組 import 使用(cytoscape-svg 外掛匯出, 與 genPng 共用相同版面/樣式/scale)
// data: 正規化繪圖數據 { dir, nodes, edges }(caller 已先做 label 衍生)
// 回傳: SVG 字串
export async function genSvg(data, opt = {}) {
    let svg = await renderPage(data, 'svg')
    svg = svg.replace(/&nbsp;/g, '&#160;')
    if (!/\sxmlns=/.test(svg)) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
    if (!/font-family/.test(svg)) svg = svg.replace('>', '><style>text{font-family:\'Microsoft JhengHei\',sans-serif}</style>')
    return svg
}
