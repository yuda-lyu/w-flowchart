# p6 — AntV G6 v5 (antv-dagre) 產線

## 技術核心

- **繪圖庫**：`@antv/g6@5`，改由 jsDelivr CDN 載入（免安裝），於 Playwright 頁面內以外部 `<script src>` 標籤（`cdnScript('g6')`，版本鎖定於 `src/common/cdn.mjs`）載入執行，渲染時需連網存取 CDN。`@antv/g6` 已從套件 `dependencies` 移除，Node 執行期亦不以 `import` 方式使用它，僅頁面內 `<script>` 取用其全域 `G6`。
- **渲染方式**：以 `chromium.launch()` 開啟無頭瀏覽器，`page.setContent(html)` 載入內嵌 G6 頁面，於頁面內呼叫 `window.renderFig()`，以 `G6.Graph` + `layout: { type:'antv-dagre' }` 完成排版與渲染。
- **截圖／輸出**：呼叫 `graph.toDataURL({ mode:'overall' })` 取得整圖 DataURL（非 viewport 截圖），透過 `window.snap()` 取回後在 Node 端解 base64，組成 `Buffer` 回傳（不寫檔）。
- **解析度**：`browser.newPage({ deviceScaleFactor: 2 })`，輸出為 2× 實體像素解析度的 PNG。
- **介面**：`genPng(data, opt)` 為單張渲染函式，由 `src/WFlowchart.mjs` 統一調用；`data` 為正規化繪圖數據 `{ dir, nodes, edges }`（caller 已完成 label 衍生）。每次呼叫皆逐次 `chromium.launch()`，並在 `finally` 呼叫 `browser.close()`，不跨圖共用頁面；同結構之 `genSvg(data, opt)` 換用 `@antv/g-lite` + `@antv/g-svg` 之官方 renderer API 以 SVG renderer 重繪（序列化前將相機 transform 歸零），與 `genPng` 共用同一套 `translate`/排版/樣式邏輯，經忠實度驗證。

## 產製原理(資料驅動)

`translate(data)` 將標準正規化數據轉換為 G6 v5 輸入格式 `{ nodes, combos, edges }`：

### 三大核心品質原則（全庫設定層落實，非逐圖補）

- **原則 1．字型全覆蓋**：node / edge / combo 三層 `graph` 預設與各元素 `style` 皆設 `labelFontFamily = FONT`（Microsoft JhengHei），任一層漏設仍由 graph 預設兜底，確保節點、邊標籤、容器標題全部使用同一字型。
- **原則 2．z-order 解遮蓋**：combo（半透明填色）`zIndex` 墊底（`COMBO_Z = -10`），節點居中（沿用預設 zIndex），邊與邊標籤畫最上層（`EDGE_Z = 100`）；即使非成員節點幾何落入容器框，其不透明節點本體與最上層邊標籤皆不被容器填色染淡或遮住。
- **原則 3．緊湊不撐大**：不做「碰撞偵測 sweep 放大間距 until 零碰撞」，改採固定緊湊間距（`NODESEP` / `RANKSEP`）維持報告可用的緊湊尺寸；若緊湊間距下仍有節點互疊且非 z-order 可解，則保持緊湊留下重疊（代表此套版型不適合此圖，由挑選階段換別套）。

### 節點 → nodes / combos

- **群組容器**：`cls` 結尾為 `G` 或 `G2`（由 `isGroupCls()` 判別）的節點轉為 G6 `combos`，類型固定為 `'rect'`，`combo` 欄位設為父容器 id（支援巢狀容器，如 DET in CORE、FES in FE）。填色取 `colorOf(nd.cls).fill`，`fillOpacity: 0.3`，標籤置頂（`labelPlacement: 'top'`），`labelFontFamily` 設為 `FONT`（原則1）。`style.zIndex` 設為 `COMBO_Z`（原則2，墊最底）。
- **一般節點**：其餘節點轉為 G6 `nodes`。`palette.mjs` 中 `shape === 'diamond'`（即 `cls: 'diamond'`）的節點類型為 `'diamond'`，其餘為 `'rect'`（圓角 `radius: 6`）。`combo` 欄位設為 `nd.group`（所屬容器 id）。節點本體不透明（`fillOpacity` 預設 1），不特別設定 `zIndex`（沿用預設，居於 combo 之上）。
- **節點尺寸**：由 `measure(label)` 通用公式推算，不逐圖手填：
  - 寬：各行字符逐字累加（CJK 含 `（）／` 每字 15.5 px，英數/符號每字 8.5 px），取最長行 + 左右內距 34 px。
  - 高：行數 × 26 px + 上下內距 20 px。
  - 菱形節點額外追加寬 60 px（`DIAMOND_KW`）、高 50 px（`DIAMOND_KH`）以容納斜邊空間。

