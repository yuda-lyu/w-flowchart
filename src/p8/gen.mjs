// p8 — LogicFlow + dagre 產線 adapter(資料驅動)
//   genPng(data): 正規化繪圖數據 → translate 轉 LF nodes/edges → dagre 自動排版渲染 → 回傳 PNG Buffer
//   版面通用化: rankDir 取自數據 dir; 節點尺寸依 label 字寬/行數自動推算; 無逐圖魔術數字。
//   間距(nodesep/ranksep)由「碰撞偵測自適應」迴圈決定: 渲染→量測節點/群組/邊標籤 bbox→偵測重疊→由小到大掃描間距取首個零碰撞(且留可見間隙)。
//   邊標籤(全域修正 A): 背景透明(不遮轉折線) + 文字加白色光暈(SVG paint-order:stroke + stroke=白 stroke-width≈3.5)。
import { chromium } from 'playwright'
import { PALETTE, EDGE, FONT, colorOf } from '../common/palette.mjs'
import { pkgScript, pkgText } from '../common/pkg.mjs'

// @logicflow/core(js+css)+ dagre 由本機 node_modules 內聯注入(取代 CDN, 斷網環境可用)
const LOGICFLOW_CSS = pkgText('@logicflow/core/dist/index.css')
const LOGICFLOW_JS = pkgScript('@logicflow/core/dist/index.min.js')
const DAGRE_JS = pkgScript('dagre/dist/dagre.min.js')

// 正規化數據(dir/nodes/edges) → LF 內部結構: nodes 用 parent 表群組歸屬; edges 用 source/target/dashed。
//   套色: 由 cls 查 PALETTE(group 類別自動為淺底容器); 形狀: diamond→決策菱形, 其餘→矩形; dir→dagre rankDir; kind:dashed→虛線。
function translate(data) {
    const els = []
    for (const nd of data.nodes) els.push({ id: nd.id, label: nd.label, cls: nd.cls || 'blue', parent: nd.group })
    for (const ed of data.edges) els.push({ source: ed.from, target: ed.to, label: ed.label || '', dashed: ed.kind === 'dashed' })
    return { rankDir: data.dir, els }
}

// 由標準色票 PALETTE 攤平成 { cls: {fill,stroke,text} } 供瀏覽器端套用(group 類別亦取同三欄, 其淺底由 isGroup 旗標控制透明度)。
const PAL = Object.fromEntries(Object.entries(PALETTE).map(([cls, p]) => [cls, { fill: p.fill, stroke: p.stroke, text: p.text }]))
const PAL_JSON = JSON.stringify(PAL)
const EDGE_JSON = JSON.stringify(EDGE)

