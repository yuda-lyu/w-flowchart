// p3 — nomnoml 產線 adapter(資料驅動)
//   genPng(data): 正規化繪圖數據 → 轉 nomnoml DSL → 碰撞偵測自動調 spacing → 截圖回傳 PNG Buffer
//   版面通用化: direction 取自數據 dir; spacing 由碰撞偵測迴圈自動決定; 無逐圖魔術數字。
//
//   nomnoml 1.2.0 兩項硬限制(經實測 + 源碼 classifier regex `<([a-z]*)>` 確認), 決定本套轉譯策略:
//   (1) classifier 名只接受純小寫字母 [a-z]+: 含大寫/數字(如 blueG、greenG2)會比對失敗,
//       整段 <...> 被當「字面標籤文字」渲染 → 標題外洩 <orangeG> 之類內部標記。
//       對策: 以 clsAlias() 把每個 cls 映射成「純小寫字母」且彼此唯一之別名(G→g, 2→b),
//       樣式照常套用、classifier 名不顯示。
//   (2) 節點識別子 = 標籤文字本身(無 id= 屬性), 且「巢狀容器內子節點」無法被外部邊參照——
//       以 [容器 | 子] 巢狀宣告後, 再以 [子] 當邊端點會「新建一份重複節點」而非連到既有子節點,
//       造成同內容畫兩份/斷裂(原 bug)。nomnoml 無 compound graph,此為庫本身限制。
//       對策: 全部節點一律「頂層平鋪宣告」(不用巢狀), 群組歸屬改以「容器→成員」虛線關聯邊表達
//       (比照 p10/vis 對相同限制之作法; 成員與容器共用色相已表群組), 邊端點皆以「既有節點之確切標籤」
//       參照 → 單一連通圖、零重複節點。
import { chromium } from 'playwright'
import { PALETTE, EDGE } from '../common/palette.mjs'
import { pkgScript } from '../common/pkg.mjs'

// nomnoml(與其相依 graphre)由本機 node_modules 內聯注入(取代 CDN nomnoml.web.js, 斷網環境可用)
//   nomnoml UMD 依賴全域 graphre, 故 graphre 先載
const GRAPHRE_JS = pkgScript('graphre/dist/graphre.js')
const NOMNOML_JS = pkgScript('nomnoml/dist/nomnoml.js')

// cls → nomnoml classifier 別名(純小寫字母 [a-z]+, 否則 nomnoml 視為字面文字而外洩)
//   逐字映射保唯一: 大寫 G → 'g'、數字 2 → 'b'(其餘非 [a-z] 字元一律 → 'g'),
//   故 blueG→blueg、blueG2→bluegb、greenG2→greengb… 彼此不碰撞。
function clsAlias(cls) {
    return String(cls).toLowerCase().replace(/[^a-z]/g, c => (c === '2' ? 'b' : 'g'))
}

// cls → nomnoml 樣式指令行(以小寫別名宣告; 群組 cls 也加入, 供容器節點著色)
// diamond 用 nomnoml 內建 <choice>, 不需自訂樣式
function buildClsDirectives() {
    const lines = []
    for (const [cls, p] of Object.entries(PALETTE)) {
        if (cls === 'diamond') continue // <choice> 內建, 不加自訂
        lines.push(`#.${clsAlias(cls)}: fill=${p.fill} stroke=${p.stroke}`)
    }
    return lines.join('\n')
}

// 取 nomnoml 節點分類器 token：diamond → '<choice>'(內建菱形), 其餘 → '<小寫別名>'
function classifier(cls) {
    if (cls === 'diamond') return '<choice>'
    return `<${clsAlias(cls)}>`
}