### 邊 → edges

- 全部邊類型為 `'polyline'`（頁面端全域預設），`endArrow: true`，線寬 2.2，`style.zIndex` 設為 `EDGE_Z`（原則2，畫最上層，不被容器填色或任何節點區塊遮住）。
- `kind === 'dashed'` 的邊：`lineDash: [7, 5]`，顏色改為 `colorOf('orange').stroke`（橘色虛線）；否則使用 `EDGE.line`。
- 邊標籤背景框透明（`labelBackground: false`，不遮轉折線），改以白色光暈描邊呈現：`labelStroke: EDGE.haloColor`、`labelLineWidth: EDGE.haloWidth`、`labelPaintOrder: 'stroke'`（paint-order:stroke 使白邊畫在文字之後，形成光暈，在線段上仍清晰可讀），`labelAutoRotate: false`。
- **跨容器邊處理**：G6 v5 不接受以 combo id 作為邊端點，`translate` 建立 `kpRepByCombo` 映射（各容器第一個直屬葉節點為代表），透過 `resolveEnd()` 將指向容器 id 的邊端點改接其代表成員，無需逐圖手寫成員 id。

### 排版方向 (dir)

`rankdir` 直接取自 `data.dir`（由 caller 傳入的正規化繪圖數據決定，如 `'TB'`、`'LR'`），傳入 `antv-dagre` layout，產線不寫死方向。

### 回傳值

`genPng(data, opt)` 回傳 PNG Buffer（不寫檔），落地或其他後續用途由呼叫端（`src/WFlowchart.mjs`）決定。

## 自動化機制

### 版面通用推算(零逐圖魔術數字)

所有排版參數皆為全圖共用常數，取代舊版逐圖手調：

| 常數 | 值 | 說明 |
|---|---|---|
| `CANVAS` | 2200 | 大畫布尺寸，配合 `autoFit:'view'` 自動縮放，所有圖共用同一畫布 |
| `NODESEP` | 28 | 同層節點間距(緊湊；取代舊版碰撞偵測 sweep 22→86 之逐次放大間距) |
| `RANKSEP` | 60 | 層距(緊湊；取代舊版碰撞偵測 sweep 48→190 之逐次放大間距) |
| `COMBO_Z` | -10 | 容器填色 zIndex，墊最底(原則2) |
| `EDGE_Z` | 100 | 邊與邊標籤 zIndex，畫最上層(原則2) |
| `CJK_W` | 15.5 | CJK 字元估寬(px/字) |
| `ASCII_W` | 8.5 | 英數符號估寬(px/字) |
| `LINE_H` | 26 | 每行高度(px) |
| `PAD_W` | 34 | 矩形左右內距總和(px) |
| `PAD_H` | 20 | 矩形上下內距總和(px) |
| `DIAMOND_KW` | 60 | 菱形額外追加寬(px) |
| `DIAMOND_KH` | 50 | 菱形額外追加高(px) |

### 自動縮放

G6.Graph 設定 `autoFit: 'view'`，所有圖統一在 2200×2200 px 畫布上自動縮放貼合，不需逐圖設定 `width`/`height`。

### 自動排版

排版交由 `antv-dagre` 處理，設 `sortByCombo: true`（有 combos 時），確保同群組節點聚合排列，不需手動設定節點座標。

### 容器代表節點自動推算

`kpRepByCombo` 映射於 `translate` 中動態建立，取各容器第一個直屬葉節點為代表，`resolveEnd()` 統一修正邊端點，是舊版「層級邊改走成員節點(fe1→if1)」手法的通用化。

### 字體就緒等待

`page.evaluate(() => document.fonts && document.fonts.ready)` 確保字型載入完畢再渲染，避免中文字型未套用導致量測與實際渲染不符。`renderFig` 內 `graph.render()` 完成後另等 300 ms(`setTimeout(r, 300)`)，`snap` 擷圖前再等 200 ms(`setTimeout(r, 200)`)，合計約 500 ms 確保 G6 完整繪製後才截圖。

## 已知限制 / 回退

- **線性鏈拉長**：節點數少、以單向鏈串接的圖（如簡單流程圖），`antv-dagre` 易將鏈路水平或垂直拉得過長，視覺上留白偏多。
- **同標籤平行邊重疊**：兩節點間若有多條邊（同方向），`polyline` 路由可能重疊，邊標籤難以區分。
- **容器代表節點限制**：跨容器邊只接到容器的第一個直屬葉節點（代表節點），若語意上應接到其他成員節點，目前需改動數據層或在 `translate` 中另設優先順序。
- **無碰撞偵測**：節點尺寸由字串估算，非實際渲染量測；CJK 與英數混排的標籤若含大量短 ASCII，估寬可能略偏窄，極端情況文字溢出節點框。
