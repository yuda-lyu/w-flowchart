// p5 — D2(Node 端) 產線 adapter(資料驅動)
//   genPng(data): 正規化繪圖數據 → 轉 D2 DSL → @terrastruct/d2 算 SVG → sharp 轉 PNG Buffer
//   版面通用化: dir 取自數據; density 依 SVG viewBox 寬自動推算, 無逐圖魔術數字。
//
//   注意：本版 D2(0.1.33 / WASM v0.7.0) 傳入自訂 font buffer 會穩定回 "invalid JSON input"。
//   改為不傳字型編譯，渲染為 SVG 後注入 font-family 覆寫，交由 librsvg(sharp) 以系統「Microsoft JhengHei」實際描繪。
//   D2 v0.7 內建 CJK 全形寬度量測，box 寬即使長中文亦不溢出（已實測）。
import { D2 } from '@terrastruct/d2'
import sharp from 'sharp'
import { colorOf, isGroupCls } from '../common/palette.mjs'

// ── 字型注入 ────────────────────────────────────────────────────────────────
const FONT_FAMILY = `"Microsoft JhengHei","Microsoft YaHei",sans-serif`
const FONT_OVERRIDE = `<style>text,.text-bold,.text-italic,.text-underline,tspan{font-family:${FONT_FAMILY} !important;}.text-bold{font-weight:bold !important;}</style>`
function injectFont(svg) {
    // 全圖中文字型統一: 將 SVG 內所有 font-family 宣告(CSS rule 與屬性值)一律改成 Microsoft JhengHei。
    //   僅靠 text{} CSS 蓋不過 D2 對粗體/容器標題等所用 class(如 .text-bold)之字型(class 特異度較高),
    //   故直接覆寫所有 font-family 值, 再加 !important 覆寫保險。
    svg = svg.replace(/font-family\s*:\s*[^;}<]+/gi, `font-family:${FONT_FAMILY}`)
    svg = svg.replace(/font-family\s*=\s*"[^"]*"/gi, `font-family="${FONT_FAMILY}"`)
    const idx = svg.indexOf('<style')
    if (idx >= 0) return svg.slice(0, idx) + FONT_OVERRIDE + svg.slice(idx)
    const p = svg.indexOf('>')
    return svg.slice(0, p + 1) + FONT_OVERRIDE + svg.slice(p + 1)
}

// ── 邊標籤光暈注入(全域修正 A) ────────────────────────────────────────────────
// D2 對有標籤的邊會：
//   (1) 以 mask + fill="black" rect 遮斷連線讓背景白色透出（偽造白底效果）
//   (2) 在連線上方放 class="text-italic fill-N2" 的 <text> 元素
// 本函式同時處理兩件事：
//   A. 移除 <mask> 內 fill="black" 的 <rect>，讓連線完整穿過標籤區（無白色截斷）
//   B. 注入 CSS 為 .text-italic 加 paint-order:stroke + stroke:white + stroke-width:3.5px，
//      使文字帶白色光暈，在線段上仍清晰可讀
const EDGE_HALO_STYLE = `<style>.text-italic{paint-order:stroke;stroke:#ffffff;stroke-width:3.5px;}</style>`
function injectEdgeLabelHalo(svg) {
    // A. 移除 <mask>...</mask> 內的 fill="black" rect（線段遮罩孔洞）
    //    模式：<mask ...> 內含 <rect ... fill="black"></rect>，保留白色 rect（mask 基底）
    svg = svg.replace(/<mask\b([^>]*)>([\s\S]*?)<\/mask>/g, (maskBlock, attrs, inner) => {
        // 移除 fill="black" 的 rect（這些是標籤位置的遮罩孔洞）
        const cleaned = inner.replace(/<rect[^>]*fill="black"[^>]*><\/rect>/g, '')
        return `<mask${attrs}>${cleaned}</mask>`
    })
    // B. 在第一個 <style 之前注入光暈 CSS
    const idx = svg.indexOf('<style')
    if (idx >= 0) return svg.slice(0, idx) + EDGE_HALO_STYLE + svg.slice(idx)
    const p = svg.indexOf('>')
    return svg.slice(0, p + 1) + EDGE_HALO_STYLE + svg.slice(p + 1)
}

// ── D2 escape：$ 需轉義以避免 D2 變數展開 ───────────────────────────────────
const esc = (s) => String(s).replace(/\$/g, '\\$')

// ── D2 方向映射：標準數據 dir → D2 direction 關鍵字 ─────────────────────────
const DIR_MAP = { TB: 'down', LR: 'right', BT: 'up', RL: 'left' }

// ── 樣式區塊：依 cls 從 palette 取色，群組加 bold ─────────────────────────────
function styLines(cls, isGroup) {
    const c = colorOf(cls)
    const lines = []
    lines.push(`  style.fill: "${c.fill}"`)
    lines.push(`  style.stroke: "${c.stroke}"`)
    if (c.text && (isGroup || cls === 'done')) lines.push(`  style.font-color: "${c.text}"`)
    if (isGroup) lines.push(`  style.bold: true`)
    if (c.shape === 'diamond') lines.push(`  shape: diamond`)
    return lines
}

