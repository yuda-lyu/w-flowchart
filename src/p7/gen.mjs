// p7 — JointJS + dagre 產線 adapter(資料驅動)
//   genPng(data): 正規化繪圖數據 → translate 轉 JointJS 內部 els → 兩段式 dagre 自動排版渲染 → 回傳 PNG Buffer
//   版面通用化: rankDir 取自數據 dir; nodesep/ranksep/GPAD/換行寬度 皆為通用常數或依標籤字寬/行數自動推算, 無逐圖魔術數字。
import { chromium } from 'playwright'
import { PALETTE } from '../common/palette.mjs'
import { pkgScript } from '../common/pkg.mjs'

// @joint/core + dagre 由本機 node_modules 內聯注入(取代 CDN, 斷網環境可用)
const JOINT_JS = pkgScript('@joint/core/dist/joint.min.js')
const DAGRE_JS = pkgScript('dagre/dist/dagre.min.js')

// CLS(JointJS 內部樣式表)由共用色票 PALETTE 推導: fill/stroke/text→color; diamond 帶 shape; *G/*G2 帶 group:true
const CLS = Object.fromEntries(Object.entries(PALETTE).map(([cls, p]) => {
    const o = { fill: p.fill, stroke: p.stroke, color: p.text }
    if (p.shape === 'diamond') o.shape = 'diamond'
    if (p.group) o.group = true
    return [cls, o]
}))

// translate(data) — 正規化數據 → JointJS 渲染外殼所需 els:
//   node{id,label,cls,group?} → {id,label,cls,parent}(group→parent, 容器歸屬)
//   edge{from,to,label?,kind?} → {source,target,label,cls}(from/to→source/target, kind:dashed→cls:'dashed' 走虛線)
function translate(data) {
    const els = []
    for (const nd of data.nodes) els.push({ id: nd.id, label: nd.label, cls: nd.cls || 'blue', parent: nd.group || null })
    for (const ed of data.edges) els.push({ source: ed.from, target: ed.to, label: ed.label || '', cls: ed.kind === 'dashed' ? 'dashed' : '' })
    return { els, rankDir: data.dir }
}

const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<script>${JOINT_JS}</script>
<script>${DAGRE_JS}</script>
</head><body style="margin:0;background:#fff">
<div id="paper" style="background:#fff"></div>
<script>
var CLS = ${JSON.stringify(CLS)}
var FONT = 'Microsoft JhengHei, "Microsoft JhengHei", sans-serif'
var FS = 14, FSG = 14.5, FSL = 12.5

// 量測文字寬度(canvas)
var __cv = document.createElement('canvas'); var __cx = __cv.getContext('2d')
function measure(text, fs){ __cx.font = fs + 'px ' + FONT; return __cx.measureText(text).width }

// 依字寬自動換行(回傳 lines 陣列 + 最大寬)
function wrapText(text, fs, maxW){
  // 先嘗試以全形分隔符/括號斷點，否則逐字
  var lines = [], cur = ''
  for (var i = 0; i < text.length; i++){
    var ch = text[i]
    var test = cur + ch
    if (measure(test, fs) > maxW && cur !== ''){ lines.push(cur); cur = ch }
    else cur = test
  }
  if (cur) lines.push(cur)
  var w = 0; lines.forEach(function(l){ w = Math.max(w, measure(l, fs)) })
  return { lines: lines, w: w }
}