// 把正規化數據轉成 nomnoml DSL 字串
// 策略(因應 nomnoml 無 compound graph、節點以標籤為識別子):
//   1. 所有節點一律頂層平鋪宣告 [<別名>標籤](不用巢狀, 避免重複節點 bug)
//   2. 群組歸屬: 由 group 欄位合成「容器→成員」虛線關聯邊(無資料邊標籤)
//   3. 數據明列之邊: 端點以「節點確切標籤」參照, 依 kind 選 -> 或 -->, 帶 label 時插在箭頭前
//   → 全圖單一連通圖、零重複節點、無 classifier 名外洩
function translate(data) {
    const dir = data.dir === 'LR' ? 'right' : 'down'
    const clsDirs = buildClsDirectives()

    // 字型全覆蓋(全域修正): nomnoml 對「每個 <text>」內聯輸出 CSS `font:` 簡寫(預設 Helvetica),
    //   會壓過 body 的 font-family → 節點/邊標籤/<choice>/容器標題全落 Helvetica(中文僅靠瀏覽器後備)。
    //   唯一從庫層強制統一之機制是 `#font:` directive(getConfig 讀 d.font, 套進每個 text 的 font 簡寫)。
    //   值須為「裸族名」(directive 以 ':' 切, 值原樣插入 `font:<值>, Helvetica, sans-serif`),
    //   故傳 'Microsoft JhengHei'(不帶引號/逗號, 否則破壞 CSS 簡寫)。經實測各類文字 computed 皆含此字型。

    // id → node
    const byId = {}
    for (const nd of data.nodes) byId[nd.id] = nd

    // label 內 \n 強制換行 → nomnoml 節點文字以 ; 斷行(節點宣告與邊參照須同轉換才對得上);
    //   邊標籤不支援多行 → 降級為空格(避免字面換行使版面錯亂)
    const nl = (s) => String(s).replace(/\n/g, ';')
    const nlSp = (s) => String(s).replace(/\n/g, ' ')

    // 所有節點頂層平鋪宣告; 菱形(choice)之多行內文會超出斜邊被裁 → \n 降級為空格(單行加寬菱形)
    const nodeLabel = (nd) => nd.cls === 'diamond' ? nlSp(nd.label) : nl(nd.label)
    const nodeDsls = data.nodes.map(nd => `[${classifier(nd.cls)}${nodeLabel(nd)}]`).join('\n')

    // 群組歸屬邊: 容器(group 所指節點) → 成員, 虛線無箭頭語意以外之標籤
    //   nomnoml 無容器框, 比照 p10/vis 以關聯邊表達歸屬, 讓排版把成員擺在容器旁
    const assocDsls = data.nodes
        .filter(nd => nd.group && byId[nd.group])
        .map(nd => `[${nodeLabel(byId[nd.group])}] --> [${nodeLabel(nd)}]`)
        .join('\n')

    // 數據明列之邊: 端點以既有節點之確切標籤參照(不新建節點; 轉換須與節點宣告一致才對得上)
    const edgeDsls = data.edges.map(ed => {
        const fromRef = byId[ed.from] ? nodeLabel(byId[ed.from]) : nl(ed.from)
        const toRef = byId[ed.to] ? nodeLabel(byId[ed.to]) : nl(ed.to)
        const arrow = ed.kind === 'dashed' ? '-->' : '->'
        const edgeLabel = ed.label ? ` ${nlSp(ed.label)} ` : ' '
        return `[${fromRef}]${edgeLabel}${arrow} [${toRef}]`
    }).join('\n')

    return `#direction: ${dir}
#font: Microsoft JhengHei
${clsDirs}
${nodeDsls}
${assocDsls}
${edgeDsls}`
}

