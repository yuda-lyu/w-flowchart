// p6 — AntV G6 v5 產線 adapter(資料驅動)
//   genPng(data): 正規化繪圖數據 → translate 轉 G6 { nodes, combos, edges } → antv-dagre 自動排版
//   → 緊湊固定間距(nodesep/ranksep, 不掃描放大) → 渲染 → 回傳 PNG Buffer
//   版面通用化: rankdir 取自數據 dir; 間距為全圖共用緊湊常數; 大畫布 + autoFit:'view', 無逐圖 w/h/edgeType 魔術數字。
//
// 三大核心品質原則(全庫設定層落實, 非逐圖補):
//   原則1 字型全覆蓋: node / edge / combo 三層 graph 預設 + 各元素 style 皆設 labelFontFamily=FONT(JhengHei),
//          任一層漏設仍由 graph 預設兜底, 確保節點/邊標籤/容器標題全用同一字型。
//   原則2 z-order 解遮蓋: combo(半透明填色)zIndex 墊底(COMBO_Z), 節點居中(預設), 邊與邊標籤畫最上層(EDGE_Z);
//          即使非成員節點幾何落入容器框, 其不透明節點本體與最上層邊標籤皆不被容器填色染淡或遮住。
//   原則3 緊湊不撐大: 不做「碰撞偵測 sweep 放大間距 until 零碰撞」; 採固定緊湊間距, 維持報告可用的緊湊尺寸。
//          若緊湊間距下仍有節點互疊且非 z-order 可解, 則保持緊湊留下重疊(代表此套不適合此圖, 由挑選階段換別套)。
import { chromium } from 'playwright'
import { colorOf, isGroupCls, EDGE, FONT } from '../common/palette.mjs'
import { pkgScript } from '../common/pkg.mjs'

// G6 v5 由本機 node_modules 內聯注入(取代 CDN, 斷網環境可用)
const G6_JS = pkgScript('@antv/g6/dist/g6.min.js')
// genSvg 專用:@antv/g-svg renderer(取代預設 canvas renderer, 產出 SVG DOM)。
//   依賴 @antv/g-lite UMD(暴露全域 window.G)須先於 g-svg UMD 載入(g-svg UMD 讀取既有 window.G 掛載 window.G.SVG)。
const G_LITE_JS = pkgScript('@antv/g-lite/dist/index.umd.min.js')
const G_SVG_JS = pkgScript('@antv/g-svg/dist/index.umd.min.js')

// ===== 通用排版常數(全圖共用, 無逐圖客製) =====
const CANVAS = 2200          // 大畫布:給足夠空間, 配合 autoFit:'view' 自動縮放, 不逐圖設 w/h
// 原則3:緊湊固定間距(不掃描放大)。nodesep 同層節點間距、ranksep 層距, 取緊湊值維持報告可用尺寸。
const NODESEP = 28           // 同層節點間距(緊湊;取代舊版碰撞偵測 sweep 22→86)
const RANKSEP = 60           // 層距(緊湊;取代舊版碰撞偵測 sweep 48→190)
// 原則2:繪製順序(z-index)。combo 墊底、節點居中(預設 1)、邊與邊標籤最上層。
const COMBO_Z = -10          // 容器填色墊最底(半透明填色不染淡其上節點/文字)
const EDGE_Z = 100           // 邊與邊標籤畫最上層(不被任何區塊遮住)
// 標籤量測(依字數/行數推節點尺寸): CJK 約 15.5px/字, 英數/符號約 8.5px
const CJK_W = 15.5
const ASCII_W = 8.5
const LINE_H = 26            // 每行高度
const PAD_W = 34             // 矩形左右內距總和
const PAD_H = 20             // 矩形上下內距總和
const DIAMOND_KW = 60        // 菱形相對矩形之額外寬(通用常數, 取代舊版逐呼叫 +60)
const DIAMOND_KH = 50        // 菱形相對矩形之額外高(通用常數, 取代舊版逐呼叫 +50)

// 依標籤算尺寸(通用公式:逐字寬 + 內距; 高度依行數)
function measure(label) {
    const lines = String(label).split('\n')
    const widthOf = (s) => [...s].reduce((a, ch) => a + (/[一-鿿（）／]/.test(ch) ? CJK_W : ASCII_W), 0)
    const w = Math.round(Math.max(...lines.map(widthOf)) + PAD_W)
    const h = Math.round(lines.length * LINE_H + PAD_H)
    return [w, h]
}