function renderFig(els, rankDir, sep){
  return new Promise(function(resolve){
    try {
      var NODESEP = (sep && sep.nodesep) || 32   // 同層節點間距(緊湊固定基準)
      var RANKSEP = (sep && sep.ranksep) || 48   // 層間距(緊湊固定基準)
      var nodes = els.filter(function(x){ return x.id !== undefined })
      var edges = els.filter(function(x){ return x.source !== undefined })
      var nodeById = {}; nodes.forEach(function(nn){ nodeById[nn.id] = nn })

      // 分類：群組(parent)與一般節點
      var groups = nodes.filter(function(nn){ return CLS[nn.cls] && CLS[nn.cls].group })
      var groupIds = {}; groups.forEach(function(g){ groupIds[g.id] = true })
      var leaves = nodes.filter(function(nn){ return !groupIds[nn.id] })

      // 量測 leaf 節點尺寸(含換行)
      var maxLeafW = 480
      var sizing = {}
      leaves.forEach(function(nn){
        var st = CLS[nn.cls] || CLS.blue
        var wr = wrapText(nn.label, FS, maxLeafW)
        var w, h
        if (st.shape === 'diamond'){
          var tw = wr.w + 24, th = wr.lines.length * (FS + 6) + 16
          w = Math.max(tw * 1.9, 130); h = Math.max(th * 1.9, 90)
        } else {
          w = Math.max(wr.w + 34, 90); h = wr.lines.length * (FS + 7) + 24
        }
        sizing[nn.id] = { w: Math.round(w), h: Math.round(h), lines: wr.lines }
      })

      // ── 兩段式 layout(避開 dagre compound 對「群組為邊端點」的 rank bug)──
      // 巢狀關係：childrenOf[parentId] = [子節點...]；topLevel = 無 parent 者
      var GPAD = 16           // 群組內距(標題列高 titleH 依群組各自動態計算)
      var childrenOf = {}
      nodes.forEach(function(nn){ var p = nn.parent || '__root'; (childrenOf[p] = childrenOf[p] || []).push(nn) })
      var grpById = {}; groups.forEach(function(gp){ grpById[gp.id] = gp })
      var parentOf = {}; nodes.forEach(function(nn){ parentOf[nn.id] = nn.parent || '__root' })
      // 將節點往上抬升，直到其 parent 為指定容器(回傳該容器之直接子)；無則回 null
      function liftTo(nodeId, containerId){
        var cur = nodeId
        while (cur != null){
          if (parentOf[cur] === containerId) return cur
          cur = (parentOf[cur] === '__root') ? null : parentOf[cur]
        }
        return null
      }

      // size[id] = {w,h}：leaf 直接取量測；group 需先排內部子圖才得知
      var size = {}
      leaves.forEach(function(nn){ size[nn.id] = { w: sizing[nn.id].w, h: sizing[nn.id].h } })
      // 群組內每個子節點相對群組內容左上角的偏移
      var innerPos = {}   // innerPos[childId] = {x,y} 相對其 parent 內容區
      var groupContentW = {}, groupContentH = {}
      var titleH = {}, titleLines = {}   // 每個群組標題列高度與換行

      // 對一個容器(root 或 group)內的直接子節點做 dagre 排版，回傳 {w,h} 內容尺寸
      function layoutContainer(containerId){
        var kids = (childrenOf[containerId] || [])
        // 先遞迴排子群組，取得其尺寸
        kids.forEach(function(k){ if (grpById[k.id]) { var s = layoutContainer(k.id); size[k.id] = { w: s.w, h: s.h } } })
        var dg = new dagre.graphlib.Graph()
        dg.setGraph({ rankdir: rankDir, nodesep: NODESEP, ranksep: RANKSEP, marginx: 0, marginy: 0, ranker: 'tight-tree' })
        dg.setDefaultEdgeLabel(function(){ return {} })
        var kidSet = {}; kids.forEach(function(k){ kidSet[k.id] = true; dg.setNode(k.id, { width: size[k.id].w, height: size[k.id].h }) })
        // 納入「抬升至本容器直接子」後兩端相異之邊(含跨群組邊)，避免重複
        var seen = {}
        edges.forEach(function(ed){
          var s = liftTo(ed.source, containerId), t = liftTo(ed.target, containerId)
          if (s && t && s !== t && kidSet[s] && kidSet[t]){
            var key = s + '' + t
            if (!seen[key]){ seen[key] = true; dg.setEdge(s, t) }
          }
        })
        dagre.layout(dg)
        var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9
        kids.forEach(function(k){
          var p = dg.node(k.id)
          minX = Math.min(minX, p.x - p.width/2); minY = Math.min(minY, p.y - p.height/2)
          maxX = Math.max(maxX, p.x + p.width/2); maxY = Math.max(maxY, p.y + p.height/2)
        })
        if (kids.length === 0){ minX = minY = maxX = maxY = 0 }
        kids.forEach(function(k){
          var p = dg.node(k.id)
          innerPos[k.id + '@' + containerId] = { x: p.x - p.width/2 - minX, y: p.y - p.height/2 - minY }
        })
        var cw = (maxX - minX), ch = (maxY - minY)
        if (containerId !== '__root'){
          cw += GPAD * 2
          // 標題依群組內寬換行，動態決定標題列高度
          var gp = grpById[containerId]
          var twr = wrapText(gp.label, FSG, cw - GPAD * 2)
          var th = twr.lines.length * (FSG + 4) + 12
          titleH[containerId] = th; titleLines[containerId] = twr.lines
          ch += GPAD * 2 + th   // 群組外框含內距與標題列
        }
        groupContentW[containerId] = cw; groupContentH[containerId] = ch
        return { w: cw, h: ch }
      }
      layoutContainer('__root')

      // 由 root 內容起，遞迴攤平出每個節點的絕對 (x,y)=中心點
      var pos = {}   // pos[id] = {x,y,w,h}(x,y 為中心)
      function place(containerId, originX, originY){
        // originX/originY = 此容器內容區左上角絕對座標
        var kids = (childrenOf[containerId] || [])
        kids.forEach(function(k){
          var off = innerPos[k.id + '@' + containerId]
          var w = size[k.id].w, h = size[k.id].h
          var topLeftX = originX + off.x, topLeftY = originY + off.y
          pos[k.id] = { x: topLeftX + w/2, y: topLeftY + h/2, w: w, h: h }
          if (grpById[k.id]){
            // 群組內容區左上角 = 群組左上角 + 內距 +(標題列)
            place(k.id, topLeftX + GPAD, topLeftY + GPAD + titleH[k.id])
          }
        })
      }
      place('__root', 0, 0)

      // 建 JointJS graph
      var graph = new joint.dia.Graph({}, { cellNamespace: joint.shapes })
      var cells = []
      var cellById = {}

      // 群組容器(先畫，置底)；標題用獨立 TextBlock 置於頂部中央
      var groupTitleCells = []
      groups.forEach(function(gp){
        var p = pos[gp.id]
        var st = CLS[gp.cls]
        var x = p.x - p.w/2, y = p.y - p.h/2
        var r = new joint.shapes.standard.Rectangle()
        r.position(x, y); r.resize(p.w, p.h)
        r.attr({
          body: { fill: st.fill, stroke: st.stroke, strokeWidth: 2, rx: 8, ry: 8, fillOpacity: 0.5 },
          label: { text: '' }
        })
        cells.push(r); cellById[gp.id] = r
        // 標題(獨立元件，置頂中央)
        var th = titleH[gp.id]
        var tb = new joint.shapes.standard.TextBlock()
        tb.resize(p.w - 16, th)
        tb.position(x + 8, y + 4)
        tb.attr({
          body: { fill: 'none', stroke: 'none' },
          // TextBlock 以 foreignObject<div> 渲染: font-family 屬性對 HTML div 無效(會落回瀏覽器預設 Times New Roman),
          //   字型必須寫進 style(JointJS 將 style keys 複製為 div inline CSS)才會套用 → 群組標題與全圖統一 JhengHei
          label: { text: (titleLines[gp.id] || [gp.label]).join('\\n'), fontFamily: FONT, fontSize: FSG, fontWeight: 'bold', fill: st.color,
            style: { color: st.color, fontWeight: 'bold', fontFamily: FONT } }
        })
        groupTitleCells.push(tb)
      })

      // leaf 節點
      leaves.forEach(function(nn){
        var p = pos[nn.id]
        var st = CLS[nn.cls] || CLS.blue
        var sz = sizing[nn.id]
        var cell
        if (st.shape === 'diamond'){
          cell = new joint.shapes.standard.Polygon()
          cell.attr('body/refPoints', '50,0 100,50 50,100 0,50')
        } else {
          cell = new joint.shapes.standard.Rectangle()
          cell.attr('body/rx', 6); cell.attr('body/ry', 6)
        }
        cell.position(p.x - p.w/2, p.y - p.h/2)
        cell.resize(p.w, p.h)
        cell.attr('body/fill', st.fill)
        cell.attr('body/stroke', st.stroke)
        cell.attr('body/strokeWidth', 1.8)
        cell.attr('label/text', sz.lines.join('\\n'))
        cell.attr('label/fontFamily', FONT)
        cell.attr('label/fontSize', FS)
        cell.attr('label/fill', st.color)
        cell.attr('label/lineHeight', (FS + 7) + 'px')
        cells.push(cell); cellById[nn.id] = cell
      })

      // 邊
      edges.forEach(function(ed){
        var s = cellById[ed.source], t = cellById[ed.target]
        if (!s || !t) return
        var l = new joint.shapes.standard.Link()
        l.source(s); l.target(t)
        var dashed = ed.cls === 'dashed'
        l.attr({
          line: {
            stroke: '#44505a', strokeWidth: 2.2,
            strokeDasharray: dashed ? '6,4' : null,
            targetMarker: { type: 'path', d: 'M 10 -5 0 0 10 5 z', fill: '#44505a' }
          }
        })
        l.router('normal'); l.connector('rounded', { radius: 6 })
        if (ed.label){
          // 邊標籤距離: 預設置中(0.5); 虛線(跨群組/驗證類)靠來源端;
          //   跨群組邊(端點落在不同容器)把標籤推向「位於容器外」的一端, 避免疊到群組內節點。
          var srcIn = parentOf[ed.source] && parentOf[ed.source] !== '__root'
          var tgtIn = parentOf[ed.target] && parentOf[ed.target] !== '__root'
          var dist = 0.5
          if (dashed) dist = 0.32
          else if (tgtIn && !srcIn) dist = 0.26        // 進入群組: 標籤靠來源(群組外)
          else if (srcIn && !tgtIn) dist = 0.74        // 離開群組: 標籤靠目標(群組外)
          // 全域修正 A: 背景框透明(不遮轉折線), 文字以白色光暈/描邊保持清晰
          //   SVG paint-order:stroke → 先描白邊再填字 → 線段能透出、文字仍清晰
          l.labels([{
            markup: [{ tagName: 'text', selector: 'lbl' }],
            attrs: {
              lbl: { text: ed.label, fontFamily: FONT, fontSize: FSL, fill: '#4a5560',
                stroke: '#ffffff', strokeWidth: 3.5, paintOrder: 'stroke', strokeLinejoin: 'round',
                textAnchor: 'middle', textVerticalAnchor: 'middle' }
            },
            position: { distance: dist }
          }])
        }
        cells.push(l)
      })

      // 群組標題置於最上層
      groupTitleCells.forEach(function(tb){ cells.push(tb) })

      var paper = document.getElementById('paper')
      var P = new joint.dia.Paper({
        el: paper, model: graph,
        width: 100, height: 100, background: { color: '#ffffff' },
        cellViewNamespace: joint.shapes
      })
      graph.resetCells(cells)
      // 確保群組在底層
      groups.forEach(function(gp){ cellById[gp.id].toBack() })
      P.fitToContent({ padding: 28, allowNewOrigin: 'any', useModelGeometry: true })

      // ── 碰撞偵測(通用機制, 對所有圖一致) ─────────────────────────────
      //   量測「節點 bounding box」與「邊標籤 bounding box」, 兩兩偵測重疊(>2px 計碰撞)。
      //   群組容器刻意包住其子節點, 故排除「容器 ↔ 其後代」之合法重疊; 其餘皆計入。
      //   座標一律取 getBoundingClientRect()(同一螢幕座標系, 跨節點/標籤可直接比對, paper 未縮放故相對關係即真實版面)。
      // 容器後代集合(供排除合法包含)
      var descOf = {}
      function collectDesc(gid){
        var set = {}; var stack = (childrenOf[gid] || []).slice()
        while (stack.length){ var c = stack.pop(); set[c.id] = true; if (grpById[c.id]) (childrenOf[c.id] || []).forEach(function(k){ stack.push(k) }) }
        return set
      }
      groups.forEach(function(gp){ descOf[gp.id] = collectDesc(gp.id) })
      function toRect(dom, kind, id){
        var r = dom.getBoundingClientRect()
        return { kind: kind, id: id, x: r.left, y: r.top, w: r.width, h: r.height }
      }
      // 收集矩形: 節點(cellView body 之 client rect), 群組亦納入(偵測容器 ↔ 無關節點/容器)
      var rects = []
      nodes.forEach(function(nn){
        var c = cellById[nn.id]; if (!c) return
        var cv = P.findViewByModel(c); if (!cv) return
        // 群組量「外框 body」, 不含其內子節點; 一般節點量整個 cell
        var dom = grpById[nn.id] ? (cv.el.querySelector('[joint-selector="body"], rect') || cv.el) : cv.el
        rects.push(toRect(dom, grpById[nn.id] ? 'group' : 'node', nn.id))
      })
      // 邊標籤: 取其 label <text>(同一連線之 halo+fill 為單一 text, 不重複計)
      var labelRects = []
      cells.forEach(function(c){
        if (!(c.isLink && c.isLink())) return
        if (!(c.attributes.labels && c.attributes.labels.length)) return
        var lv = P.findViewByModel(c); if (!lv) return
        var tnodes = lv.el.querySelectorAll('[joint-selector="lbl"]')
        if (!tnodes.length) tnodes = lv.el.querySelectorAll('.labels text, .label text')
        for (var ti = 0; ti < tnodes.length; ti++){
          var r = tnodes[ti].getBoundingClientRect()
          if (r.width < 1) continue
          labelRects.push({ kind: 'label', id: c.id + ':' + ti, x: r.left, y: r.top, w: r.width, h: r.height })
        }
      })
      function overlapPx(a, b){
        var ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        var iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        return { ix: ix, iy: iy }
      }
      var allRects = rects.concat(labelRects)
      var collisions = 0, minGap = 1e9, details = []
      for (var i = 0; i < allRects.length; i++) for (var j = i + 1; j < allRects.length; j++){
        var A = allRects[i], B = allRects[j]
        // 排除合法包含: 容器 ↔ 其後代節點
        if (A.kind === 'group' && descOf[A.id] && descOf[A.id][B.id]) continue
        if (B.kind === 'group' && descOf[B.id] && descOf[B.id][A.id]) continue
        // 排除「群組外框 ↔ 邊標籤」: 群組為半透明色塊背景(swimlane), 標籤帶白色光暈疊於其上仍清晰,
        //   且跨群組邊必然穿越群組邊界 → 不計為碰撞(真正要避免的是標籤疊到節點文字/其他標籤)
        if ((A.kind === 'group' && B.kind === 'label') || (B.kind === 'group' && A.kind === 'label')) continue
        var ov = overlapPx(A, B)
        if (ov.ix > 2 && ov.iy > 2){
          collisions++
          if (details.length < 4) details.push((A.kind[0]) + A.id.slice(0, 6) + '×' + (B.kind[0]) + B.id.slice(0, 6))
        } else if (ov.ix > -200 && ov.iy > -200){
          // 估「最近可見間隙」: 兩矩形在分離軸上的最小正向距離(僅在另一軸有重疊時才算同列/同行相鄰)
          if (ov.ix <= 2 && ov.iy > 2) minGap = Math.min(minGap, -ov.ix)
          if (ov.iy <= 2 && ov.ix > 2) minGap = Math.min(minGap, -ov.iy)
        }
      }
      if (!isFinite(minGap)) minGap = 999
      resolve({ ok: true, w: Math.round(P.options.width), h: Math.round(P.options.height),
        collisions: collisions, minGap: Math.round(minGap), details: details })
    } catch(e){ resolve({ ok: false, err: String(e.message || e), stack: String(e.stack) }) }
  })
}
window.renderFig = renderFig
window.__ready = true
</script></body></html>`

// 渲染單張至就緒頁面(#paper svg 已完成排版渲染), 回傳 {browser,page,res}(res 含 fitToContent 後之 w/h);
//   caller 負責 close browser。渲染失敗(res.ok=false)或例外時, 先 close browser 再 rethrow。
async function renderFigPage(data) {
    const browser = await chromium.launch()
    try {
        const page = await browser.newPage({ deviceScaleFactor: 2 })
        const errs = []
        page.on('pageerror', ex => errs.push(ex.message))
        page.on('console', m => { if (m.type() === 'error') errs.push('c:' + m.text()) })
        await page.setContent(html, { waitUntil: 'load' })
        await page.waitForFunction(() => window.__ready, { timeout: 60000 }).catch(() => {})
        await page.evaluate(() => document.fonts && document.fonts.ready)

        // 緊湊固定間距(同批次流程基準, 見下方說明)
        const SEP = { nodesep: 32, ranksep: 48 }
        const { els, rankDir } = translate(data)
        const res = await page.evaluate(([e, rd, s]) => window.renderFig(e, rd, s), [els, rankDir, SEP])
        if (!res.ok) throw new Error(res.err + (res.stack ? '\n' + res.stack : ''))
        return { browser, page, res }
    }
    catch (err) {
        await browser.close()
        throw err
    }
}

// genPng(data, opt) — 單張渲染:輸入正規化繪圖數據({dir,nodes,edges}, caller 已先做 label 衍生),
//   重用上方 translate/HTML/渲染管線, 回傳 PNG 之 Node Buffer(caller 自行決定寫檔或其他用途)。
export async function genPng(data, opt = {}) {
    const { browser, page } = await renderFigPage(data)
    try {
        const el = await page.$('#paper svg')
        return await el.screenshot()
    } finally {
        await browser.close()
    }
}

// genSvg(data, opt) — 單張渲染 → standalone SVG 字串:
//   取 #paper svg 之 outerHTML, 修正使其脫離 #paper 容器後仍忠實:
//     1. 補 xmlns(JointJS 只寫 xmlns:xlink, 缺 xmlns 非合法 standalone SVG)
//     2. width/height 由 JointJS 寫死的 "100%" 改為 fitToContent 後之實際像素值(res.w/res.h)
//        (100% 依賴 #paper 容器之 inline width/height, 脫離容器後無父層可依附)
//     3. 移除 position:absolute;inset:0(同上, 依賴容器定位, standalone 時會撐滿最近定位祖先/viewport)
//   svg 內已含 JointJS 自身注入之 <style>(non-scaling-stroke), outerHTML 序列化時隨之保留, 無需另行處理。
//   &nbsp; 正規化為 &#160; 使其為合法 XML。
export async function genSvg(data, opt = {}) {
    const { browser, page, res } = await renderFigPage(data)
    try {
        let outer = await page.$eval('#paper svg', el => el.outerHTML)
        outer = outer.replace(/^<svg([^>]*)>/, (m0, attrs) => {
            let a = attrs
            if (!/\bxmlns=/.test(a)) a = ' xmlns="http://www.w3.org/2000/svg"' + a
            a = a.replace(/\swidth="100%"/, ` width="${res.w}"`)
            a = a.replace(/\sheight="100%"/, ` height="${res.h}"`)
            a = a.replace(/position:\s*absolute;\s*inset:\s*[^;]*;\s*/, '')
            return `<svg${a}>`
        })
        return outer.replace(/&nbsp;/g, '&#160;').trim()
    } finally {
        await browser.close()
    }
}