const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<style>${LOGICFLOW_CSS}</style>
<script>${LOGICFLOW_JS}</script>
<script>${DAGRE_JS}</script>
<style>
  * { font-family: ${FONT}; }
  html,body{ margin:0; background:#fff; }
  #app { background:#fff; }
  .lf-grid { display:none !important; }
</style>
</head><body>
<div id="app"></div>
<script>
var PAL = ${PAL_JSON}
var EDGE = ${EDGE_JSON}
var FONT = ${JSON.stringify(`14px ${FONT}`)}              // canvas 量測用之 font 短語
var FONT_FAMILY = ${JSON.stringify(FONT)}                  // 純 font-family(供 SVG text 明確指定, 字型全覆蓋)

// ---- 通用版面常數(非逐圖; 皆為與內容無關之全域預設) ----
var FONT_SIZE = 14, LINE_H = 22                 // 節點字級 / 行高
var NODE_MAXW = 230, DIAMOND_MAXW = 110         // 換行最大寬度(矩形 / 菱形)
var PAD_X = 28, PAD_Y = 22                       // 矩形內距
var DIA_PAD_X = 60, DIA_PAD_Y = 46               // 菱形內距(對角需較大留白)
var NODE_MINW = 120, NODE_MINH = 56              // 矩形最小尺寸
var DIA_MINW = 150, DIA_MINH = 110               // 菱形最小尺寸
var MARGIN = 20                                  // dagre 邊距
var GROUP_TITLE = 26                             // 群組容器標題列高
var CANVAS_MARGIN = 60                           // 畫布外緣留白
var LABEL_GAP = 28, LABEL_BIAS = 0.62            // 跨界邊標籤離容器框間隙 / 偏容器側權重

// ---- 緊湊固定間距(通用機制, 對所有圖一致; 不做「掃描放大 until 零碰撞」) ----
//   一律以單一緊湊間距排版, 維持報告可用的緊湊尺寸; 不因避碰撞而把圖撐大。
//   文字遮蔽改由繪製順序(z-order)解決(群組墊底 / 節點居中 / 邊與邊標籤置頂), 不靠加大間距。
//   LR 層距略大於 TB(水平向標籤較長), 仍為固定值。
var SEP_TB = [36, 55]        // [nodesep, ranksep] — 上下向緊湊間距
var SEP_LR = [36, 82]        // [nodesep, ranksep] — 左右向緊湊間距
var COLLIDE_TOL = 2          // 重疊 >此像素 才計為碰撞(僅供回報用, 不再驅動間距放大)

// 量測文字寬度
var _cv = document.createElement('canvas'); var _cx = _cv.getContext('2d')
function measure(t, font){ _cx.font = font; return _cx.measureText(t).width }

// 將長 label 依最大寬度斷行: 中文逐字可斷; 連續英數識別字(token)視為不可攔腰斷之整體, 整段超寬才獨佔一行。
function wrap(label, maxW, font){
  _cx.font = font
  // 先切成 token: 連續英數(含 . _ / 等識別字常見字元)為一個 token, 其餘(中文/標點/空白)逐字
  var chars = Array.from(label)
  var tokens = [], buf = ''
  function isWordChar(c){ return /[0-9A-Za-z._/\\-]/.test(c) }
  for (var i=0;i<chars.length;i++){
    if (isWordChar(chars[i])){ buf += chars[i] }
    else { if (buf){ tokens.push(buf); buf='' } tokens.push(chars[i]) }
  }
  if (buf) tokens.push(buf)
  var lines = [], cur = ''
  for (var k=0;k<tokens.length;k++){
    var tk = tokens[k]
    var test = cur + tk
    if (_cx.measureText(test).width > maxW && cur.length>0){ lines.push(cur); cur = tk }
    else cur = test
  }
  if (cur) lines.push(cur)
  // 去除純空白造成的行首空白
  return lines.map(function(l){ return l.replace(/^\\s+/, '') }).filter(function(l){ return l.length>0 })
}

// 依 label 自動推算節點尺寸(寬: 依最寬一行字寬 + 內距; 高: 依行數 + 內距; 皆套最小值)
function sizeOf(label, isDiamond){
  var maxW = isDiamond ? DIAMOND_MAXW : NODE_MAXW
  var lines = wrap(label, maxW, FONT)
  if (!lines.length) lines = [label]
  var w = 0
  lines.forEach(function(l){ w = Math.max(w, measure(l, FONT)) })
  var padX = isDiamond ? DIA_PAD_X : PAD_X, padY = isDiamond ? DIA_PAD_Y : PAD_Y
  var W = Math.ceil(w + padX*2)
  var H = Math.ceil(lines.length*LINE_H + padY*2)
  if (isDiamond){ W = Math.max(W, DIA_MINW); H = Math.max(H, DIA_MINH) }
  else { W = Math.max(W, NODE_MINW); H = Math.max(H, NODE_MINH) }
  return { w: W, h: H, text: lines.join('\\n') }
}

// 兩矩形重疊量(回傳 {ix,iy} 為水平/垂直交集像素, 皆>0 才重疊)
function overlap(a, b){
  var ix = Math.min(a.x+a.w/2, b.x+b.w/2) - Math.max(a.x-a.w/2, b.x-b.w/2)
  var iy = Math.min(a.y+a.h/2, b.y+b.h/2) - Math.max(a.y-a.h/2, b.y-b.h/2)
  return { ix: ix, iy: iy }
}

// ---- 解析 fig 為內部結構 + 量測尺寸(只做一次, 不隨間距改變) ----
function prepare(fig){
  var els = fig.els
  var nodes = els.filter(function(x){ return !('source' in x) })
  var edges = els.filter(function(x){ return ('source' in x) })
  var byId = {}; nodes.forEach(function(nd){ byId[nd.id] = nd })
  var groupIds = {}; nodes.forEach(function(nd){ if (nd.parent) groupIds[nd.parent] = true })
  nodes.forEach(function(nd){
    if (groupIds[nd.id]) return
    var sz = sizeOf(nd.label, nd.cls === 'diamond')
    nd._w = sz.w; nd._h = sz.h; nd._text = sz.text
  })
  return { nodes: nodes, edges: edges, byId: byId, groupIds: groupIds, rankDir: fig.rankDir }
}

// ---- 以給定間距做 dagre compound 排版, 回傳座標/群組框/邊標籤座標(供偵測與渲染) ----
function layout(P, nodeSep, rankSep){
  var nodes = P.nodes, edges = P.edges, byId = P.byId, groupIds = P.groupIds
  var g = new dagre.graphlib.Graph({ compound:true })
  g.setGraph({ rankdir: P.rankDir, nodesep: nodeSep, ranksep: rankSep, marginx: MARGIN, marginy: MARGIN })
  g.setDefaultEdgeLabel(function(){ return {} })
  Object.keys(groupIds).forEach(function(gid){ g.setNode(gid, { label: gid }) })
  Object.keys(groupIds).forEach(function(gid){
    var gp = byId[gid] && byId[gid].parent
    if (gp && groupIds[gp]) g.setParent(gid, gp)
  })
  nodes.forEach(function(nd){
    if (groupIds[nd.id]) return
    g.setNode(nd.id, { width: nd._w, height: nd._h })
    if (nd.parent) g.setParent(nd.id, nd.parent)
  })
  function repLeaf(gid){
    var c = nodes.filter(function(x){ return x.parent === gid && !groupIds[x.id] })
    return c.length ? c[0].id : null
  }
  edges.forEach(function(ed){
    var sG = groupIds[ed.source], tG = groupIds[ed.target]
    if (!sG && !tG){ g.setEdge(ed.source, ed.target); return }
    var s = sG ? repLeaf(ed.source) : ed.source
    var t = tG ? repLeaf(ed.target) : ed.target
    if (s && t) g.setEdge(s, t)
  })
  dagre.layout(g)

  // leaf 節點座標
  var lfNodes = []
  nodes.forEach(function(nd){
    if (groupIds[nd.id]) return
    var p = g.node(nd.id)
    var pal = PAL[nd.cls] || PAL.blue
    var type = nd.cls === 'diamond' ? 'diamond' : 'rect'
    lfNodes.push({ id: nd.id, type: type, x: Math.round(p.x), y: Math.round(p.y), text: nd._text, _pal: pal, _w: nd._w, _h: nd._h })
  })
  // 群組容器框(dagre cluster bbox)
  function depth(gid){ var d=0,p=byId[gid]&&byId[gid].parent; while(p){ d++; p=byId[p]&&byId[p].parent } return d }
  var lfGroupNodes = []
  Object.keys(groupIds).sort(function(a,b){ return depth(a)-depth(b) }).forEach(function(gid){
    var gn = g.node(gid)
    var pal = PAL[byId[gid].cls] || PAL.blue
    lfGroupNodes.push({ id: gid, label: byId[gid].label, _pal: pal,
      x: Math.round(gn.x), y: Math.round(gn.y), _w: Math.round(gn.width), _h: Math.round(gn.height) })
  })

  // 幾何查詢
  var geo = {}
  lfNodes.forEach(function(nd){ geo[nd.id]={ x:nd.x, y:nd.y, w:nd._w, h:nd._h } })
  lfGroupNodes.forEach(function(b){ geo[b.id]={ x:b.x, y:b.y, w:b._w, h:b._h } })
  var parentBox = {}
  nodes.forEach(function(nd){ if (nd.parent && geo[nd.parent]) parentBox[nd.id] = geo[nd.parent] })
  function inGroup(id){ return !!parentBox[id] }

  // 跨界邊標籤座標(落在外部節點與群組框之間淨空)
  function labelPos(ed){
    if (!ed.label) return null
    var sIn = inGroup(ed.source) || groupIds[ed.source]
    var tIn = inGroup(ed.target) || groupIds[ed.target]
    var outId = null, inId = null
    if (sIn && !tIn){ inId=ed.source; outId=ed.target }
    else if (!sIn && tIn){ outId=ed.source; inId=ed.target }
    else {
      var s = geo[ed.source], t = geo[ed.target]
      if (!s || !t) return null
      var mx = (s.x+t.x)/2, my = (s.y+t.y)/2
      var hit = null
      lfGroupNodes.forEach(function(b){
        if (mx > b.x-b._w/2 && mx < b.x+b._w/2 && my > b.y-b._h/2 && my < b.y+b._h/2) hit = b
      })
      if (!hit) return null
      return { x: Math.round(hit.x - hit._w/2 - LABEL_GAP), y: Math.round(my) }
    }
    var o = geo[outId], box = parentBox[inId] || geo[inId]
    var tgt = geo[ed.target] || geo[inId]
    if (!o || !box || !tgt) return null
    var bias = LABEL_BIAS, obias = 1 - LABEL_BIAS
    if (P.rankDir === 'LR'){
      var boxEdgeX = (o.x < box.x) ? (box.x - box.w/2) : (box.x + box.w/2)
      var oInnerX = o.x + (o.x<box.x ? o.w/2 : -o.w/2)
      var lx = boxEdgeX*bias + oInnerX*obias
      return { x: Math.round(lx), y: Math.round(tgt.y) }
    } else {
      var boxEdgeY = (o.y < box.y) ? (box.y - box.h/2) : (box.y + box.h/2)
      var oInnerY = o.y + (o.y<box.y ? o.h/2 : -o.h/2)
      var ly = boxEdgeY*bias + oInnerY*obias
      return { x: Math.round(tgt.x), y: Math.round(ly) }
    }
  }

  // 邊 + 標籤框(供偵測). 標籤框尺寸依文字量測。
  var lfEdges = [], labelBoxes = []
  edges.forEach(function(ed, i){
    var lp = labelPos(ed)
    var txt = ed.label ? (lp ? { value: ed.label, x: lp.x, y: lp.y } : ed.label) : ''
    lfEdges.push({ id:'e'+i, sourceNodeId: ed.source, targetNodeId: ed.target, text: txt, _dashed: ed.dashed })
    if (ed.label){
      // 標籤未指定座標時, 取兩端中點估其位置(供偵測)
      var lx, ly
      if (lp){ lx = lp.x; ly = lp.y }
      else { var s=geo[ed.source], t=geo[ed.target]; if(!s||!t) return; lx=(s.x+t.x)/2; ly=(s.y+t.y)/2 }
      var lw = measure(ed.label, FONT) + 14, lh = LINE_H
      labelBoxes.push({ x: lx, y: ly, w: lw, h: lh, _label: true })
    }
  })

  return { lfNodes: lfNodes, lfGroupNodes: lfGroupNodes, lfEdges: lfEdges, labelBoxes: labelBoxes,
    byId: byId, parentBox: parentBox }
}

// ---- 偵測重疊: leaf↔leaf、group↔group(非巢狀)、leaf↔group(非歸屬)、邊標籤↔節點/其他標籤 ----
//   回傳 { collisions, minGap(零碰撞時計區塊間最小可見間隙) }
function detect(L){
  var byId = L.byId
  // 取某 leaf/group 的祖先群組鏈(含自身), 用於排除「容器內含其成員」的合法重疊
  function ancestors(id){ var arr=[id], p=byId[id]&&byId[id].parent; while(p){ arr.push(p); p=byId[p]&&byId[p].parent } return arr }
  // 判 a 是否為 b 之祖先或同一(容器包含成員 → 非碰撞)
  function related(idA, idB){
    var ca = ancestors(idA), cb = ancestors(idB)
    return ca.indexOf(idB) >= 0 || cb.indexOf(idA) >= 0
  }
  // 待偵測之矩形集合(節點 + 群組框, 各帶 id; 標籤無 id)
  var rects = []
  L.lfNodes.forEach(function(n){ rects.push({ id:n.id, x:n.x, y:n.y, w:n._w, h:n._h, kind:'node' }) })
  L.lfGroupNodes.forEach(function(b){ rects.push({ id:b.id, x:b.x, y:b.y, w:b._w, h:b._h, kind:'group' }) })
  var labels = L.labelBoxes.map(function(l){ return { x:l.x, y:l.y, w:l.w, h:l.h, kind:'label' } })

  var collisions = 0, minGap = Infinity
  // 節點/群組 兩兩(排除容器-成員關係)
  for (var i=0;i<rects.length;i++){
    for (var j=i+1;j<rects.length;j++){
      var A=rects[i], B=rects[j]
      if (related(A.id, B.id)) continue
      var ov = overlap(A, B)
      if (ov.ix > COLLIDE_TOL && ov.iy > COLLIDE_TOL){ collisions++ }
      else {
        // 未重疊: 取較近軸向之間隙(僅在另一軸有投影重疊時才計, 否則為斜對角不相鄰)
        if (ov.ix > 0) minGap = Math.min(minGap, -ov.iy)      // 水平有交集 → 垂直間隙
        else if (ov.iy > 0) minGap = Math.min(minGap, -ov.ix) // 垂直有交集 → 水平間隙
      }
    }
  }
  // 邊標籤 ↔ 節點/群組(群組框為淺底大容器, 標籤落其內屬正常 → 僅與 leaf 節點及其他標籤計碰撞)
  for (var li=0;li<labels.length;li++){
    var lab = labels[li]
    for (var ri=0;ri<rects.length;ri++){
      if (rects[ri].kind !== 'node') continue
      var ovl = overlap(lab, rects[ri])
      if (ovl.ix > COLLIDE_TOL && ovl.iy > COLLIDE_TOL) collisions++
    }
    for (var lj=li+1;lj<labels.length;lj++){
      var ovll = overlap(lab, labels[lj])
      if (ovll.ix > COLLIDE_TOL && ovll.iy > COLLIDE_TOL) collisions++
    }
  }
  if (!isFinite(minGap)) minGap = 0        // 無相鄰對(單一節點等)
  return { collisions: collisions, minGap: minGap }
}

// ---- 把一份 layout 結果實際畫到 LF 並截圖前準備(回傳畫布尺寸) ----
function renderLayout(L){
  var lfNodes = L.lfNodes, lfGroupNodes = L.lfGroupNodes, lfEdges = L.lfEdges

  // 整體 bbox → 畫布尺寸
  var minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9
  lfGroupNodes.concat(lfNodes).forEach(function(nd){
    minX=Math.min(minX, nd.x-nd._w/2); maxX=Math.max(maxX, nd.x+nd._w/2)
    minY=Math.min(minY, nd.y-nd._h/2); maxY=Math.max(maxY, nd.y+nd._h/2)
  })
  var M = CANVAS_MARGIN
  var W = Math.ceil(maxX-minX+M*2), H = Math.ceil(maxY-minY+M*2)
  var app = document.getElementById('app')
  app.innerHTML = ''
  app.style.width = W+'px'; app.style.height = H+'px'

  var G = window.Core || window.LogicFlow
  var LF = G.default || G.LogicFlow || G
  var RectNode = G.RectNode, RectNodeModel = G.RectNodeModel
  var DiamondNode = G.DiamondNode, DiamondNodeModel = G.DiamondNodeModel

  var lf = new LF({ container: app, grid:false, background:false, isSilentMode:true, stopScrollGraph:true, stopZoomGraph:true, adjustEdge:false,
    style: {
      rect: { rx: 7, ry: 7 },
      polyline: { stroke: EDGE.line, strokeWidth: 1.8 },
      nodeText: { color:'#1c2b36', fontFamily: FONT_FAMILY, fontSize: FONT_SIZE, overflowMode:'autoWrap', lineHeight: 1.4 },
    },
  })

  function makeRect(name){
    lf.register({ type: name, view: RectNode, model: class extends RectNodeModel {
      setAttributes(){ var p=this.properties||{}; if(p.width)this.width=p.width; if(p.height)this.height=p.height; this.radius=7 }
      getNodeStyle(){ var s=super.getNodeStyle(); var pal=this.properties._pal||PAL.blue; s.fill=pal.fill; s.stroke=pal.stroke; s.strokeWidth=this.properties.isGroup?2:1.8; if(this.properties.isGroup){s.fillOpacity=0.45} return s }
      getTextStyle(){ var s=super.getTextStyle(); var pal=this.properties._pal||PAL.blue; s.color=pal.text; s.fontFamily=FONT_FAMILY; s.fontSize=this.properties.isGroup?15:FONT_SIZE; if(this.properties.isGroup){s.fontWeight=700} s.overflowMode='autoWrap'; s.lineHeight=1.35; if(this.width)s.wrapPadding='0px'; return s }
    }})
  }
  function makeDiamond(name){
    lf.register({ type: name, view: DiamondNode, model: class extends DiamondNodeModel {
      setAttributes(){ var p=this.properties||{}; if(p.width)this.rx=p.width/2; if(p.height)this.ry=p.height/2 }
      getNodeStyle(){ var s=super.getNodeStyle(); var pal=this.properties._pal||PAL.diamond; s.fill=pal.fill; s.stroke=pal.stroke; s.strokeWidth=1.8; return s }
      getTextStyle(){ var s=super.getTextStyle(); var pal=this.properties._pal||PAL.diamond; s.color=pal.text; s.fontFamily=FONT_FAMILY; s.fontSize=FONT_SIZE; s.overflowMode='autoWrap'; return s }
    }})
  }
  makeRect('cRect'); makeDiamond('cDiamond')

  // 邊標籤樣式(全域修正 A): 背景透明(不遮轉折線) + 文字白色光暈(paint-order:stroke + stroke=白)
  function edgeText(s){
    s.color=EDGE.text; s.fontFamily=FONT_FAMILY; s.fontSize=12.5; s.overflowMode='default'; s.textWidth=400
    s.background={ fill:'transparent', stroke:'none' }   // 透明底: 線段能透出, 不被白底遮斷
    s.stroke=EDGE.haloColor; s.strokeWidth=EDGE.haloWidth; s.paintOrder='stroke'  // 白光暈描邊(描在文字下方)
    return s
  }
  var PolylineEdge=G.PolylineEdge, PolylineEdgeModel=G.PolylineEdgeModel
  lf.register({ type:'cDash', view:PolylineEdge, model: class extends PolylineEdgeModel {
    getEdgeStyle(){ var s=super.getEdgeStyle(); s.stroke='#7a8690'; s.strokeWidth=1.8; s.strokeDasharray='6 4'; return s }
    getTextStyle(){ return edgeText(super.getTextStyle()) }
  }})
  lf.register({ type:'cLine', view:PolylineEdge, model: class extends PolylineEdgeModel {
    getEdgeStyle(){ var s=super.getEdgeStyle(); s.stroke=EDGE.line; s.strokeWidth=1.8; return s }
    getTextStyle(){ return edgeText(super.getTextStyle()) }
  }})

  var graphNodes = []
  lfGroupNodes.forEach(function(b){
    graphNodes.push({ id:b.id, type:'cRect', x:b.x, y:b.y,
      text:{ value: b.label, x: b.x, y: Math.round(b.y - b._h/2 + GROUP_TITLE/2 + 4) },
      properties:{ width:b._w, height:b._h, isGroup:true, _pal:b._pal } })
  })
  lfNodes.forEach(function(nd){
    graphNodes.push({ id:nd.id, type: nd.type==='diamond'?'cDiamond':'cRect', x:nd.x, y:nd.y, text:nd.text, properties:{ width:nd._w, height:nd._h, _pal:nd._pal } })
  })
  var graphEdges = lfEdges.map(function(ed){
    return { id:ed.id, type: ed._dashed?'cDash':'cLine', sourceNodeId:ed.sourceNodeId, targetNodeId:ed.targetNodeId, text: ed.text||'' }
  })

  lf.render({ nodes: graphNodes, edges: graphEdges })

  // ---- 繪製順序(z-order, 原則2) ----
  //   LF 預設把邊畫在節點下方, 群組(node)與節點同層; 文字會被節點/群組底色蓋住。
  //   以 setElementZIndex 數值分層強制: 群組容器=底(Z_GROUP) → 節點=中(Z_NODE) → 邊與邊標籤=頂(Z_EDGE),
  //   確保任何文字(節點文字 / 群組標題 / 邊標籤)都不被容器填色或其他區塊遮住。
  var Z_GROUP = 1, Z_NODE = 10, Z_EDGE = 100
  lfGroupNodes.forEach(function(b){ lf.setElementZIndex(b.id, Z_GROUP) })   // 半透明容器墊最底
  lfNodes.forEach(function(nd){ lf.setElementZIndex(nd.id, Z_NODE) })       // 節點居中
  graphEdges.forEach(function(ed){ lf.setElementZIndex(ed.id, Z_EDGE) })    // 邊與邊標籤置頂

  return { w: W, h: H, nNodes: graphNodes.length, nEdges: graphEdges.length }
}

// ---- 對外: 解析 → 以單一緊湊固定間距排版 → 實際渲染(z-order 處理遮蔽, 不掃描放大間距) ----
window.renderFig = function(fig){ return new Promise(function(resolve){
  try {
    var P = prepare(fig)
    var sep = (P.rankDir === 'LR') ? SEP_LR : SEP_TB
    var L = layout(P, sep[0], sep[1])
    var d = detect(L)                         // 僅供回報(碰撞數/最小間隙), 不驅動任何放大
    var info = renderLayout(L)
    setTimeout(function(){ resolve({ ok:true, w:info.w, h:info.h, nNodes:info.nNodes, nEdges:info.nEdges,
      nodeSep:sep[0], rankSep:sep[1], collisions:d.collisions, minGap:Math.round(d.minGap) }) }, 200)
  } catch(e){ resolve({ ok:false, err: String(e && (e.stack||e.message||e)) }) }
})}
window.__ready = true
</script></body></html>`

// 對外: 單張正規化數據(同 FIGURES[n].data 結構) → PNG Buffer。重用上方 translate/HTML/渲染管線, 自行開關 browser, 不寫檔。
export async function genPng(data, opt = {}) {
    const browser = await chromium.launch()
    try {
        const page = await browser.newPage({ deviceScaleFactor: 2 })
        const errs = []
        page.on('pageerror', e => errs.push(e.message))
        page.on('console', m => { if (m.type() === 'error') errs.push('console:' + m.text()) })
        await page.setContent(html, { waitUntil: 'load' })
        await page.waitForFunction(() => window.__ready, { timeout: 30000 }).catch(() => {})
        await page.evaluate(() => document.fonts && document.fonts.ready)
        const fig = translate(data)
        const res = await page.evaluate((fig) => window.renderFig(fig), fig)
        if (!res.ok) throw new Error(res.err || 'renderFig failed')
        await page.evaluate(() => document.fonts && document.fonts.ready)
        return await page.locator('#app').screenshot()
    } finally {
        await browser.close()
    }
}