// 正規化數據 → G6 v5 輸入 { nodes, combos, edges }
//   群組容器(cls 結尾 G/G2)→ combos(可巢狀:容器本身帶 group 時設 combo=父容器)
//   其餘節點 → nodes(type rect/diamond 依 palette.shape; combo=所屬容器; 樣式依 cls)
//   邊 → polyline; kind:dashed → lineDash;
//   邊標籤 → 背景框透明(labelBackground:false, 不遮轉折線)+ 白色光暈描邊(labelStroke/labelLineWidth/labelPaintOrder:'stroke')
function translate(data) {
    const nodes = []
    const combos = []
    // G6 v5 不接受以 combo id 當邊端點; 建「容器 → 代表葉節點」對照, 將指向容器的邊改接其代表成員。
    //   通用化舊版「層級邊改走成員節點(fe1→if1)」的手法:取容器內數據序第一個「可達」葉節點為代表;
    //   容器內可能只有子容器(深巢狀), 故須遞迴下鑽, 不能只看直屬成員。
    const comboIds = new Set(data.nodes.filter(nd => isGroupCls(nd.cls)).map(nd => nd.id))
    const childrenOf = {}
    for (const nd of data.nodes) {
        if (nd.group) (childrenOf[nd.group] = childrenOf[nd.group] || []).push(nd)
    }
    const firstLeaf = (cid) => {
        for (const ch of (childrenOf[cid] || [])) {
            if (!isGroupCls(ch.cls)) return ch.id
            const r = firstLeaf(ch.id)
            if (r) return r
        }
        return null
    }
    const resolveEnd = (id) => (comboIds.has(id) && firstLeaf(id)) || id
    for (const nd of data.nodes) {
        const c = colorOf(nd.cls)
        if (isGroupCls(nd.cls)) {
            combos.push({
                id: nd.id,
                combo: nd.group,                  // 巢狀容器(如 DET in CORE / FES in FE):父容器 id
                type: 'rect',
                style: {
                    // 原則2:容器填色墊最底, 半透明填色不會染淡/遮住其上節點與文字
                    zIndex: COMBO_Z,
                    labelText: nd.label, labelPlacement: 'top',
                    labelFontFamily: FONT, labelFontSize: 15, labelFontWeight: 700, labelFill: c.text,
                    fill: c.fill, fillOpacity: 0.3, stroke: c.stroke, lineWidth: 2,
                },
            })
            continue
        }
        const isDiamond = c.shape === 'diamond'
        let [w, h] = measure(nd.label)
        if (isDiamond) { w += DIAMOND_KW; h += DIAMOND_KH }   // 菱形需更大內距容納斜邊
        nodes.push({
            id: nd.id,
            combo: nd.group,                      // 所屬容器 id(無則 undefined)
            type: isDiamond ? 'diamond' : 'rect',
            style: {
                size: [w, h], radius: isDiamond ? 0 : 6, lineWidth: 1.8,
                // 節點本體不透明(fillOpacity 預設 1), 居於 combo 之上, 完整遮住其下半透明容器填色
                fill: c.fill, stroke: c.stroke,
                labelText: nd.label, labelPlacement: 'center', labelFill: c.text,
                labelFontSize: 14, labelFontFamily: FONT,
            },
        })
    }
    let eid = 0
    const edges = data.edges.map((ed) => {
        eid++
        const dashed = ed.kind === 'dashed'
        return {
            id: 'e' + eid, source: resolveEnd(ed.from), target: resolveEnd(ed.to),
            style: {
                // 原則2:邊與邊標籤畫最上層, 不被容器填色或任何區塊遮住
                zIndex: EDGE_Z,
                lineWidth: 2.2, endArrow: true,
                stroke: dashed ? colorOf('orange').stroke : EDGE.line,
                lineDash: dashed ? [7, 5] : undefined,
                labelText: ed.label || '',
                labelFontFamily: FONT, labelFontSize: 12.5, labelFill: EDGE.text,
                // 背景框透明(不遮轉折線)+ 文字白色光暈描邊(paint-order:stroke 使白邊在文字之後繪, 形成光暈)
                labelBackground: false,
                labelStroke: EDGE.haloColor, labelLineWidth: EDGE.haloWidth, labelPaintOrder: 'stroke',
                labelAutoRotate: false,
            },
        }
    })
    return { nodes, combos, edges }
}

