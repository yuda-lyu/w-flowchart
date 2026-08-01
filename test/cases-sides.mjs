// 邊進出方位指定(fromSide/toSide)案 — 僅供 p10 套件(不進 p1~p9 矩陣)
//   規則(spec, 見 src/p10/README.md「邊進出方位指定」):
//     1. edge 帶 fromSide/toSide('L'|'R'|'T'|'B')時, 該邊改自端點節點之指定側出/入(ELK port FIXED_SIDE)。
//     2. 菱形端點: port 定側後貼齊規則仍生效 → 指定側之出邊 snap 至該側「頂點」; 因指定而讓出的側恢復純進 → 進邊匯頂點。
//     3. 矩形端點: 邊端點落在指定側之「面」上(x 或 y 貼齊該面), 無頂點 snap。
//     4. 群組端點: 側值忽略(不建 port), 邊照常路由不失敗。
//   check 即上述規則之可執行翻譯: 斷言邊實際繪製端點落在指定側之錨點/面。
const EPS = 2.5
const near = (p, q) => !!p && !!q && Math.abs(p.x - q.x) <= EPS && Math.abs(p.y - q.y) <= EPS

// 菱形四頂點
function vertices(D) {
    const cx = D.x + D.w / 2, cy = D.y + D.h / 2
    return {
        vT: { x: cx, y: D.y },
        vB: { x: cx, y: D.y + D.h },
        vL: { x: D.x, y: cy },
        vR: { x: D.x + D.w, y: cy },
    }
}
const edgeOf = (geom, id) => geom.edges.find(e => e.id === id)
const segStart = (geom, id) => { const g = edgeOf(geom, id); const s = g && g.segs[0]; return s && s[0] }
const segEnd = (geom, id) => { const g = edgeOf(geom, id); const s = g && g.segs[g.segs.length - 1]; return s && s[s.length - 1] }
const fmt = (p) => p ? `(${p.x.toFixed(1)},${p.y.toFixed(1)})` : '(無)'

// 點貼齊矩形某側之「面」: 指定軸座標貼齊該面, 另一軸落在框範圍內
function onFace(p, box, side) {
    if (!p) return false
    const inX = p.x >= box.x - EPS && p.x <= box.x + box.w + EPS
    const inY = p.y >= box.y - EPS && p.y <= box.y + box.h + EPS
    if (side === 'L') return Math.abs(p.x - box.x) <= EPS && inY
    if (side === 'R') return Math.abs(p.x - (box.x + box.w)) <= EPS && inY
    if (side === 'T') return Math.abs(p.y - box.y) <= EPS && inX
    return Math.abs(p.y - (box.y + box.h)) <= EPS && inX
}

export const SIDE_CASES = [

    // 1) 菱形 fromSide:'L'(規則 2; 即報告之「退回」情境): 退回邊自左頂點出, 頂側恢復純進匯頂點, 底側出仍為底頂點
    {
        name: 'side-dia-out-L', desc: '菱形指定 fromSide:L — 退回邊左頂點出/進邊回頂點',
        data: {
            dir: 'TB',
            nodes: [
                { id: 'S', label: '申請資料', cls: 'blue' },
                { id: 'D', label: '審核通過?', cls: 'diamond' },
                { id: 'T', label: '建檔完成', cls: 'green' },
            ],
            edges: [
                { from: 'S', to: 'D' },                                              //e0 頂側進
                { from: 'D', to: 'T', label: '是' },                                  //e1 底側出
                { from: 'D', to: 'S', label: '退回', kind: 'dashed', fromSide: 'L' },  //e2 指定左側出
            ],
        },
        check: (spec, geom, h) => {
            const V = vertices(h.node('D'))
            const s2 = segStart(geom, 'e2'), s0 = segEnd(geom, 'e0'), s1 = segStart(geom, 'e1')
            return [
                { name: 'e2 出=左頂點(fromSide:L)', pass: near(s2, V.vL), detail: `${fmt(s2)} vs ${fmt(V.vL)}` },
                { name: 'e0 進=頂點(頂側因指定恢復純進)', pass: near(s0, V.vT), detail: `${fmt(s0)} vs ${fmt(V.vT)}` },
                { name: 'e1 出=底頂點(未指定側不受影響)', pass: near(s1, V.vB), detail: `${fmt(s1)} vs ${fmt(V.vB)}` },
            ]
        },
    },

    // 2) 矩形 fromSide:'R' + toSide:'L'(規則 3): TB 直排下預設必為底出/頂進, 指定後改走側面
    {
        name: 'side-rect-RL', desc: '矩形指定 fromSide:R/toSide:L — 邊走側面非上下',
        data: {
            dir: 'TB',
            nodes: [
                { id: 'a', label: '節點甲', cls: 'blue' },
                { id: 'b', label: '節點乙', cls: 'green' },
            ],
            edges: [{ from: 'a', to: 'b', fromSide: 'R', toSide: 'L' }],  //e0
        },
        check: (spec, geom, h) => {
            const A = h.node('a'), B = h.node('b')
            const s = segStart(geom, 'e0'), e = segEnd(geom, 'e0')
            return [
                { name: 'e0 起點=甲右側面(fromSide:R)', pass: onFace(s, A, 'R'), detail: `${fmt(s)} vs 右面x=${(A.x + A.w).toFixed(1)}` },
                { name: 'e0 終點=乙左側面(toSide:L)', pass: onFace(e, B, 'L'), detail: `${fmt(e)} vs 左面x=${B.x.toFixed(1)}` },
            ]
        },
    },

    // 3) 群組端點側值忽略(規則 4): fromSide 掛在群組上不建 port, 邊照常路由(不炸不失聯)
    {
        name: 'side-group-ignored', desc: '群組端點帶 fromSide — 側值忽略仍正常路由',
        data: {
            dir: 'TB',
            nodes: [
                { id: 'G', label: '處理群組', cls: 'blueG' },
                { id: 'm', label: '成員', cls: 'blue', group: 'G' },
                { id: 'x', label: '外部節點', cls: 'green' },
            ],
            edges: [{ from: 'G', to: 'x', fromSide: 'L' }],  //e0(兩端接節點由通用不變量 6 把關)
        },
        check: (spec, geom) => {
            const g = edgeOf(geom, 'e0'), seg = g && g.segs && g.segs.find(s => s.length >= 2)
            return [{ name: 'e0 有路由(群組端點側值被忽略不致失敗)', pass: !!seg, detail: seg ? `${seg.length} 點` : '(無路由)' }]
        },
    },

]