// setup：renderAndDetect(src) 渲染後量所有文字 bbox、偵測重疊(>2px)、回傳碰撞數
//   並對「邊標籤文字」(無 data-name 之 <text>, 即非節點內標籤)做兩件事:
//   (A) 白色光暈/描邊: paint-order:stroke + stroke=#ffffff stroke-width≈3.5——
//       背景框本就透明(nomnoml 不畫邊標籤白底), 故只需加描邊使線段透出、文字仍清晰。
//   (B) z-order 提層(原則2): nomnoml SVG 之 DOM 順序為「邊標籤 → 邊線 → 節點 rect/text」,
//       邊標籤排在節點 rect 之前 → 緊湊間距下若幾何重疊, 後畫的節點填色會「蓋住」邊標籤。
//       對策不加大間距, 而以繪製順序解: 將每個邊標籤 <text> append 至 svg 尾端(最後繪製)，
//       使其永遠疊在容器填色/節點 rect 之上, 任何文字皆不被區塊遮住。
const setup = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<script>${GRAPHRE_JS}</script>
<script>${NOMNOML_JS}</script>
</head><body style="margin:0;background:#fff;font-family:'Microsoft JhengHei',sans-serif">
<div id="box" style="display:inline-block;padding:20px"></div>
<script>
var HALO_COLOR = ${JSON.stringify(EDGE.haloColor)}, HALO_W = ${EDGE.haloWidth}
function applyEdgeLabelHalo(box){
  // 邊標籤 = <text> 無 data-name(節點內標籤皆帶 data-name)。
  var svg = box.querySelector('svg')
  var ts = Array.prototype.slice.call(box.querySelectorAll('svg text'))
  ts.forEach(function(t){
    if (t.hasAttribute('data-name')) return            // 節點標籤, 不處理
    // (A) 白描邊 + paint-order:stroke 使描邊在字下方
    t.setAttribute('paint-order','stroke')
    t.setAttribute('stroke', HALO_COLOR)
    t.setAttribute('stroke-width', HALO_W)
    t.setAttribute('stroke-linejoin','round')
    // (B) z-order: 移至 svg 尾端 → 最後繪製, 永不被節點 rect/容器填色蓋住
    svg.appendChild(t)
  })
}
window.renderAndDetect = function(src){
  try {
    var svg = window.nomnoml.renderSvg(src)
    var box = document.getElementById('box'); box.innerHTML = svg
    applyEdgeLabelHalo(box)
    var texts = Array.prototype.slice.call(box.querySelectorAll('svg text'))
    var R = texts.map(function(t){ return t.getBoundingClientRect() })
    // 只計「節點×節點」文字重疊驅動間距(原則2/3): 節點標籤帶 data-name; 邊標籤無 data-name。
    //   凡牽涉邊標籤之重疊(邊標籤×節點 / 邊標籤×邊標籤)一律「不算碰撞」——其可讀性已由
    //   halo(白描邊)+ z-order(提至最上層)保證, 不該用「加大間距」處理(否則 進度回報×Worker Thread
    //   這類邊標籤壓節點之 bbox 重疊會把圖撐爆)。唯有節點本體互疊才是 z-order 無法解、須間距處理者。
    var isNode = texts.map(function(t){ return t.hasAttribute('data-name') })
    var col = 0, details = []
    for (var i=0;i<R.length;i++) for (var j=i+1;j<R.length;j++){
      if (!(isNode[i] && isNode[j])) continue          // 任一方為邊標籤 → 交給 halo+z-order, 不驅動間距
      var a=R[i], b=R[j]
      var ix = Math.min(a.right,b.right)-Math.max(a.left,b.left)
      var iy = Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)
      if (ix>2 && iy>2){ col++; if(details.length<3) details.push(((texts[i].textContent||'').trim().slice(0,6))+'×'+((texts[j].textContent||'').trim().slice(0,6))) }
    }
    return { ok:true, collisions: col, details: details }
  } catch(e){ return { ok:false, err:(e&&(e.message||e.stack))||String(e) } }
}
window.__ready = true
</script></body></html>`

// 自動調間距：由小到大掃描 #spacing，取「第一個達到零碰撞」的最小間距；都無法歸零則取碰撞最少者
//   原則3(封頂緊湊): sweep 上限封在 85, 移除舊有 115/150——後者會把圖撐爆(後端服務組成圖原掃到
//   spacing=150 → 1946x2396)。改用緊湊上限後, 若 85 仍殘留少量重疊, 寧可保持緊湊留下該重疊
//   (代表本套不適合此圖, 由挑選階段換套), 絕不灌大間距讓圖爆大、字變小。
async function autofix(page, src) {
    const sweep = [40, 60, 85]
    let best = null
    for (const s of sweep) {
        const r = await page.evaluate((x) => window.renderAndDetect(x), '#spacing: ' + s + '\n' + src)
        if (!r.ok) return { ok: false, err: String(r.err).split('\n')[0] }
        if (best === null || r.collisions < best.collisions) best = { spacing: s, collisions: r.collisions, details: r.details }
        if (r.collisions === 0) { best = { spacing: s, collisions: 0, details: [] }; break }
    }
    return { ok: true, ...best }
}

// 單張渲染: 供其他模組 import 呼叫。輸入單份正規化繪圖數據(結構同 FIGURES[n].data,
//   caller 已先做 label 衍生), 內部自建 browser/page(避免與批次流程共用 state), 沿用批次流程
//   同一套 deviceScaleFactor、等待邏輯、碰撞偵測自動調 spacing, 回傳 PNG 之 Node Buffer(不落地檔案)。
async function renderFigPage(data) {
    const browser = await chromium.launch()
    try {
        const page = await browser.newPage({ deviceScaleFactor: 2 })
        await page.setContent(setup, { waitUntil: 'load' })
        await page.waitForFunction(() => window.__ready, { timeout: 60000 }).catch(() => {})
        const src = translate(data)
        const fx = await autofix(page, src)
        if (!fx.ok) throw new Error(fx.err)
        // 以最佳間距重繪
        await page.evaluate((x) => window.renderAndDetect(x), '#spacing: ' + fx.spacing + '\n' + src)
        await page.evaluate(() => document.fonts && document.fonts.ready)
        await page.waitForTimeout(180)
        return { browser, page }
    }
    catch (err) {
        await browser.close()
        throw err
    }
}

// 單張渲染 → PNG Buffer
export async function genPng(data, opt = {}) {
    const { browser, page } = await renderFigPage(data)
    try {
        return await page.locator('#box svg').screenshot()
    } finally {
        await browser.close()
    }
}

// 單張渲染 → SVG 字串(#box 內後處理完成之 SVG; &nbsp; 正規化為 &#160; 使其為合法 standalone SVG)
export async function genSvg(data, opt = {}) {
    const { browser, page } = await renderFigPage(data)
    try {
        return (await page.evaluate(() => document.getElementById('box').innerHTML)).replace(/&nbsp;/g, '&#160;').trim()
    } finally {
        await browser.close()
    }
}
