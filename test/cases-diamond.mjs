// 菱形進出組合視覺案 — 僅供 p10 套件(不進 p1~p9 矩陣)
//   規則(共進共出, 每側獨立): 出=一律由該側「頂點」分岔; 進=純進側匯「頂點」、混合側依「半側」匯「斜邊中點」。
//   check 即規則之可執行翻譯: 斷言各邊實際繪製端點等於規劃錨點。
//
// 組合覆蓋說明(13 種進出組合):
//   - 本檔為「ELK 佈局可自然構造」之 9 種視覺案(產標準圖供人工檢視)。
//   - 純進側只在「頂側」可構造(分層佈局中, 菱形要位於來源上方就必有向下路徑=底側出)。
//   - 「同半側」類組合(2進同半側+1出、2出同半側+1進、進出同/異交叉之 ds/sd)受 ELK 交叉最小化
//     埠序限制, 乾淨合成圖排不出來(實驗多種構圖皆收斂為置中/對稱分佈或 ss 型); 此 4 種組合
//     連同其餘 9 種, 全數由 p10.test.mjs 之「菱形 13 種進出組合規則(單元驗證)」直接對繪製函式驗證。
//   - dia-2in-2out-ss 為單欄壅塞下自然出現之「進同半側+出同半側」實例(視覺可見共進共出)。

const EPS = 2.5
const near = (p, q) => !!p && !!q && Math.abs(p.x - q.x) <= EPS && Math.abs(p.y - q.y) <= EPS

// 菱形各錨點: 底/頂頂點, 底側左右半斜邊中點
function anchors(D) {
    const cx = D.x + D.w / 2, cy = D.y + D.h / 2, hw = D.w / 2, hh = D.h / 2
    return {
        vB: { x: cx, y: D.y + D.h },
        vT: { x: cx, y: D.y },
        mBL: { x: cx - hw / 2, y: cy + hh / 2 },
        mBR: { x: cx + hw / 2, y: cy + hh / 2 },
    }
}
const edgeOf = (geom, id) => geom.edges.find(e => e.id === id)
const segStart = (geom, id) => { const g = edgeOf(geom, id); const s = g && g.segs[0]; return s && s[0] }
const segEnd = (geom, id) => { const g = edgeOf(geom, id); const s = g && g.segs[g.segs.length - 1]; return s && s[s.length - 1] }
const fmt = (p) => p ? `(${p.x.toFixed(1)},${p.y.toFixed(1)})` : '(無)'

// 通用斷言組合器
const outAtVB = (geom, h, id) => { const D = h.node('D'), A = anchors(D), s = segStart(geom, id); return { name: `${id} 出=底頂點`, pass: near(s, A.vB), detail: `${fmt(s)} vs ${fmt(A.vB)}` } }
const inAtVT = (geom, h, id) => { const D = h.node('D'), A = anchors(D), s = segEnd(geom, id); return { name: `${id} 進=頂點(純進側)`, pass: near(s, A.vT), detail: `${fmt(s)} vs ${fmt(A.vT)}` } }
const inAtMid = (geom, h, id) => { const D = h.node('D'), A = anchors(D), s = segEnd(geom, id); return { name: `${id} 進=半側斜邊中點(混合側)`, pass: near(s, A.mBL) || near(s, A.mBR), detail: `${fmt(s)} vs L${fmt(A.mBL)}/R${fmt(A.mBR)}` } }
const insSameMid = (geom, h, a, b) => { const sa = segEnd(geom, a), sb = segEnd(geom, b); return { name: `${a},${b} 共進同一匯點(同半側)`, pass: near(sa, sb), detail: `${fmt(sa)} vs ${fmt(sb)}` } }
const insDiffMid = (geom, h, a, b) => { const D = h.node('D'), A = anchors(D), sa = segEnd(geom, a), sb = segEnd(geom, b); const ok = (near(sa, A.mBL) && near(sb, A.mBR)) || (near(sa, A.mBR) && near(sb, A.mBL)); return { name: `${a},${b} 分匯左右斜邊中點(不同半側)`, pass: ok, detail: `${fmt(sa)} / ${fmt(sb)}` } }