// ── 取節點在 D2 中的完整路徑(用於邊的 from/to 引用) ────────────────────────
// D2 巢狀容器中子節點須以 "父.子" 表示；遞迴向上追溯直到頂層。
function qualifiedId(nodeId, parentMap, qid) {
    const parts = []
    let cur = nodeId
    while (cur) {
        parts.unshift(cur)
        cur = parentMap[cur]
    }
    return parts.map(qid).join('.')
}

// ── 遞迴產生 D2 區塊：容器（群組）巢狀展開 ────────────────────────────────────
// childrenMap: parentId → [node, ...]
// parentMap: nodeId → parentId | undefined
function renderNode(nd, childrenMap, parentMap, dataDir, indent, qid) {
    const pad = ' '.repeat(indent)
    const isGroup = isGroupCls(nd.cls)
    const lines = []

    if (isGroup) {
        // 群組容器：開 block，在內部設 direction + style，再遞迴展開子節點
        lines.push(`${pad}${qid(nd.id)}: "${esc(nd.label)}" {`)
        // 若群組本身有子節點，為其設定方向（延用圖的頂層方向）
        const kids = childrenMap[nd.id] || []
        if (kids.length > 0) {
            lines.push(`${pad}  direction: ${DIR_MAP[dataDir] || 'down'}`)
        }
        for (const sl of styLines(nd.cls, true)) {
            lines.push(`${pad}${sl}`)
        }
        for (const kid of kids) {
            lines.push(renderNode(kid, childrenMap, parentMap, dataDir, indent + 2, qid))
        }
        lines.push(`${pad}}`)
    } else {
        // 一般節點（含 diamond）
        lines.push(`${pad}${qid(nd.id)}: "${esc(nd.label)}" {`)
        for (const sl of styLines(nd.cls, false)) {
            lines.push(`${pad}${sl}`)
        }
        lines.push(`${pad}}`)
    }

    return lines.join('\n')
}

// ── translate：標準數據 → D2 DSL 字串 ─────────────────────────────────────────
// 邊一律在頂層宣告，跨群組時用完整路徑（parent.child）讓 D2 正確解析。
function translate(data) {
    // D2 保留字(top/left/right/bottom/style/label/shape/near/width/height 等)不可作識別子 → id 一律加前綴消歧
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

    // 建立 parentMap（nodeId → parentId） 與 childrenMap（parentId → [node]）
    const parentMap = {}
    const childrenMap = {}
    for (const nd of data.nodes) {
        if (nd.group) {
            parentMap[nd.id] = nd.group
            if (!childrenMap[nd.group]) childrenMap[nd.group] = []
            childrenMap[nd.group].push(nd)
        }
    }

    // 找出頂層節點（無 group 的節點）
    const topNodes = data.nodes.filter(nd => !nd.group)

    const blocks = []

    // 全域方向
    blocks.push(`direction: ${DIR_MAP[data.dir] || 'down'}`)

    // 頂層節點（含群組容器）
    for (const nd of topNodes) {
        blocks.push(renderNode(nd, childrenMap, parentMap, data.dir, 0, qid))
    }

    // 邊：全部在頂層，跨層路徑用 qualifiedId 展開
    for (const ed of data.edges) {
        const src = qualifiedId(ed.from, parentMap, qid)
        const dst = qualifiedId(ed.to, parentMap, qid)
        let s = `${src} -> ${dst}`
        if (ed.label) s += `: "${esc(ed.label)}"`
        if (ed.kind === 'dashed') s += ` { style.stroke-dash: 4 }`
        blocks.push(s)
    }

    return blocks.join('\n\n')
}

// ── 渲染 ───────────────────────────────────────────────────────────────────
// pad=40 與 themeID=0 為通用常數，對所有 9 張圖一致；無逐圖數值。
const baseOpt = { layout: 'dagre', pad: 40, themeID: 0 }

// ── 單張渲染核心：正規化繪圖數據 → 後處理完成之 SVG 字串 ──────────────────────
// data 結構同 FIGURES[n].data（{ dir, nodes, edges }），caller 須先做 label 衍生。
// D2 建構時即起常駐 worker 且無公開關閉 API（worker 為 node worker_threads 實例），
// 若掛在模組層, 光 import 本檔就會令 caller 程序無法自然結束；故逐次建立並於 finally terminate。
async function d2Svg(data) {
    const d2inst = new D2()
    try {
        const d2src = translate(data)
        const res = await d2inst.compile({ fs: { index: d2src }, options: baseOpt })
        let svg = await d2inst.render(res.diagram, res.renderOptions)
        svg = injectEdgeLabelHalo(svg)
        svg = injectFont(svg)
        return svg
    }
    finally {
        await d2inst.ready.catch(() => {})
        if (d2inst.worker && d2inst.worker.terminate) await d2inst.worker.terminate()
    }
}

// ── 單張渲染 → PNG Buffer ────────────────────────────────────────────────────
export async function genPng(data, opt = {}) {
    const svg = await d2Svg(data)
    // density 通用公式：依 SVG viewBox 寬推算，讓輸出寬約落在 1600–2200px
    const m = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/)
    const w = m ? parseFloat(m[1]) : 1000
    const density = 96 * Math.min(2.4, Math.max(1.4, 1700 / w))
    return await sharp(Buffer.from(svg), { density }).png().toBuffer()
}

// ── 單張渲染 → SVG 字串（D2 引擎原生輸出 + 光暈/字型後處理） ───────────────────
export async function genSvg(data, opt = {}) {
    return await d2Svg(data)
}