// ===== 渲染外殼(CDN 載入 G6 v5 + render + toDataURL overall 截圖) =====
//   原則1:graph 三層(node/edge/combo)預設 labelFontFamily 統一為 FONT, 任一元素層漏設仍由此兜底。
//   原則2:combo.style.zIndex 墊底、edge.style.zIndex 最上層(於 translate 各元素已設, graph 預設再兜底)。
//   原則3:固定緊湊 nodesep/ranksep, 無碰撞偵測掃描放大。
const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<script>${G6_JS}</script>
</head><body style="margin:0;background:#fff">
<div id="g6" style="background:#fff"></div>
<script>
window.renderFig = async function(g, rankdir, nodesep, ranksep, canvas, font, comboZ, edgeZ){
  try {
    const el = document.getElementById('g6')
    el.style.width = canvas + 'px'; el.style.height = canvas + 'px'
    if (window.__graph) { try { window.__graph.destroy() } catch(e){} }
    const graph = new G6.Graph({
      container: el, width: canvas, height: canvas, autoFit:'view',
      data: { nodes: g.nodes, edges: g.edges, combos: g.combos },
      layout: { type:'antv-dagre', rankdir: rankdir, nodesep: nodesep, ranksep: ranksep, sortByCombo: (g.combos && g.combos.length>0) },
      // 原則2:combo 墊底、edge 最上層之 graph 預設(各元素 style 已設, 此處兜底)
      combo: { type:'rect', style:{ zIndex: comboZ, padding:[30,18,18,18], labelPlacement:'top', labelFontFamily: font } },
      edge: { type:'polyline', style:{ zIndex: edgeZ, lineWidth:2.2, endArrow:true, labelFontFamily: font } },
      // 原則1:node/edge/combo 三層 graph 預設字型統一(JhengHei), 全覆蓋兜底
      node: { style:{ labelFontFamily: font } },
    })
    window.__graph = graph
    await graph.render()
    await new Promise(r=>setTimeout(r,300))
    return { ok:true }
  } catch(e){ return { ok:false, err:String(e&&(e.stack||e.message)||e).slice(0,400) } }
}
// 以目前已渲染之圖截圖
window.snap = async function(){
  try {
    await new Promise(r=>setTimeout(r,200))
    const png = await window.__graph.toDataURL({ mode:'overall' })
    return { ok:true, png }
  } catch(e){ return { ok:false, err:String(e&&(e.stack||e.message)||e).slice(0,400) } }
}
window.__ready=true
</script></body></html>`

// 單張渲染:給定單份正規化繪圖數據(結構同 FIGURES[n].data, caller 已先做 label 衍生)→ PNG Buffer。
//   供其他程式 import 呼叫, 不落地寫檔。沿用批次流程完全相同之 translate/render/擷圖邏輯
//   (window.renderFig 排版渲染 + window.snap 之 toDataURL overall 裁切擷圖), 僅將輸出由寫檔改為
//   回傳 Buffer, 故視覺輸出(含裁切範圍)與批次流程逐圖產出完全一致。
export async function genPng(data, opt = {}) {
    const browser = await chromium.launch()
    try {
        const page = await browser.newPage({ deviceScaleFactor: 2 })
        const errs = []
        page.on('pageerror', e => errs.push(e.message))
        page.on('console', m => { if (m.type() === 'error') errs.push('c:' + m.text()) })
        await page.setContent(html, { waitUntil: 'load' })
        await page.waitForFunction(() => window.__ready, { timeout: 60000 }).catch(() => {})
        await page.evaluate(() => document.fonts && document.fonts.ready)
        const g = translate(data)
        const r = await page.evaluate(([gg, rd, ns, rs, cv, ft, cz, ez]) => window.renderFig(gg, rd, ns, rs, cv, ft, cz, ez),
            [g, data.dir, NODESEP, RANKSEP, CANVAS, FONT, COMBO_Z, EDGE_Z])
        if (!r.ok) throw new Error('renderFig failed :: ' + String(r.err).split('\n')[0])
        const res = await page.evaluate(() => window.snap())
        if (!res.ok) throw new Error('snap failed :: ' + res.err)
        return Buffer.from(res.png.split(',')[1], 'base64')
    } finally {
        await browser.close()
    }
}

// ===== genSvg 專用渲染外殼 =====
//   與 genPng 完全獨立之頁面/renderer 流程(genPng 之 html/renderFig/snap 不受影響、行為不變)。
//   換用 @antv/g-svg renderer(取代預設 canvas renderer)產出 SVG DOM, 其餘 translate/layout/樣式邏輯
//   (dagre 排版、緊湊間距、z-order、字型)與 genPng 完全共用, 故版面結構/顏色/文字與 PNG 版一致。
const htmlSvg = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<script>${G_LITE_JS}</script>
<script>${G_SVG_JS}</script>
<script>${G6_JS}</script>
</head><body style="margin:0;background:#fff">
<div id="g6" style="background:#fff"></div>
<script>
window.renderFigSvg = async function(g, rankdir, nodesep, ranksep, canvas, font, comboZ, edgeZ){
  try {
    const el = document.getElementById('g6')
    el.style.width = canvas + 'px'; el.style.height = canvas + 'px'
    if (window.__graph) { try { window.__graph.destroy() } catch(e){} }
    const graph = new G6.Graph({
      container: el, width: canvas, height: canvas, autoFit:'view',
      renderer: () => new window.G.SVG.Renderer(),
      data: { nodes: g.nodes, edges: g.edges, combos: g.combos },
      layout: { type:'antv-dagre', rankdir: rankdir, nodesep: nodesep, ranksep: ranksep, sortByCombo: (g.combos && g.combos.length>0) },
      combo: { type:'rect', style:{ zIndex: comboZ, padding:[30,18,18,18], labelPlacement:'top', labelFontFamily: font } },
      edge: { type:'polyline', style:{ zIndex: edgeZ, lineWidth:2.2, endArrow:true, labelFontFamily: font } },
      node: { style:{ labelFontFamily: font } },
    })
    window.__graph = graph
    await graph.render()
    await new Promise(r=>setTimeout(r,300))
    return { ok:true }
  } catch(e){ return { ok:false, err:String(e&&(e.stack||e.message)||e).slice(0,400) } }
}
// 取 main layer 之 SVG DOM(SVG renderer 下唯一承載節點/邊/combo 之 layer, background/label/transient 三層無內容),
// 以 canvas.getBounds() 對齊 toDataURL({mode:'overall'}) 之緊裁切邊界改寫 viewBox/width/height, 補白底矩形。
window.snapSvg = async function(){
  try {
    await new Promise(r=>setTimeout(r,200))
    const canvas = window.__graph.getCanvas()
    const bounds = canvas.getBounds()
    const minX = bounds.min[0], minY = bounds.min[1]
    const w = bounds.max[0] - minX, h = bounds.max[1] - minY
    const mainEl = canvas.getLayer('main').getContextService().getDomElement()
    const svg = mainEl.cloneNode(true)
    // canvas.getBounds() 回傳世界座標(排版原始座標, 未經 camera 縮放平移); 但複製之 DOM 內容掛在
    // #g-svg-camera 群組下, 帶有互動視圖之 camera transform(autoFit:'view' 縮放平移)。
    // 兩者座標系不同, 混用會裁切錯位, 故先歸零 camera transform, 使內容回到與 bounds 相同之世界座標。
    const cameraEl = svg.querySelector('#g-svg-camera')
    if (cameraEl) cameraEl.removeAttribute('transform')
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    svg.setAttribute('viewBox', minX + ' ' + minY + ' ' + w + ' ' + h)
    svg.setAttribute('width', String(Math.ceil(w)))
    svg.setAttribute('height', String(Math.ceil(h)))
    svg.removeAttribute('tabindex')
    svg.style.background = ''
    svg.style.pointerEvents = ''
    svg.style.gridArea = ''
    svg.style.outline = ''
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bgRect.setAttribute('x', String(minX)); bgRect.setAttribute('y', String(minY))
    bgRect.setAttribute('width', String(w)); bgRect.setAttribute('height', String(h))
    bgRect.setAttribute('fill', '#fff')
    svg.insertBefore(bgRect, svg.firstChild)
    const out = svg.outerHTML.replace(/&nbsp;/g, '&#160;')
    return { ok:true, svg: out }
  } catch(e){ return { ok:false, err:String(e&&(e.stack||e.message)||e).slice(0,400) } }
}
window.__readySvg=true
</script></body></html>`