export const DIAMOND_CASES = [

    // 1) 純進側 1 進(頂側示範): 匯頂點
    {
        name: 'dia-1in', desc: '菱形純進側 — 1進(匯頂點)',
        data: {
            dir: 'TB',
            nodes: [
                { id: 'S', label: '來源', cls: 'blue' },
                { id: 'D', label: '判斷?', cls: 'diamond' },
            ],
            edges: [{ from: 'S', to: 'D' }],  //e0 頂側進
        },
        check: (spec, geom, h) => [inAtVT(geom, h, 'e0')],
    },

    // 2) 底側 1 出: 出=頂點
    {
        name: 'dia-1out', desc: '菱形底側 — 1出(頂點)',
        data: {
            dir: 'TB',
            nodes: [
                { id: 'S', label: '開始', cls: 'blue' },
                { id: 'D', label: '判斷?', cls: 'diamond' },
                { id: 'T', label: '結果', cls: 'green' },
            ],
            edges: [{ from: 'S', to: 'D' }, { from: 'D', to: 'T' }],  //e0,e1
        },
        check: (spec, geom, h) => [outAtVB(geom, h, 'e1')],
    },

    // 3) 純進側 2 進(頂側示範): 共進頂點(共用末段, 箭頭重合)
    {
        name: 'dia-2in', desc: '菱形純進側 — 2進(共進頂點)',
        data: {
            dir: 'TB',
            nodes: [
                { id: 'S1', label: '來源一', cls: 'blue' },
                { id: 'S2', label: '來源二', cls: 'purple' },
                { id: 'D', label: '判斷?', cls: 'diamond' },
            ],
            edges: [{ from: 'S1', to: 'D' }, { from: 'S2', to: 'D' }],  //e0,e1 頂側進
        },
        check: (spec, geom, h) => [inAtVT(geom, h, 'e0'), inAtVT(geom, h, 'e1')],
    },

    // 4) 底側 2 出: 共出頂點分岔
    {
        name: 'dia-2out', desc: '菱形底側 — 2出(共出頂點分岔)',
        data: {
            dir: 'TB',
            nodes: [
                { id: 'S', label: '開始', cls: 'blue' },
                { id: 'D', label: '判斷?', cls: 'diamond' },
                { id: 'T1', label: '結果一', cls: 'green' },
                { id: 'T2', label: '結果二', cls: 'orange' },
            ],
            edges: [{ from: 'S', to: 'D' }, { from: 'D', to: 'T1', label: '是' }, { from: 'D', to: 'T2', label: '否' }],  //e0,e1,e2
        },
        check: (spec, geom, h) => [outAtVB(geom, h, 'e1'), outAtVB(geom, h, 'e2')],
    },

    // 5) 底側 1進1出(混合): 出=頂點, 進=半側斜邊中點
    {
        name: 'dia-1in-1out', desc: '菱形底側 — 1進1出(出頂點/進斜邊中點)',
        data: {
            dir: 'TB',
            nodes: [
                { id: 'S', label: '開始', cls: 'blue' },
                { id: 'D', label: '判斷?', cls: 'diamond' },
                { id: 'T', label: '結果', cls: 'green' },
                { id: 'X', label: '回饋來源', cls: 'red' },
            ],
            edges: [
                { from: 'S', to: 'D' },                                //e0
                { from: 'D', to: 'T', label: '通過' },                  //e1 底側出
                { from: 'T', to: 'X' },                                //e2
                { from: 'X', to: 'D', kind: 'dashed', label: '退回' },  //e3 底側進
            ],
        },
        check: (spec, geom, h) => [outAtVB(geom, h, 'e1'), inAtMid(geom, h, 'e3')],
    },

    // 6) 底側 2進1出(2進不同半側): 出=頂點, 兩進分匯左右斜邊中點
    {
        name: 'dia-2in-1out', desc: '菱形底側 — 2進1出(2進分匯左右)',
        data: {
            dir: 'TB',
            nodes: [
                { id: 'S', label: '開始', cls: 'blue' },
                { id: 'D', label: '判斷?', cls: 'diamond' },
                { id: 'T', label: '結果', cls: 'green' },
                { id: 'X1', label: '來源一', cls: 'red' },
                { id: 'X2', label: '來源二', cls: 'red' },
            ],
            edges: [
                { from: 'S', to: 'D' },                   //e0
                { from: 'D', to: 'T' },                   //e1 底側出
                { from: 'T', to: 'X1' },                  //e2(X1,X2 兄弟展開 → 進不同半側)
                { from: 'T', to: 'X2' },                  //e3
                { from: 'X1', to: 'D', kind: 'dashed' },  //e4 底側進
                { from: 'X2', to: 'D', kind: 'dashed' },  //e5 底側進
            ],
        },
        check: (spec, geom, h) => [outAtVB(geom, h, 'e1'), insDiffMid(geom, h, 'e4', 'e5')],
    },

    // 7) 底側 1進2出(2出不同半側): 共出頂點左右分岔, 進=半側斜邊中點
    {
        name: 'dia-1in-2out', desc: '菱形底側 — 1進2出(2出左右分岔)',
        data: {
            dir: 'TB',
            nodes: [
                { id: 'S', label: '開始', cls: 'blue' },
                { id: 'D', label: '判斷?', cls: 'diamond' },
                { id: 'T1', label: '結果一', cls: 'green' },
                { id: 'T2', label: '結果二', cls: 'orange' },
                { id: 'X', label: '回饋來源', cls: 'red' },
            ],
            edges: [
                { from: 'S', to: 'D' },                   //e0
                { from: 'D', to: 'T1', label: '是' },      //e1 底側出
                { from: 'D', to: 'T2', label: '否' },      //e2 底側出
                { from: 'T1', to: 'X' },                  //e3
                { from: 'X', to: 'D', kind: 'dashed' },   //e4 底側進
            ],
        },
        check: (spec, geom, h) => [outAtVB(geom, h, 'e1'), outAtVB(geom, h, 'e2'), inAtMid(geom, h, 'e4')],
    },

    // 8) 底側 2進2出(單欄壅塞 → 自然形成進同半側+出同半側之實例)
    {
        name: 'dia-2in-2out-ss', desc: '菱形底側 — 2進2出(進同/出同)',
        data: {
            dir: 'TB',
            nodes: [
                { id: 'S', label: '開始', cls: 'blue' },
                { id: 'D', label: '判斷?', cls: 'diamond' },
                { id: 'T1', label: '結果一', cls: 'green' },
                { id: 'T2', label: '結果二', cls: 'orange' },
                { id: 'X1', label: '來源一', cls: 'red' },
                { id: 'X2', label: '來源二', cls: 'red' },
            ],
            edges: [
                { from: 'S', to: 'D' },                   //e0
                { from: 'D', to: 'T1' },                  //e1 底側出
                { from: 'D', to: 'T2' },                  //e2 底側出(T 疊欄)
                { from: 'T1', to: 'T2' },                 //e3
                { from: 'T2', to: 'X1' },                 //e4
                { from: 'X1', to: 'X2' },                 //e5(X 疊欄)
                { from: 'X1', to: 'D', kind: 'dashed' },  //e6 底側進
                { from: 'X2', to: 'D', kind: 'dashed' },  //e7 底側進
            ],
        },
        check: (spec, geom, h) => [outAtVB(geom, h, 'e1'), outAtVB(geom, h, 'e2'), insSameMid(geom, h, 'e6', 'e7'), inAtMid(geom, h, 'e6')],
    },

    // 9) 底側 2進2出(進不同半側, 出不同半側)
    {
        name: 'dia-2in-2out-dd', desc: '菱形底側 — 2進2出(進不同/出不同)',
        data: {
            dir: 'TB',
            nodes: [
                { id: 'S', label: '開始', cls: 'blue' },
                { id: 'D', label: '判斷?', cls: 'diamond' },
                { id: 'T1', label: '結果一', cls: 'green' },
                { id: 'T2', label: '結果二', cls: 'orange' },
                { id: 'X1', label: '來源一', cls: 'red' },
                { id: 'X2', label: '來源二', cls: 'red' },
            ],
            edges: [
                { from: 'S', to: 'D' },                   //e0
                { from: 'D', to: 'T1', label: '是' },      //e1 底側出
                { from: 'D', to: 'T2', label: '否' },      //e2 底側出
                { from: 'T1', to: 'X1' },                  //e3
                { from: 'T2', to: 'X2' },                  //e4
                { from: 'X1', to: 'D', kind: 'dashed' },   //e5 底側進
                { from: 'X2', to: 'D', kind: 'dashed' },   //e6 底側進
            ],
        },
        check: (spec, geom, h) => [outAtVB(geom, h, 'e1'), outAtVB(geom, h, 'e2'), insDiffMid(geom, h, 'e5', 'e6')],
    },

]
