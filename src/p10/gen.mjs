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
function ensureStub(pts, MIN){
  function fixEnd(p){
    const n=p.length; if(n<4) return
    const C=p[n-1], B=p[n-2]
    const dx=C.x-B.x, dy=C.y-B.y, len=Math.abs(dx)+Math.abs(dy)
    if(len>=MIN || len<0.5) return
    const need=MIN-len, ux=dx/len, uy=dy/len
    p[n-2]={x:B.x-ux*need, y:B.y-uy*need}
    p[n-3]={x:p[n-3].x-ux*need, y:p[n-3].y-uy*need}
  }
  fixEnd(pts)
  pts.reverse(); fixEnd(pts); pts.reverse()
  return pts
}

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
    const gOpts = { 'elk.padding':'[top=10,left=14,bottom=14,right=14]', 'elk.nodeLabels.placement':'[H_CENTER, V_TOP, INSIDE]', 'elk.algorithm':'layered', 'elk.direction':dir, 'elk.edgeRouting':'ORTHOGONAL', 'elk.hierarchyHandling':'INCLUDE_CHILDREN', 'elk.spacing.nodeNode':'28', 'elk.layered.spacing.nodeNodeBetweenLayers':'30', 'elk.spacing.edgeEdge':'22', 'elk.layered.spacing.edgeEdgeBetweenLayers':'24', ...ORDER_OPTS }
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
    const rootOpts = { 'elk.algorithm':'layered', 'elk.direction':dir, 'elk.edgeRouting':'ORTHOGONAL', 'elk.hierarchyHandling':'INCLUDE_CHILDREN', 'elk.spacing.nodeNode':'30', 'elk.layered.spacing.nodeNodeBetweenLayers':'34', 'elk.spacing.edgeNode':'24', 'elk.spacing.edgeEdge':'22', 'elk.layered.spacing.edgeEdgeBetweenLayers':'24', 'elk.layered.spacing.edgeNodeBetweenLayers':'26', ...(hasCycle ? { 'elk.layered.cycleBreaking.strategy':'MODEL_ORDER' } : ORDER_OPTS) }
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
      svg+='<foreignObject x="'+tx+'" y="'+ty+'" width="'+tw+'" height="'+th+'"><div xmlns="http://www.w3.org/1999/xhtml" class="lbl" style="text-align:center;font-weight:bold;font-size:'+GFS+'px;color:'+o.g.stroke+';line-height:1.3">'+esc(o.g.label)+'</div></foreignObject>'
    })
    // 2) 邊(在節點之下、容器之上)
    edgesOut.forEach(o=>{
      const e=o.e
      ;(e.sections||[]).forEach(sec=>{
        const pts=[sec.startPoint].concat(sec.bendPoints||[]).concat([sec.endPoint]).map(p=>({x:o.ox+p.x, y:o.oy+p.y}))
        ensureStub(pts, 18)
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
    // 3) 節點(最上)
    nodesOut.forEach(o=>{
      const n=o.n
      if(n.items && n.items.length){ // 標題+項目框: 依序分層(框背景→標題背景→框線→分隔線→標題→items), 使框線置頂不被標題背景遮蔽、線寬完整
        const headH=(size[n.id]&&size[n.id].headH)||26, r=7, sep=o.y+headH
        const lis=n.items.map(it=>'<div style="white-space:nowrap">•&#160;'+esc(it)+'</div>').join('')
        svg+='<rect x="'+o.x+'" y="'+o.y+'" width="'+o.w+'" height="'+o.h+'" rx="'+r+'" fill="'+n.fill+'"/>'  // 1 框背景
        svg+='<path d="M '+(o.x+r)+' '+o.y+' H '+(o.x+o.w-r)+' A '+r+' '+r+' 0 0 1 '+(o.x+o.w)+' '+(o.y+r)+' V '+sep+' H '+o.x+' V '+(o.y+r)+' A '+r+' '+r+' 0 0 1 '+(o.x+r)+' '+o.y+' Z" fill="'+mix(n.fill,n.stroke,0.16)+'"/>'  // 2 標題背景(上圓角下平)
        svg+='<rect x="'+o.x+'" y="'+o.y+'" width="'+o.w+'" height="'+o.h+'" rx="'+r+'" fill="none" stroke="'+n.stroke+'" stroke-width="1.6"/>'  // 3 框線(頂層)
        svg+='<line x1="'+o.x+'" y1="'+sep+'" x2="'+(o.x+o.w)+'" y2="'+sep+'" stroke="'+n.stroke+'" stroke-width="1"/>'  // 4 分隔線
        svg+='<foreignObject x="'+o.x+'" y="'+o.y+'" width="'+o.w+'" height="'+headH+'"><div xmlns="http://www.w3.org/1999/xhtml" class="lbl" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;text-align:center;font-weight:bold;font-size:'+FS+'px;color:'+n.font+'">'+esc(n.title||n.label)+'</div></foreignObject>'  // 5 標題文字
        svg+='<foreignObject x="'+o.x+'" y="'+sep+'" width="'+o.w+'" height="'+(o.h-headH)+'"><div xmlns="http://www.w3.org/1999/xhtml" class="lbl" style="font-size:'+(FS-1)+'px;line-height:1.55;padding:6px 9px 4px;text-align:left;color:'+n.font+'">'+lis+'</div></foreignObject>'  // 6 items文字
      } else if(n.diamond){ const cx=o.x+o.w/2, cy=o.y+o.h/2
        svg+='<polygon points="'+cx+','+o.y+' '+(o.x+o.w)+','+cy+' '+cx+','+(o.y+o.h)+' '+o.x+','+cy+'" fill="'+n.fill+'" stroke="'+n.stroke+'" stroke-width="1.8"/>'
        svg+='<foreignObject x="'+o.x+'" y="'+o.y+'" width="'+o.w+'" height="'+o.h+'"><div xmlns="http://www.w3.org/1999/xhtml" class="lbl" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;text-align:center;font-size:'+FS+'px;color:'+n.font+';line-height:1.4;padding:0 4px;box-sizing:border-box">'+esc(n.label)+'</div></foreignObject>'
      } else {
        svg+='<rect x="'+o.x+'" y="'+o.y+'" width="'+o.w+'" height="'+o.h+'" rx="7" fill="'+n.fill+'" stroke="'+n.stroke+'" stroke-width="1.6"/>'
        svg+='<foreignObject x="'+o.x+'" y="'+o.y+'" width="'+o.w+'" height="'+o.h+'"><div xmlns="http://www.w3.org/1999/xhtml" class="lbl" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;text-align:center;font-size:'+FS+'px;color:'+n.font+';line-height:1.4;padding:0 4px;box-sizing:border-box">'+esc(n.label)+'</div></foreignObject>'
      }
    })

    const full='<svg xmlns="http://www.w3.org/2000/svg" width="'+(W+PAD*2)+'" height="'+(H+PAD*2)+'" viewBox="'+(-PAD)+' '+(-PAD)+' '+(W+PAD*2)+' '+(H+PAD*2)+'" style="background:#fff">'+svg+'</svg>'
    document.getElementById('stage').innerHTML = full
    // 幾何輸出(供 test 斷言: 存在性/包含/標題不溢出/重疊/A4比例/items框高); 不影響 SVG/PNG
    const geom = {
      W:W+PAD*2, H:H+PAD*2,
      nodes: nodesOut.map(o=>({ id:o.n.id, x:o.x, y:o.y, w:o.w, h:o.h, parent:o.n.parent||null, kind:(o.n.items&&o.n.items.length)?'items':(o.n.diamond?'diamond':'box'), headH:(size[o.n.id]&&size[o.n.id].headH)||null })),
      groups: groupsOut.map(o=>({ id:o.g.id, x:o.x, y:o.y, w:o.w, h:o.h, depth:o.depth, parent:o.g.parent||null, labelW:(o.lbl&&o.lbl.width)||0 })),
      edges: edgesOut.map(o=>({ id:o.e.id, segs:(o.e.sections||[]).map(sec=>[sec.startPoint].concat(sec.bendPoints||[]).concat([sec.endPoint]).map(p=>({x:o.ox+p.x,y:o.oy+p.y}))) }))
    }
    return { ok:true, w:W+PAD*2, h:H+PAD*2, geom }
  } catch(e){ return { ok:false, err:String(e&&(e.stack||e.message)||e).slice(0,400) } }
}
window.__ready = true
</script></body></html>`

// 單張渲染 → PNG Buffer(供 WFlowchart 統一入口呼叫; 自帶瀏覽器生命週期)
export async function genPng(data, opt = {}) {
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
        return await page.locator('#stage svg').screenshot()
    }
    finally {
        await browser.close()
    }
}
