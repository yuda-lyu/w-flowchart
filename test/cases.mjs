// p10 合成測試案例 — 每案隔離「一個 p10 機制」, 失敗時可快速定位是哪個機制被改壞。
//   data 為標準正規化數據 {dir,nodes,edges}(與 9 張報告圖同格式; cls 見 common/palette.mjs)。
//   expect: 選用之比例界線(A4 折排案)。 check(spec,geom,h): 選用之案例專屬斷言(回 [{name,pass,detail}])。
//   通用不變量(存在性/包含/標題不溢出/不重疊/items框/邊)由 lib.runInvariants 對「所有」案例(含 9 真圖)套用。

export const CASES = [

    // 1) 最基本: 純 label 矩形節點 + 實線箭頭, 直式
    {
        name: 'flat-tb',
        desc: '基本 — 純 label 矩形 + 實線箭頭 (TB)',
        data: {
            dir: 'TB',
            nodes: [
                { id: 'A', label: '節點 A', cls: 'blue' },
                { id: 'B', label: '節點 B', cls: 'green' },
                { id: 'C', label: '節點 C', cls: 'orange' },
            ],
            edges: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }],
        },
    },

    // 2) 標題+items 富節點(6 層框: 框背景/標題背景/框線/分隔線/標題/items); 不同 item 數驗框高算法
    {
        name: 'items-node',
        desc: '富節點 — 標題+items 分層框 (含框高算法)',
        data: {
            dir: 'TB',
            nodes: [
                { id: 'X', title: '服務 X', items: ['項目一', '項目二', '項目三', '項目四', '項目五'], cls: 'orange' },
                { id: 'Y', title: '服務 Y', items: ['只有一項'], cls: 'orange' },
            ],
            edges: [{ from: 'X', to: 'Y', label: '呼叫' }],
        },
        check(spec, geom, h) {
            const X = h.node('X'); const Y = h.node('Y')
            return [
                { name: 'X 為 items 框', pass: !!X && X.kind === 'items' && X.headH > 0, detail: X && `kind=${X.kind} headH=${X.headH}` },
                { name: 'Y 為 items 框', pass: !!Y && Y.kind === 'items' && Y.headH > 0, detail: Y && `kind=${Y.kind} headH=${Y.headH}` },
                // 多 item 框應高於少 item 框(框高隨內容, 非固定)
                { name: '框高隨 item 數', pass: !!X && !!Y && X.h > Y.h, detail: X && Y && `X.h=${X.h} Y.h=${Y.h}` },
            ]
        },
    },

    // 3) 二層巢狀容器 + 跨容器邊(LCA 邊路由: a→c 應掛在最近共同祖先 OUT)
    {
        name: 'nested-group',
        desc: '巢狀 — 二層容器 + 跨內層邊 (LCA 路由)',
        data: {
            dir: 'TB',
            nodes: [
                { id: 'OUT', label: '外層容器', cls: 'blueG' },
                { id: 'IN1', label: '內層 A', cls: 'greenG', group: 'OUT' },
                { id: 'IN2', label: '內層 B', cls: 'greenG', group: 'OUT' },
                { id: 'a', label: 'a', cls: 'green', group: 'IN1' },
                { id: 'b', label: 'b', cls: 'green', group: 'IN1' },
                { id: 'c', label: 'c', cls: 'green', group: 'IN2' },
            ],
            edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c', label: '跨層' }],
        },
        check(spec, geom, h) {
            const OUT = h.group('OUT'); const IN1 = h.group('IN1'); const IN2 = h.group('IN2')
            return [
                { name: '三層深度齊備', pass: !!OUT && !!IN1 && !!IN2 && OUT.depth === 0 && IN1.depth === 1 && IN2.depth === 1, detail: `OUT=${OUT && OUT.depth} IN1=${IN1 && IN1.depth} IN2=${IN2 && IN2.depth}` },
            ]
        },
    },

    // 4) 容器標題比成員寬 → 2-pass padding 撐寬, 標題不溢出(此前修過的 bug)
    {
        name: 'title-overflow',
        desc: '標題撐寬 — 容器標題比成員寬, 2-pass 不溢出',
        data: {
            dir: 'TB',
            nodes: [
                { id: 'WIDE', label: '這是一個相當長的容器標題用於測試自動撐寬', cls: 'purpleG' },
                { id: 's1', label: '短', cls: 'purple', group: 'WIDE' },
                { id: 's2', label: 'A', cls: 'purple', group: 'WIDE' },
            ],
            edges: [{ from: 's1', to: 's2' }],
        },
        check(spec, geom, h) {
            const W = h.group('WIDE')
            return [
                { name: '標題寬 ≤ 容器寬', pass: !!W && W.labelW <= W.w + 2, detail: W && `labelW=${W.labelW} w=${W.w}` },
            ]
        },
    },

    // 5) 決策菱形 + 通過/退回分支
    {
        name: 'diamond',
        desc: '菱形 — 決策節點 + 是/否分支',
        data: {
            dir: 'TB',
            nodes: [
                { id: 'P', label: '輸入', cls: 'blue' },
                { id: 'D', label: '判斷?', cls: 'diamond' },
                { id: 'Y', label: '通過', cls: 'green' },
                { id: 'N', label: '退回', cls: 'red' },
            ],
            edges: [{ from: 'P', to: 'D' }, { from: 'D', to: 'Y', label: '是' }, { from: 'D', to: 'N', label: '否' }],
        },
        check(spec, geom, h) {
            const D = h.node('D')
            return [{ name: 'D 為菱形', pass: !!D && D.kind === 'diamond', detail: D && `kind=${D.kind}` }]
        },
    },

    // 6) 邊樣式: 實線 / 虛線(dashed) / 帶標籤(白光暈) / 短邊(ensureStub)
    {
        name: 'edges-mix',
        desc: '邊樣式 — 實線/虛線/帶標籤/短邊 stub',
        data: {
            dir: 'TB',
            nodes: [
                { id: 'A', label: '來源', cls: 'blue' },
                { id: 'B', label: '目標一', cls: 'green' },
                { id: 'C', label: '目標二', cls: 'orange' },
            ],
            edges: [
                { from: 'A', to: 'B', label: '實線標籤' },
                { from: 'A', to: 'C', kind: 'dashed', label: '虛線標籤' },
                { from: 'B', to: 'C' },
            ],
        },
    },

    // 7) A4 過高 → 折排: 最高之多子容器(垂直鏈)折成多欄縮高
    {
        name: 'fold-tall',
        desc: 'A4 折排 — 過高, 多子容器折成多欄',
        data: {
            dir: 'TB',
            nodes: [
                { id: 'G', label: '垂直長鏈容器', cls: 'blueG' },
                ...Array.from({ length: 7 }, (_, i) => ({ id: 'n' + i, label: '步驟 ' + (i + 1), cls: 'blue', group: 'G' })),
            ],
            edges: Array.from({ length: 6 }, (_, i) => ({ from: 'n' + i, to: 'n' + (i + 1) })),
        },
        expect: { ratioMax: 1.45 },
        check(spec, geom, h) {
            const xs = new Set(geom.nodes.filter(n => n.parent === 'G').map(n => Math.round(n.x / 20)))
            return [{ name: '已折成 ≥2 欄', pass: xs.size >= 2, detail: '欄數(x 帶)=' + xs.size }]
        },
    },

    // 8) A4 過寬 → 折排: 最寬之多子容器(水平鏈)折成多列增高
    {
        name: 'fold-wide',
        desc: 'A4 折排 — 過寬, 多子容器折成多列',
        data: {
            dir: 'LR',
            nodes: [
                { id: 'G', label: '水平長鏈容器', cls: 'orangeG' },
                ...Array.from({ length: 7 }, (_, i) => ({ id: 'n' + i, label: '階段 ' + (i + 1), cls: 'orange', group: 'G' })),
            ],
            edges: Array.from({ length: 6 }, (_, i) => ({ from: 'n' + i, to: 'n' + (i + 1) })),
        },
        expect: { ratioMin: 0.70 },
        check(spec, geom, h) {
            const ys = new Set(geom.nodes.filter(n => n.parent === 'G').map(n => Math.round(n.y / 20)))
            return [{ name: '已折成 ≥2 列', pass: ys.size >= 2, detail: '列數(y 帶)=' + ys.size }]
        },
    },

    // 9) 容器內矩形框垂直對齊: top / center / bottom(各容器一高框一矮框, 驗矮框位置)
    {
        name: 'valign',
        desc: '垂直對齊 — 容器內框 top/center/bottom',
        data: {
            dir: 'TB',
            nodes: [
                { id: 'gT', label: 'top 對齊', cls: 'blueG', align: 'top' },
                { id: 'tT', title: '高框', items: ['一', '二', '三', '四', '五'], cls: 'blue', group: 'gT' },
                { id: 'sT', label: '矮', cls: 'green', group: 'gT' },
                { id: 'gC', label: 'center 對齊', cls: 'blueG', align: 'center' },
                { id: 'tC', title: '高框', items: ['一', '二', '三', '四', '五'], cls: 'blue', group: 'gC' },
                { id: 'sC', label: '矮', cls: 'green', group: 'gC' },
                { id: 'gB', label: 'bottom 對齊', cls: 'blueG', align: 'bottom' },
                { id: 'tB', title: '高框', items: ['一', '二', '三', '四', '五'], cls: 'blue', group: 'gB' },
                { id: 'sB', label: '矮', cls: 'green', group: 'gB' },
            ],
            edges: [],
        },
        check(spec, geom, h) {
            const pair = (t, s) => {
                const T = h.node(t); const S = h.node(s); return { T, S }
            }
            const top = pair('tT', 'sT'); const cen = pair('tC', 'sC'); const bot = pair('tB', 'sB')
            const okTop = top.T && top.S && Math.abs(top.S.y - top.T.y) <= 3
            const okCen = cen.T && cen.S && Math.abs((cen.S.y + cen.S.h / 2) - (cen.T.y + cen.T.h / 2)) <= 4
            const okBot = bot.T && bot.S && Math.abs((bot.S.y + bot.S.h) - (bot.T.y + bot.T.h)) <= 3
            return [
                { name: 'top: 矮框頂端對齊', pass: okTop, detail: top.T && top.S && `Δtop=${(top.S.y - top.T.y).toFixed(1)}` },
                { name: 'center: 矮框置中對齊', pass: okCen, detail: cen.T && cen.S && `Δmid=${((cen.S.y + cen.S.h / 2) - (cen.T.y + cen.T.h / 2)).toFixed(1)}` },
                { name: 'bottom: 矮框底端對齊', pass: okBot, detail: bot.T && bot.S && `Δbot=${((bot.S.y + bot.S.h) - (bot.T.y + bot.T.h)).toFixed(1)}` },
            ]
        },
    },

    // 10) 水平佈局 dir:LR(含一個包覆容器)
    {
        name: 'lr-flat',
        desc: '水平佈局 — dir:LR + 包覆容器',
        data: {
            dir: 'LR',
            nodes: [
                { id: 'A', label: '入口', cls: 'blue' },
                { id: 'GP', label: '處理群組', cls: 'greenG' },
                { id: 'B', label: '處理一', cls: 'green', group: 'GP' },
                { id: 'C', label: '處理二', cls: 'green', group: 'GP' },
                { id: 'D', label: '出口', cls: 'orange' },
            ],
            edges: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'D' }],
        },
    },

    // 11) 循環退回邊(hasCycle 路徑: cycleBreaking MODEL_ORDER, 根層不加位置提示; 入口節點應仍在頂端)
    {
        name: 'cycle',
        desc: '循環 — 決策退回邊 (cycleBreaking)',
        data: {
            dir: 'TB',
            nodes: [
                { id: 'S', label: '開始', cls: 'blue' },
                { id: 'W', label: '處理', cls: 'green' },
                { id: 'D', label: '審核?', cls: 'diamond' },
                { id: 'E', label: '完成', cls: 'done' },
            ],
            edges: [
                { from: 'S', to: 'W' },
                { from: 'W', to: 'D' },
                { from: 'D', to: 'E', label: '通過' },
                { from: 'D', to: 'W', kind: 'dashed', label: '退回' },
            ],
        },
        check(spec, geom, h) {
            const S = h.node('S')
            const minY = Math.min(...geom.nodes.map(n => n.y))
            return [
                { name: '入口節點居頂(不因循環偏移)', pass: !!S && S.y <= minY + 2, detail: S && `S.y=${S.y} minY=${minY}` },
            ]
        },
    },

    // 12) 三層巢狀容器 + 由最深葉節點連出至頂層節點(LCA=root 之跨三層邊)
    {
        name: 'deep-nest',
        desc: '深巢狀 — 三層容器 + 跨三層邊',
        data: {
            dir: 'TB',
            nodes: [
                { id: 'L1', label: '第一層', cls: 'blueG' },
                { id: 'L2', label: '第二層', cls: 'greenG', group: 'L1' },
                { id: 'L3', label: '第三層', cls: 'orangeG', group: 'L2' },
                { id: 'deep', label: '最深節點', cls: 'orange', group: 'L3' },
                { id: 'top', label: '頂層節點', cls: 'blue' },
            ],
            edges: [{ from: 'deep', to: 'top', label: '跨三層' }],
        },
        check(spec, geom, h) {
            const L1 = h.group('L1'); const L2 = h.group('L2'); const L3 = h.group('L3')
            return [
                { name: '容器深度 0/1/2', pass: !!L1 && !!L2 && !!L3 && L1.depth === 0 && L2.depth === 1 && L3.depth === 2, detail: `L1=${L1 && L1.depth} L2=${L2 && L2.depth} L3=${L3 && L3.depth}` },
            ]
        },
    },

    // 13) 英文數據(半形括號/斜線之衍生 label 情境 + 長英文識別字折行不攔腰斷)
    {
        name: 'english',
        desc: '英文 — 半形標籤 + items 富節點 + 長識別字',
        data: {
            dir: 'TB',
            nodes: [
                { id: 'api', label: 'API Gateway', cls: 'blue' },
                { id: 'svc', title: 'Auth Service', items: ['login/logout', 'token refresh (JWT)', 'session mgmt'], cls: 'green' },
                { id: 'cfg', label: 'InternationalizationConfigurationManager', cls: 'orange' },
            ],
            edges: [{ from: 'api', to: 'svc', label: 'HTTPS' }, { from: 'svc', to: 'cfg', kind: 'dashed' }],
        },
        check(spec, geom, h) {
            const svc = h.node('svc')
            return [
                { name: 'svc 為 items 框', pass: !!svc && svc.kind === 'items' && svc.headH > 0, detail: svc && `kind=${svc.kind} headH=${svc.headH}` },
            ]
        },
    },

    // 14) 長中文標籤折行(measure maxW=200 → 框寬受限, 不無限撐寬)
    {
        name: 'long-label',
        desc: '長標籤 — 超長中文自動折行, 框寬受 MAXW 限制',
        data: {
            dir: 'TB',
            nodes: [
                { id: 'L', label: '這是一段非常非常長的節點標籤文字用於驗證自動折行機制與框寬上限行為', cls: 'purple' },
                { id: 'B', label: '下游', cls: 'blue' },
            ],
            edges: [{ from: 'L', to: 'B' }],
        },
        check(spec, geom, h) {
            const L = h.node('L')
            return [
                { name: '框寬受 MAXW 限制(≤230)', pass: !!L && L.w <= 230, detail: L && `w=${L.w}` },
                { name: '折行後高於單行(≥2行)', pass: !!L && L.h >= 50, detail: L && `h=${L.h}` },
            ]
        },
    },

    // 15) 無邊圖(純節點+容器; 邊相關機制全跳過仍須正確佈局)
    {
        name: 'no-edges',
        desc: '無邊 — 純節點與容器, 無任何連線',
        data: {
            dir: 'TB',
            nodes: [
                { id: 'G', label: '群組', cls: 'greenG' },
                { id: 'a', label: '甲', cls: 'green', group: 'G' },
                { id: 'b', label: '乙', cls: 'green', group: 'G' },
                { id: 'solo', label: '獨立節點', cls: 'blue' },
            ],
            edges: [],
        },
    },

    // 16) 群組對群組邊 + 葉節點對群組邊(端點為複合容器之階層邊)
    {
        name: 'group-edge',
        desc: '群組邊 — 群組↔群組 / 葉節點↔群組',
        data: {
            dir: 'TB',
            nodes: [
                { id: 'G1', label: '來源群組', cls: 'blueG' },
                { id: 'x', label: 'x', cls: 'blue', group: 'G1' },
                { id: 'G2', label: '目標群組', cls: 'orangeG' },
                { id: 'y', label: 'y', cls: 'orange', group: 'G2' },
                { id: 'ext', label: '外部節點', cls: 'green' },
            ],
            edges: [
                { from: 'G1', to: 'G2', label: '群組相依' },
                { from: 'ext', to: 'G2', kind: 'dashed' },
            ],
        },
    },

]
