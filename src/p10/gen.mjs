// p10 — ELK 直用 + 自寫 SVG 渲染器(資料驅動)
//   genPng(data): 正規化繪圖數據 → elkjs(layered, 巢狀容器 INCLUDE_CHILDREN, 正交邊路由)算佈局
//   → 自寫 SVG 渲染(容器/節點/正交邊/標籤, foreignObject 渲中文)→ 截圖回傳 PNG Buffer
//   p1~p9 為現成套件; p10 為自寫渲染器產線。ELK 的分層演算法對「巢狀容器 + 循環 + 正交路由」最強。
//   原則: 字型全 JhengHei; 群組容器由 ELK 正確包住成員(不逃逸); 緊湊; 中文不爆框; 邊標籤白光暈不遮線。
import { chromium } from 'playwright'
import { colorOf, isGroupCls, EDGE } from '../common/palette.mjs'
import { pkgScript } from '../common/pkg.mjs'

// elkjs 由本機 node_modules 內聯注入(取代 CDN, 斷網環境可用)
const ELK_JS = pkgScript('elkjs/lib/elk.bundled.js')

// 正規化數據 → spec(節點/群組(可巢狀)/邊)
export function translate(data) {
    // mi=原始數據索引(容器與葉節點同一序列): 供渲染端 elk.position 保序(同層混排容器/葉節點時仍可比較)
    const groups = data.nodes.filter(n => isGroupCls(n.cls)).map(n => { const c = colorOf(n.cls); return { id: n.id, label: n.label, parent: n.group || null, align: n.align, mi: data.nodes.indexOf(n), fill: c.fill, stroke: c.stroke, font: c.text } })
    const nodes = data.nodes.filter(n => !isGroupCls(n.cls)).map(n => { const c = colorOf(n.cls); return { id: n.id, label: n.label, title: n.title, items: n.items, parent: n.group || null, mi: data.nodes.indexOf(n), diamond: c.shape === 'diamond', fill: c.fill, stroke: c.stroke, font: c.text } })
    const edges = data.edges.map((e, i) => ({ id: 'e' + i, from: e.from, to: e.to, label: e.label || '', dashed: e.kind === 'dashed' }))
    // 每邊之 LCA 容器: ELK 對「宣告於某容器的邊」回傳之 section 座標相對該容器; 故把邊放到 source/target 之最近共同祖先容器, 渲染才對位(否則跑到左上)
    const parentOf = {}; groups.forEach(g => parentOf[g.id] = g.parent); nodes.forEach(n => parentOf[n.id] = n.parent)
    const anc = id => { const r = []; let p = parentOf[id]; while (p) { r.push(p); p = parentOf[p] } return r }
    edges.forEach(e => { const at = new Set(anc(e.to)); e.container = anc(e.from).find(a => at.has(a)) || null })
    return { dir: data.dir || 'TB', nodes, groups, edges }
}