// 單張渲染:同 genPng 之輸入(單份正規化繪圖數據), 回傳 SVG 字串(緊裁切範圍對齊 genPng 之 toDataURL overall)。
//   獨立頁面/renderer 流程(見上), genPng 之 canvas 渲染行為不受影響。
export async function genSvg(data, opt = {}) {
    const browser = await chromium.launch()
    try {
        const page = await browser.newPage()
        const errs = []
        page.on('pageerror', e => errs.push(e.message))
        page.on('console', m => { if (m.type() === 'error') errs.push('c:' + m.text()) })
        await page.setContent(htmlSvg, { waitUntil: 'load' })
        await page.waitForFunction(() => window.__readySvg, { timeout: 60000 }).catch(() => {})
        await page.evaluate(() => document.fonts && document.fonts.ready)
        const g = translate(data)
        const r = await page.evaluate(([gg, rd, ns, rs, cv, ft, cz, ez]) => window.renderFigSvg(gg, rd, ns, rs, cv, ft, cz, ez),
            [g, data.dir, NODESEP, RANKSEP, CANVAS, FONT, COMBO_Z, EDGE_Z])
        if (!r.ok) throw new Error('renderFigSvg failed :: ' + String(r.err).split('\n')[0])
        const res = await page.evaluate(() => window.snapSvg())
        if (!res.ok) throw new Error('snapSvg failed :: ' + res.err)
        return res.svg
    } finally {
        await browser.close()
    }
}