export const PAGE_HTML = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<script>${ELK_JS}</script>
<style>body{margin:0;background:#fff} .lbl{font-family:'Microsoft JhengHei','微軟正黑體',sans-serif}</style>
</head><body>
<div id="meas" style="position:absolute;left:-99999px;top:0;font-family:'Microsoft JhengHei',sans-serif;visibility:hidden"></div>
<div id="stage"></div>
<script>
const FONT = "'Microsoft JhengHei','微軟正黑體',sans-serif"
const EDGE_LINE = '${EDGE.line}', EDGE_TEXT = '${EDGE.text}', HALO = '${EDGE.haloColor}'
const FS = 14, GFS = 15, EFS = 12.5, MAXW = 200
// 容器內矩形框之垂直對齊: 預設 top; 可於數據之群組節點設 align:'top'|'center'|'bottom' 個別覆寫(改 DEF_VALIGN 改全域預設)
const VALIGN = { top:'TOP', center:'CENTER', bottom:'BOTTOM' }, DEF_VALIGN = 'top'
const meas = document.getElementById('meas')
function measure(label, fs, maxW){
  const d=document.createElement('div')
  d.style.cssText='display:inline-block;white-space:normal;overflow-wrap:break-word;word-break:normal;text-align:center;line-height:1.4;font-size:'+fs+'px;max-width:'+maxW+'px;padding:0;font-family:'+FONT
  d.textContent=label; meas.appendChild(d); const r=d.getBoundingClientRect(); meas.removeChild(d)
  return { w:Math.ceil(r.width), h:Math.ceil(r.height) }
}
// 量整塊 items 尺寸: 完全比照渲染(line-height 1.55、各項 nowrap)→ 直接得 items 區實際高度, 避免逐項估高(用錯 line-height)累積成底部多餘留白
function measureItems(items, fs){
  const d=document.createElement('div')
  d.style.cssText='display:inline-block;font-size:'+fs+'px;line-height:1.55;font-family:'+FONT
  d.innerHTML=items.map(it=>'<div style="white-space:nowrap">•&#160;'+String(it).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>').join('')
  meas.appendChild(d); const r=d.getBoundingClientRect(); meas.removeChild(d)
  return { w:Math.ceil(r.width), h:Math.ceil(r.height) }
}
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
const mix = (a,b,t) => { const pa=[1,3,5].map(i=>parseInt(a.slice(i,i+2),16)), pb=[1,3,5].map(i=>parseInt(b.slice(i,i+2),16)); return '#'+pa.map((x,i)=>Math.round(x*(1-t)+pb[i]*t).toString(16).padStart(2,'0')).join('') }
// 確保「起點後第一段」與「終點前最後一段」之直線長度 >= MIN(轉折不貼端點, 維持箭頭指向性)。
//   做法: 末段過短時, 沿趨近軸向把「最後轉角」與「其前一轉角」一起後移(兩者同移=保正交); 需 >=4 點才不動端點。
// ── 菱形端點貼齊(ELK 以外接矩形算端點, 落在矩形邊上非頂點處會與菱形斜邊「空接」) ──
//   規則(共進共出, 每側獨立; 詳 p10/README):
//     R1 共出: 該側所有「出」一律由該側「頂點」出發, 多條共用首段後於各自高度 90 度轉出(分岔)。
//     R2 共進: 該側「無出」→ 全部匯入「頂點」(各自橫移至中軸, 共用末段, 箭頭重合);
//              該側「有出」→ 依「半側」匯入該半側「斜邊中點」(頂點讓給出, 進出不同點)。
//   正交線交叉允許存在(正交路由常態), 一致性優先。

// 判定端點落在外接矩形哪一側; 回 { ax, sg, v }(離開軸/正負/該側頂點), 不在邊上回 null
function diamondSide(p, box){
  const cx = box.x + box.w/2, cy = box.y + box.h/2, EPS = 1.5
  if (Math.abs(p.y - (box.y + box.h)) < EPS) return { ax: 'y', sg: 1, v: { x: cx, y: box.y + box.h } }
  if (Math.abs(p.y - box.y) < EPS) return { ax: 'y', sg: -1, v: { x: cx, y: box.y } }
  if (Math.abs(p.x - box.x) < EPS) return { ax: 'x', sg: -1, v: { x: box.x, y: cy } }
  if (Math.abs(p.x - (box.x + box.w)) < EPS) return { ax: 'x', sg: 1, v: { x: box.x + box.w, y: cy } }
  return null
}

// 該側某「半側」之斜邊中點(混合側的進匯點); half=+1 取座標較大半側, -1 反之
function diamondSlantMid(box, side, half){
  const cx = box.x + box.w/2, cy = box.y + box.h/2, hw = box.w/2, hh = box.h/2
  if (side.ax === 'y') return { x: cx + half * hw / 2, y: cy + side.sg * hh / 2 }
  return { x: cx + side.sg * hw / 2, y: cy + half * hh / 2 }
}

// R1 共出: 出邊起點改自「頂點」出發
function routeOutFromVertex(pts, side){
  const p0 = pts[0], p1 = pts[1]
  const EPS = 1.5, J = 18
  const v = side.v
  const off = side.ax === 'y' ? Math.abs(p0.x - v.x) : Math.abs(p0.y - v.y)
  if (off < EPS) return   // 已在頂點(置中), 不動
  const alongAxis = side.ax === 'y' ? Math.abs(p1.x - p0.x) < EPS : Math.abs(p1.y - p0.y) < EPS
  if (!alongAxis) { pts.unshift(v); return }   // 原首段即沿側邊橫走: 自頂點先橫走接回
  if (pts.length > 2) {
    // 有後續轉折: 頂點 → 沿軸行至原首個轉折高度 → 橫向接回(單一 L 型; 轉折可貼近頂點)
    const q1 = side.ax === 'y' ? { x: v.x, y: p1.y } : { x: p1.x, y: v.y }
    pts.splice(0, 1, v, q1)
    return
  }
  // 無轉折之直線邊: 於頂點外側作雙直角接回各自路線(距離取 J 與可用長度之小者)
  const segLen = side.ax === 'y' ? (p1.y - p0.y) * side.sg : (p1.x - p0.x) * side.sg
  const j = Math.min(J, Math.max(4, segLen / 2))
  const q1 = side.ax === 'y' ? { x: v.x, y: v.y + side.sg * j } : { x: v.x + side.sg * j, y: v.y }
  const q2 = side.ax === 'y' ? { x: p0.x, y: v.y + side.sg * j } : { x: v.x + side.sg * j, y: p0.y }
  pts.splice(0, 1, v, q1, q2)
}

// R2 決策: 進匯點 = 該側無出 → 頂點; 有出 → 依端點所在半側之斜邊中點
function diamondInAnchor(box, side, hasOutOnSide, pE){
  if(!hasOutOnSide) return { x: side.v.x, y: side.v.y }
  const half = (side.ax === 'y' ? (pE.x - (box.x + box.w/2)) : (pE.y - (box.y + box.h/2))) >= 0 ? 1 : -1
  return diamondSlantMid(box, side, half)
}

// R2 共進: 進邊終點改匯入 anchor(頂點或半側斜邊中點)
//   橫向差距小且末段前為可伸縮橫向段 → 整段末端直線「平移」對齊 anchor 軸線(零多餘轉折);
//   否則於側外 J 處橫移 bus 再沿軸進入 anchor。
function routeInToAnchor(pts, side, anchor){
  const pE = pts[pts.length - 1], pP = pts[pts.length - 2]
  const EPS = 1.5, J = 18, SLIDE = 40   // SLIDE: 可平移之最大橫向差距(過大恐撞鄰近元素, 改走 bus)
  const alongAxis = side.ax === 'y' ? Math.abs(pP.x - pE.x) < EPS : Math.abs(pP.y - pE.y) < EPS
  if (!alongAxis) return   // 末段非沿進入軸(罕見), 保留原路由
  const lateral = side.ax === 'y' ? Math.abs(pE.x - anchor.x) : Math.abs(pE.y - anchor.y)
  if (lateral < EPS) {
    pts[pts.length - 1] = { x: anchor.x, y: anchor.y }   // 已在 anchor 軸線上: 直接沿軸進入
    return
  }
  if (lateral <= SLIDE && pts.length >= 3) {
    const pP2 = pts[pts.length - 3]
    const prevHorizontal = side.ax === 'y' ? Math.abs(pP2.y - pP.y) < EPS : Math.abs(pP2.x - pP.x) < EPS
    if (prevHorizontal) {
      if (side.ax === 'y') pP.x = anchor.x; else pP.y = anchor.y
      pts[pts.length - 1] = { x: anchor.x, y: anchor.y }
      return
    }
  }
  const Lv = side.ax === 'y' ? side.v.y + side.sg * J : side.v.x + side.sg * J   // 側外橫移層
  const segOK = side.ax === 'y' ? (pP.y - Lv) * side.sg > 2 : (pP.x - Lv) * side.sg > 2   // 原末段須延伸到橫移層之外
  if (!segOK) { pts[pts.length - 1] = { x: anchor.x, y: anchor.y }; return }   // 空間不足: 直接斜線前最短接入(極罕見)
  const b1 = side.ax === 'y' ? { x: pE.x, y: Lv } : { x: Lv, y: pE.y }
  const b2 = side.ax === 'y' ? { x: anchor.x, y: Lv } : { x: Lv, y: anchor.y }
  pts.splice(pts.length - 1, 1, b1, b2, { x: anchor.x, y: anchor.y })
}

function ensureStub(pts, MIN, skipStart){
  function fixEnd(p){
    const n=p.length; if(n<4) return
    const C=p[n-1], B=p[n-2]
    const dx=C.x-B.x, dy=C.y-B.y, len=Math.abs(dx)+Math.abs(dy)
    if(len>=MIN || len<0.5) return
    const need=MIN-len, ux=dx/len, uy=dy/len
    p[n-2]={x:B.x-ux*need, y:B.y-uy*need}
    p[n-3]={x:p[n-3].x-ux*need, y:p[n-3].y-uy*need}
  }
  // 終點端(箭頭側)一律套最低門檻——含菱形貼齊後之路徑(bus 支線本給滿 J; 平移/保留支線之轉角平移不破壞正交)
  fixEnd(pts)
  // 起點端僅於「菱形頂點分岔」時跳過(分岔轉折貼近頂點屬預期; 後移轉角會與其後路徑段脫勾扭出斜線)
  if(!skipStart){ pts.reverse(); fixEnd(pts); pts.reverse() }
  return pts
}

// 供測試直接驗證菱形端點規則之純函式(不影響渲染)
window.__dia = { diamondSide, diamondSlantMid, diamondInAnchor, routeOutFromVertex, routeInToAnchor }

window.renderFig = async function(spec){
  try {
    const dir = spec.dir==='LR' ? 'RIGHT' : 'DOWN'
    const nById={}, gById={}
    spec.nodes.forEach(n=>nById[n.id]=n); spec.groups.forEach(g=>gById[g.id]=g)

    // 節點尺寸量測
    const size={}
    spec.nodes.forEach(n=>{
      if(n.items && n.items.length){ // 標題+項目節點(類 UML class box): 量標題與各項目 → 框寬=最寬列+邊距, 框高=標題列+各項目列
        const tm=measure(n.title||n.label, FS, 250), im=measureItems(n.items, FS-1)
        const headH=tm.h+12  // 標題列高(框頂到分隔線), 供分層繪製定位
        size[n.id]={ w:Math.max(tm.w, im.w)+30, h:headH+im.h+10, headH }  // items 區高 = 實量塊高 + 上下 padding(6+4), 與渲染一致無多餘留白
      } else { const m=measure(n.label, FS, n.diamond?150:MAXW); if(n.diamond){ const d=Math.round(Math.max(m.w,m.h)*1.5+34); size[n.id]={w:d,h:d} } else size[n.id]={w:m.w+24,h:m.h+16} }
    })

    // 遞迴建 ELK 子樹(群組含 children)
    // 保序: 數據之節點順序=語義順序(選單/報告章節順序), 令 ELK 同層節點依 model order 排列, 不因交叉最小化重排(如 GIS2D/GIS3D 被拆開)。
    //   considerModelOrder/forceNodeModelOrder 於 elkjs + INCLUDE_CHILDREN(巢狀)會內部崩潰, 故改用 semiInteractive:
    //   crossingMinimization.semiInteractive + 各葉節點 elk.position 位置提示(以數據序為序), 同層節點依提示排序, 巢狀圖亦支援。
    //   例外: 含循環(如流程之退回邊)的圖, 位置提示會干擾分層使入口節點偏離頂端 → 根層不加提示(容器內仍保序)。
    const ORDER_OPTS = { 'elk.layered.crossingMinimization.semiInteractive':'true' }
    const hasCycle = (() => { const adj={}; spec.edges.forEach(e=>{ (adj[e.from]=adj[e.from]||[]).push(e.to) }); const st={}; const dfs=(u)=>{ st[u]=1; for(const v of (adj[u]||[])){ if(st[v]===1) return true; if(!st[v] && dfs(v)) return true } st[u]=2; return false }; return Object.keys(adj).some(u=>!st[u]&&dfs(u)) })()
    const gOpts = { 'elk.layered.nodePlacement.bk.fixedAlignment':'BALANCED', 'elk.padding':'[top=10,left=14,bottom=14,right=14]', 'elk.nodeLabels.placement':'[H_CENTER, V_TOP, INSIDE]', 'elk.algorithm':'layered', 'elk.direction':dir, 'elk.edgeRouting':'ORTHOGONAL', 'elk.hierarchyHandling':'INCLUDE_CHILDREN', 'elk.spacing.nodeNode':'28', 'elk.layered.spacing.nodeNodeBetweenLayers':'30', 'elk.spacing.edgeEdge':'22', 'elk.layered.spacing.edgeEdgeBetweenLayers':'24', ...ORDER_OPTS }
    function elkEdge(e){ const lab = e.label ? [{ text:e.label, width: measure(e.label,EFS,300).w, height:18 }] : []; return { id:e.id, sources:[e.from], targets:[e.to], labels:lab } }
    function build(parentId, padMap, wrapAR){
      const children=[], edges=[]
      spec.groups.filter(g=>g.parent===parentId).forEach(g=>{ const sub=build(g.id, padMap, wrapAR); const gm=measure(g.label,GFS,400)
        // 第二趟: 標題比容器寬時加大該容器左右 padding 撐寬(ELK 尊重複合容器 padding; 巢狀父容器自動跟著變寬, 不溢出又不過寬)
        const ex=(padMap&&padMap[g.id])||0
        const go={ ...gOpts, 'elk.padding':'[top=10,left='+(14+ex)+',bottom=14,right='+(14+ex)+']' }
        // A4 折排: 該容器被挑中時設 aspectRatio 觸發 ELK wrapping, 把線性鏈折成多欄/列(跨欄/列連接線由 ELK 自動正交路由)
        const ar=wrapAR&&wrapAR[g.id]; if(ar){ go['elk.aspectRatio']=String(ar); go['elk.layered.wrapping.strategy']='SINGLE_EDGE' }
        if(parentId || !hasCycle){ go['elk.position']='('+g.mi+','+g.mi+')' }
        children.push({ id:g.id, labels:[{text:g.label, width:gm.w+12, height:gm.h+6}], layoutOptions:go, children:sub.children, edges:sub.edges }) })
      spec.nodes.filter(n=>n.parent===parentId).forEach(n=>{ const va=VALIGN[(gById[parentId]&&gById[parentId].align)||DEF_VALIGN]||'TOP'; const lo={ 'elk.alignment':va }; if(parentId || !hasCycle){ lo['elk.position']='('+n.mi+','+n.mi+')' } children.push({ id:n.id, width:size[n.id].w, height:size[n.id].h, layoutOptions:lo }) })
      spec.edges.filter(e=>e.container===parentId).forEach(e=>{ edges.push(elkEdge(e)) })
      return { children, edges }
    }
    const rootOpts = { 'elk.layered.nodePlacement.bk.fixedAlignment':'BALANCED', 'elk.algorithm':'layered', 'elk.direction':dir, 'elk.edgeRouting':'ORTHOGONAL', 'elk.hierarchyHandling':'INCLUDE_CHILDREN', 'elk.spacing.nodeNode':'30', 'elk.layered.spacing.nodeNodeBetweenLayers':'34', 'elk.spacing.edgeNode':'24', 'elk.spacing.edgeEdge':'22', 'elk.layered.spacing.edgeEdgeBetweenLayers':'24', 'elk.layered.spacing.edgeNodeBetweenLayers':'26', ...(hasCycle ? { 'elk.layered.cycleBreaking.strategy':'MODEL_ORDER' } : ORDER_OPTS) }
    const elk = new ELK()
    const mkGraph = (pm, war) => { const rb = build(null, pm, war); return { id:'root', layoutOptions:rootOpts, children:rb.children, edges:rb.edges } }
    let res = await elk.layout(mkGraph({}, {}))
    // 第二趟: 偵測「標題寬 > 容器寬」之容器 → 加大其左右 padding 撐寬, 重新佈局(巢狀父容器自動跟進; 標題不溢出又不過寬)
    const padMap = {}
    ;(function collect(cell){ (cell.children||[]).forEach(ch=>{ if(gById[ch.id]){ const lw=(ch.labels&&ch.labels[0]&&ch.labels[0].width)||0; if(lw>(ch.width||0)) padMap[ch.id]=Math.ceil((lw-ch.width)/2)+6; collect(ch) } }) })(res)
    if(Object.keys(padMap).length) res = await elk.layout(mkGraph(padMap, {}))
    // ---- A4 長寬比自動折排 ----
    //   A4 直式 h/w≈1.414、橫式≈0.707. 過高(R>HIGH)→挑最高之多子容器折成多欄縮高; 過寬(R<LOW)→挑最寬者折成多列增高.
    //   折排引擎=ELK wrapping(設 aspectRatio 觸發, 自動正交畫跨欄/列連接線); 逐次加深直到落入 A4 區間 / 無可折 / 達上限.
    const A4HIGH=1.45, A4LOW=0.70, wrapAR={}
    const foldable = () => { const out=[]; (function w(cell){ (cell.children||[]).forEach(ch=>{ if(gById[ch.id]){ if((ch.children||[]).length>=4) out.push({id:ch.id, w:ch.width||0, h:ch.height||0}); w(ch) } }) })(res); return out }
    for(let it=0; it<8; it++){
      const R=(res.height||1)/(res.width||1)
      if(R<=A4HIGH && R>=A4LOW) break
      const fs=foldable(); if(!fs.length) break
      let pick
      if(R>A4HIGH){ fs.sort((a,b)=>b.h-a.h); pick=fs.find(g=>(wrapAR[g.id]||0.6)<6) }
      else { fs.sort((a,b)=>b.w-a.w); pick=fs.find(g=>(wrapAR[g.id]||3.5)>0.22) }
      if(!pick) break
      wrapAR[pick.id] = R>A4HIGH ? (wrapAR[pick.id]||0.6)*1.9 : (wrapAR[pick.id]||3.5)/1.9
      res = await elk.layout(mkGraph(padMap, wrapAR))
    }

    // 遞迴收集: 容器(深度序)、節點(絕對座標)、邊(以容器絕對座標 + section 點)
    const groupsOut=[], nodesOut=[], edgesOut=[]
    function walk(cell, ox, oy, depth){
      ;(cell.children||[]).forEach(ch=>{
        const ax=ox+(ch.x||0), ay=oy+(ch.y||0)
        if (gById[ch.id]) { groupsOut.push({ g:gById[ch.id], x:ax, y:ay, w:ch.width, h:ch.height, depth, lbl:(ch.labels&&ch.labels[0])||null }); walk(ch, ax, ay, depth+1) }
        else if (nById[ch.id]) nodesOut.push({ n:nById[ch.id], x:ax, y:ay, w:ch.width, h:ch.height })
      })
      ;(cell.edges||[]).forEach(e=>{ edgesOut.push({ e:e, ox:ox, oy:oy }) })
    }
    walk(res, 0, 0, 0)

    const W=Math.ceil(res.width), H=Math.ceil(res.height), PAD=18
    let svg=''
    // 1) 容器(外層先畫=墊底; depth 小先畫)
    groupsOut.sort((a,b)=>a.depth-b.depth).forEach(o=>{
      svg+='<rect x="'+(o.x)+'" y="'+(o.y)+'" width="'+o.w+'" height="'+o.h+'" rx="8" fill="'+o.g.fill+'" fill-opacity="0.38" stroke="'+o.g.stroke+'" stroke-width="2"/>'
      const tw=o.lbl?o.lbl.width+12:o.w, th=o.lbl?o.lbl.height+6:24, tx=o.x+Math.max(0,(o.w-tw)/2), ty=o.y+(o.lbl?o.lbl.y:5)
      svg+='<foreignObject x="'+tx+'" y="'+ty+'" width="'+tw+'" height="'+th+'"><div xmlns="http://www.w3.org/1999/xhtml" class="lbl" style="text-align:center;font-weight:bold;font-size:'+GFS+'px;color:'+o.g.stroke+';line-height:1.3;overflow-wrap:break-word;word-break:normal">'+esc(o.g.label)+'</div></foreignObject>'
    })
    // 2) 邊(在節點之下、容器之上)
    const nodeBoxById={}; nodesOut.forEach(o=>{ nodeBoxById[o.n.id]={ x:o.x, y:o.y, w:o.w, h:o.h, diamond:!!o.n.diamond } })
    const specEdgeById={}; spec.edges.forEach(se=>{ specEdgeById[se.id]=se })
    // 2a) 蒐集各 section 絕對路徑點 + 統計各菱形「各側」進出數(側=上/下/左/右, key: nodeId|軸|正負)。
    //     規則: 純出側→全部由頂點分岔; 純入側→各自貼斜邊; 混合側→全部貼斜邊
    //     (混合側若連出走頂點+橫向接回, 橫向段必與夾在中間的連入直線交叉; 全貼斜邊則零共用點、零新增交叉)
    const drawList=[], sideMix={}
    edgesOut.forEach(o=>{
      const e=o.e, se=specEdgeById[e.id]
      const srcBox=se&&nodeBoxById[se.from], tgtBox=se&&nodeBoxById[se.to]
      const secs=(e.sections||[]).map(sec=>{
        const pts=[sec.startPoint].concat(sec.bendPoints||[]).concat([sec.endPoint]).map(p=>({x:o.ox+p.x, y:o.oy+p.y}))
        const item={ pts }
        if(srcBox&&srcBox.diamond){ item.srcSide=diamondSide(pts[0], srcBox); if(item.srcSide){ const k=se.from+'|'+item.srcSide.ax+item.srcSide.sg; (sideMix[k]=sideMix[k]||{in:0,out:0}).out++ } }
        if(tgtBox&&tgtBox.diamond){ item.tgtSide=diamondSide(pts[pts.length-1], tgtBox); if(item.tgtSide){ const k=se.to+'|'+item.tgtSide.ax+item.tgtSide.sg; (sideMix[k]=sideMix[k]||{in:0,out:0}).in++ } }
        return item
      })
      drawList.push({ o, e, se, srcBox, tgtBox, secs })
    })
    // 2a-2) 通用路徑化簡: ELK 階層邊(INCLUDE_CHILDREN)常見「先繞反方向再折返」之 S/U 形繞行,
    //   反覆對「三段式窗」(平行-垂直-平行)嘗試收斂成兩段, 僅在碰撞偵測全過才接受:
    //   不撞節點框/容器標題帶/邊標籤、不與他邊平行段貼齊併線; 端點段軸向與方向不可翻轉(維持節點進出方向,
    //   化簡先於菱形貼齊故不干擾貼齊規則); 本邊標籤若因化簡脫離路徑則整段還原(標籤座標由 ELK 依原路徑決定)。
    const obstacles=[]
    nodesOut.forEach(o=>{ obstacles.push({ x:o.x-8, y:o.y-8, w:o.w+16, h:o.h+16 }) })
    groupsOut.forEach(o=>{ if(!o.lbl) return; const tw=o.lbl.width+12, th=o.lbl.height+6, tx=o.x+Math.max(0,(o.w-tw)/2), ty=o.y+o.lbl.y; obstacles.push({ x:tx-4, y:ty-4, w:tw+8, h:th+8 }) })
    const labelBoxes=[]
    drawList.forEach(dd=>{ (dd.e.labels||[]).forEach(l=>{ if(!l.text) return; labelBoxes.push({ x:dd.o.ox+(l.x||0)-2, y:dd.o.oy+(l.y||0)-2, w:(l.width||40)+10, h:(l.height||18)+8 }) }) })
    function segHitsBox(a,b,box){   // 軸對齊線段 vs 矩形(線段必水平或垂直)
      const x1=Math.min(a.x,b.x), x2=Math.max(a.x,b.x), y1=Math.min(a.y,b.y), y2=Math.max(a.y,b.y)
      return x2>box.x && x1<box.x+box.w && y2>box.y && y1<box.y+box.h
    }
    function segOverlapsOther(a,b,selfItem){   // 與他邊平行段貼齊重疊(側距<6 且共線範圍>10)→ 視覺併線, 拒絕
      const horiz = Math.abs(a.y-b.y)<0.5
      for(const dd of drawList) for(const it of dd.secs){ if(it===selfItem) continue
        const q=it.pts
        for(let k=0;k+1<q.length;k++){ const c=q[k], d=q[k+1]
          if(horiz && Math.abs(c.y-d.y)<0.5 && Math.abs(c.y-a.y)<6){ const lo=Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x)), hi=Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x)); if(hi-lo>10) return true }
          if(!horiz && Math.abs(c.x-d.x)<0.5 && Math.abs(c.x-a.x)<6){ const lo=Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y)), hi=Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y)); if(hi-lo>10) return true }
        }
      }
      return false
    }
    // 標籤一律為硬障礙(含本邊自己的): ELK 邊標籤是「先佔位、路徑繞標籤走」, 原路的 jog 即標籤讓位,
    // 拉直會從自家標籤正中穿過(且「脫離才還原」守門對「穿過=距離變近」無感), 故不可豁免自家標籤
    function segClear(a,b,selfItem){
      for(const ob of obstacles) if(segHitsBox(a,b,ob)) return false
      for(const lb of labelBoxes) if(segHitsBox(a,b,lb)) return false
      return !segOverlapsOther(a,b,selfItem)
    }
    function mergeColl(p){   // 去重合點 + 併共線(含同線折返, 折返僅由化簡產生)
      for(let i=p.length-2;i>=0;i--) if(Math.abs(p[i].x-p[i+1].x)<0.5 && Math.abs(p[i].y-p[i+1].y)<0.5) p.splice(i,1)
      for(let i=p.length-2;i>=1;i--){ const A=p[i-1],B=p[i],C=p[i+1]
        if((Math.abs(A.x-B.x)<0.5 && Math.abs(B.x-C.x)<0.5) || (Math.abs(A.y-B.y)<0.5 && Math.abs(B.y-C.y)<0.5)) p.splice(i,1) }
    }
    function distToPoly(pt,p){ let d=Infinity
      for(let i=0;i+1<p.length;i++){ const a=p[i], b=p[i+1]
        const len2=Math.max(1,(b.x-a.x)*(b.x-a.x)+(b.y-a.y)*(b.y-a.y))
        const t=Math.max(0,Math.min(1, ((pt.x-a.x)*(b.x-a.x)+(pt.y-a.y)*(b.y-a.y))/len2 ))
        const qx=a.x+t*(b.x-a.x), qy=a.y+t*(b.y-a.y); d=Math.min(d, Math.hypot(pt.x-qx, pt.y-qy)) }
      return d
    }
    function simplifyOrtho(item, labels){
      const p=item.pts
      const before=p.map(q=>({x:q.x,y:q.y}))
      mergeColl(p)
      for(let pass=0; pass<20; pass++){
        let changed=false
        for(let i=0;i+3<p.length;i++){
          const isStart=(i===0), isEnd=(i+3===p.length-1)
          if(isStart && isEnd) continue   // 4 點路徑已極簡, 兩端軸向無法同時保持
          const A=p[i], B=p[i+1], C=p[i+2], D=p[i+3]
          const s1h=Math.abs(A.y-B.y)<0.5
          // 取代點取窗之一角: 一般保持首段軸向; 末端窗改保持末段軸向(箭頭進入方向不可變)
          const P = isEnd ? (s1h ? {x:A.x,y:D.y} : {x:D.x,y:A.y}) : (s1h ? {x:D.x,y:A.y} : {x:A.x,y:D.y})
          if(isStart){ const sg0=s1h?Math.sign(B.x-A.x):Math.sign(B.y-A.y), sgN=s1h?Math.sign(P.x-A.x):Math.sign(P.y-A.y); if(sgN!==sg0) continue }
          if(isEnd){ const s3h=Math.abs(C.y-D.y)<0.5, sg0=s3h?Math.sign(D.x-C.x):Math.sign(D.y-C.y), sgN=s3h?Math.sign(D.x-P.x):Math.sign(D.y-P.y); if(sgN!==sg0) continue }
          if(!segClear(A,P,item) || !segClear(P,D,item)) continue
          p.splice(i+1, 2, P)
          mergeColl(p)
          changed=true
          break
        }
        if(!changed) break
      }
      // 標籤守門: 化簡若令本邊任一標籤脫離路徑(距離顯著變大), 整段還原
      if(labels.length && p.length !== before.length){
        for(const l of labels){
          if(distToPoly(l,p) > distToPoly(l,before)+2){ p.length=0; before.forEach(q=>p.push(q)); return }
        }
      }
    }
    drawList.forEach(dd=>{
      const labs=(dd.e.labels||[]).filter(l=>l.text).map(l=>({ x:dd.o.ox+(l.x||0)+(l.width||40)/2, y:dd.o.oy+(l.y||0)+(l.height||18)/2 }))
      dd.secs.forEach(item=>{ if(item.pts.length>=5) simplifyOrtho(item, labs) })
    })
    // 2b) 依側別規則貼齊並繪製
    const procSegsById={}   // 實際繪製之路徑點(含菱形貼齊與 ensureStub), 供 geom 輸出一致
    drawList.forEach(dd=>{
      const o=dd.o, e=dd.e
      dd.secs.forEach(item=>{
        const pts=item.pts
        if(item.srcSide && pts.length >= 2) routeOutFromVertex(pts, item.srcSide)   // R1: 出永遠自該側頂點
        if(item.tgtSide && pts.length >= 2){
          // R2: 純進側匯「頂點」; 混合側依「半側」匯「斜邊中點」(進出不同點)
          const m=sideMix[dd.se.to+'|'+item.tgtSide.ax+item.tgtSide.sg]
          const anchor=diamondInAnchor(dd.tgtBox, item.tgtSide, !!(m && m.out > 0), pts[pts.length-1])
          routeInToAnchor(pts, item.tgtSide, anchor)
        }
        // 分岔/匯入重排後清除共線折返: 頂點分岔之「接回原路第一轉折層」若跨過下一轉點, 會多走再折回疊出短勾, 併共線即塌縮為直接連線
        if(item.srcSide || item.tgtSide) mergeColl(pts)
        ensureStub(pts, 18, !!item.srcSide)
        ;(procSegsById[e.id]=procSegsById[e.id]||[]).push(pts)
        let d='M '+pts[0].x+' '+pts[0].y; for(let i=1;i<pts.length;i++) d+=' L '+pts[i].x+' '+pts[i].y
        const dash = (e.id && spec.edges.find(x=>x.id===e.id) && spec.edges.find(x=>x.id===e.id).dashed) ? ' stroke-dasharray="6 4"' : ''
        svg+='<path d="'+d+'" fill="none" stroke="'+EDGE_LINE+'" stroke-width="2"'+dash+'/>'
        // 箭頭(終點)
        const a=pts[pts.length-2], b=pts[pts.length-1], ang=Math.atan2(b.y-a.y,b.x-a.x), L=9, w=4
        const x1=b.x-L*Math.cos(ang)+w*Math.sin(ang), y1=b.y-L*Math.sin(ang)-w*Math.cos(ang)
        const x2=b.x-L*Math.cos(ang)-w*Math.sin(ang), y2=b.y-L*Math.sin(ang)+w*Math.cos(ang)
        svg+='<path d="M '+b.x+' '+b.y+' L '+x1+' '+y1+' L '+x2+' '+y2+' Z" fill="'+EDGE_LINE+'"/>'
      })
      // 邊標籤(白光暈)
      ;(e.labels||[]).forEach(l=>{ if(!l.text) return; const lx=o.ox+(l.x||0), ly=o.oy+(l.y||0), lw=l.width||40, lh=l.height||18
        svg+='<foreignObject x="'+lx+'" y="'+ly+'" width="'+(lw+6)+'" height="'+(lh+4)+'"><div xmlns="http://www.w3.org/1999/xhtml" class="lbl" style="font-size:'+EFS+'px;color:'+EDGE_TEXT+';text-shadow:0 0 3px '+HALO+',0 0 3px '+HALO+',0 0 3px '+HALO+',0 0 3px '+HALO+';white-space:nowrap">'+esc(l.text)+'</div></foreignObject>' })
    })
    // 3) 節點(最上)。各文字 div 之斷行 CSS(overflow-wrap:break-word + word-break:normal)須與 measure()/measureItems() 一致,
    //    否則長英文識別字量測時折行、渲染時不折 → 單行溢出 foreignObject 被裁切
    nodesOut.forEach(o=>{
      const n=o.n
      if(n.items && n.items.length){ // 標題+項目框: 依序分層(框背景→標題背景→框線→分隔線→標題→items), 使框線置頂不被標題背景遮蔽、線寬完整
        const headH=(size[n.id]&&size[n.id].headH)||26, r=7, sep=o.y+headH
        const lis=n.items.map(it=>'<div style="white-space:nowrap">•&#160;'+esc(it)+'</div>').join('')
        svg+='<rect x="'+o.x+'" y="'+o.y+'" width="'+o.w+'" height="'+o.h+'" rx="'+r+'" fill="'+n.fill+'"/>'  // 1 框背景
        svg+='<path d="M '+(o.x+r)+' '+o.y+' H '+(o.x+o.w-r)+' A '+r+' '+r+' 0 0 1 '+(o.x+o.w)+' '+(o.y+r)+' V '+sep+' H '+o.x+' V '+(o.y+r)+' A '+r+' '+r+' 0 0 1 '+(o.x+r)+' '+o.y+' Z" fill="'+mix(n.fill,n.stroke,0.16)+'"/>'  // 2 標題背景(上圓角下平)
        svg+='<rect x="'+o.x+'" y="'+o.y+'" width="'+o.w+'" height="'+o.h+'" rx="'+r+'" fill="none" stroke="'+n.stroke+'" stroke-width="1.6"/>'  // 3 框線(頂層)
        svg+='<line x1="'+o.x+'" y1="'+sep+'" x2="'+(o.x+o.w)+'" y2="'+sep+'" stroke="'+n.stroke+'" stroke-width="1"/>'  // 4 分隔線
        svg+='<foreignObject x="'+o.x+'" y="'+o.y+'" width="'+o.w+'" height="'+headH+'"><div xmlns="http://www.w3.org/1999/xhtml" class="lbl" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;text-align:center;font-weight:bold;font-size:'+FS+'px;color:'+n.font+'"><div style="width:100%;min-width:0;overflow-wrap:break-word;word-break:normal">'+esc(n.title||n.label)+'</div></div></foreignObject>'  // 5 標題文字
        svg+='<foreignObject x="'+o.x+'" y="'+sep+'" width="'+o.w+'" height="'+(o.h-headH)+'"><div xmlns="http://www.w3.org/1999/xhtml" class="lbl" style="font-size:'+(FS-1)+'px;line-height:1.55;padding:6px 9px 4px;text-align:left;color:'+n.font+'">'+lis+'</div></foreignObject>'  // 6 items文字
      } else if(n.diamond){ const cx=o.x+o.w/2, cy=o.y+o.h/2
        svg+='<polygon points="'+cx+','+o.y+' '+(o.x+o.w)+','+cy+' '+cx+','+(o.y+o.h)+' '+o.x+','+cy+'" fill="'+n.fill+'" stroke="'+n.stroke+'" stroke-width="1.8"/>'
        svg+='<foreignObject x="'+o.x+'" y="'+o.y+'" width="'+o.w+'" height="'+o.h+'"><div xmlns="http://www.w3.org/1999/xhtml" class="lbl" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;text-align:center;font-size:'+FS+'px;color:'+n.font+';line-height:1.4;padding:0 4px;box-sizing:border-box"><div style="width:100%;min-width:0;overflow-wrap:break-word;word-break:normal">'+esc(n.label)+'</div></div></foreignObject>'
      } else {
        svg+='<rect x="'+o.x+'" y="'+o.y+'" width="'+o.w+'" height="'+o.h+'" rx="7" fill="'+n.fill+'" stroke="'+n.stroke+'" stroke-width="1.6"/>'
        svg+='<foreignObject x="'+o.x+'" y="'+o.y+'" width="'+o.w+'" height="'+o.h+'"><div xmlns="http://www.w3.org/1999/xhtml" class="lbl" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;text-align:center;font-size:'+FS+'px;color:'+n.font+';line-height:1.4;padding:0 4px;box-sizing:border-box"><div style="width:100%;min-width:0;overflow-wrap:break-word;word-break:normal">'+esc(n.label)+'</div></div></foreignObject>'
      }
    })

    const full='<svg xmlns="http://www.w3.org/2000/svg" width="'+(W+PAD*2)+'" height="'+(H+PAD*2)+'" viewBox="'+(-PAD)+' '+(-PAD)+' '+(W+PAD*2)+' '+(H+PAD*2)+'" style="background:#fff">'+svg+'</svg>'
    document.getElementById('stage').innerHTML = full
    // 幾何輸出(供 test 斷言: 存在性/包含/標題不溢出/重疊/A4比例/items框高); 不影響 SVG/PNG
    const geom = {
      W:W+PAD*2, H:H+PAD*2,
      nodes: nodesOut.map(o=>({ id:o.n.id, x:o.x, y:o.y, w:o.w, h:o.h, parent:o.n.parent||null, kind:(o.n.items&&o.n.items.length)?'items':(o.n.diamond?'diamond':'box'), headH:(size[o.n.id]&&size[o.n.id].headH)||null })),
      groups: groupsOut.map(o=>({ id:o.g.id, x:o.x, y:o.y, w:o.w, h:o.h, depth:o.depth, parent:o.g.parent||null, labelW:(o.lbl&&o.lbl.width)||0 })),
      edges: edgesOut.map(o=>({ id:o.e.id, segs: procSegsById[o.e.id]||[] }))
    }
    return { ok:true, w:W+PAD*2, h:H+PAD*2, geom }
  } catch(e){ return { ok:false, err:String(e&&(e.stack||e.message)||e).slice(0,400) } }
}
window.__ready = true
</script></body></html>`

// 渲染單張至就緒頁面(renderFig 完成 + 字型就緒); caller 負責 close browser
async function renderFigPage(data) {
    const browser = await chromium.launch()
    try {
        const page = await browser.newPage({ deviceScaleFactor: 2 })
        await page.setContent(PAGE_HTML, { waitUntil: 'load' })
        await page.waitForFunction(() => window.__ready, { timeout: 60000 }).catch(() => {})
        await page.evaluate(() => document.fonts && document.fonts.ready)
        const res = await page.evaluate(s => window.renderFig(s), translate(data))
        if (!res.ok) throw new Error('p10 render failed: ' + res.err)
        await page.evaluate(() => document.fonts && document.fonts.ready)
        await page.waitForTimeout(150)
        return { browser, page }
    }
    catch (err) {
        await browser.close()
        throw err
    }
}

// 單張渲染 → PNG Buffer(供 WFlowchart 統一入口呼叫; 自帶瀏覽器生命週期)
export async function genPng(data, opt = {}) {
    const { browser, page } = await renderFigPage(data)
    try {
        return await page.locator('#stage svg').screenshot()
    }
    finally {
        await browser.close()
    }
}

// 單張渲染 → SVG 字串(本產線自組之 SVG; &nbsp; 正規化為 &#160; 使其為合法 standalone SVG)
export async function genSvg(data, opt = {}) {
    const { browser, page } = await renderFigPage(data)
    try {
        return (await page.evaluate(() => document.getElementById('stage').innerHTML)).replace(/&nbsp;/g, '&#160;').trim()
    }
    finally {
        await browser.close()
    }
}
