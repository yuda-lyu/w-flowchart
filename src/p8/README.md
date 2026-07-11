# p8 — LogicFlow + dagre 產線

## 技術核心

- **繪圖庫**：`@logicflow/core`（含 CSS）搭配 `dagre`，由 `common/pkg.mjs` 讀取本機檔案內聯注入 Playwright 頁內（取代 CDN，斷網環境可用）：`pkgText('@logicflow/core/dist/index.css')` 內聯進 `<style>`，`pkgScript('@logicflow/core/dist/index.min.js')` 與 `pkgScript('dagre/dist/dagre.min.js')` 各自內聯進 `<script>`。
- **載入方式**：Node 端以 Playwright 建立 Chromium 頁面，將完整 HTML 字串（含內聯 CSS 與兩段內聯 `<script>`）透過 `page.setContent()` 注入；繪圖邏輯全部在頁內 `<script>` 執行，Node 端僅負責驅動與截圖。
- **渲染與截圖**：頁內 `window.renderFig(fig)` 依序計算尺寸 → dagre 排版 → `lf.render()` 渲染完後以 `setTimeout(..., 200)` 等待 DOM 穩定，回傳 Promise；Node 端再呼叫 `page.evaluate(() => document.fonts.ready)` 確保字型載入完畢，最後以 `page.locator('#app').screenshot()` 截取 `#app` 元素為 PNG Buffer 回傳（不寫檔）。
- **解析度**：`browser.newPage({ deviceScaleFactor: 2 })`，輸出為 2× 實體像素密度（HiDPI），寬高由計算所得邏輯像素乘以 2 輸出。
- **調用方式**：本模組匯出 `genPng(data, opt) → Promise<Buffer>` 與 `genSvg(data, opt) → Promise<string>`，輸入皆為正規化繪圖數據 `{ dir, nodes, edges }`；`genSvg` 序列化圖面 svg（`lf-canvas-overlay`），並將 LogicFlow CSS 內嵌進 SVG（文字自動換行之 `foreignObject` 標籤樣式依賴此 CSS）；由 `src/WFlowchart.mjs` 統一匯入並依 `p8` 鍵值調用，本身不寫檔、不涉及批次流程。

## 產製原理（資料驅動）

### translate(data) 轉換

`translate(data)` 把標準數據轉成 `{ rankDir, els }` 結構：

- **節點**：每個 `nodes[]` 項目轉為 `{ id, label, cls, parent }`，`cls` 預設為 `'blue'`，`parent` 對應 `nd.group`（群組歸屬）。
- **邊**：每個 `edges[]` 項目轉為 `{ source, target, label, dashed }`，`dashed` 由 `ed.kind === 'dashed'` 決定。
- **方向**：`data.dir` 直接映射為 dagre `rankdir`（`'TB'` 或 `'LR'`）。

### 節點上色與形狀

- 所有 `cls` 由 `PAL`（`PALETTE` 展平成 `{ fill, stroke, text }` 的 Map）查色；查無則回退 `PAL.blue`。
- `cls === 'diamond'` → 渲染為 `cDiamond`（DiamondNode 衍生類別，用 `rx/ry` 控制菱形尺寸）。
- 其餘 → 渲染為 `cRect`（RectNode 衍生類別，圓角半徑 `radius=7`）。

### 群組容器

- **偵測**：掃描所有節點的 `parent` 欄位，被引用為 parent 的 id 即為群組容器（`groupIds` Map）。
- **巢狀**：子群組的 `parent` 若也是群組，dagre 會以 `g.setParent(childGid, parentGid)` 建立巢狀 compound 結構。
- **渲染**：群組容器以 dagre cluster bbox 取出 `x/y/width/height`，轉為 `cRect` 節點並設 `isGroup:true`，由 `getNodeStyle()` 套用 `fillOpacity=0.45` 半透明淺底；標題文字固定置頂（`y: group.y - group.h/2 + GROUP_TITLE/2 + 4`，`GROUP_TITLE=26`）；群組節點先行加入 `graphNodes`（置底），普通節點疊在其上。

### 邊與虛線

- 實線邊 → 自訂型別 `cLine`（`PolylineEdgeModel` 衍生，`stroke=EDGE.line`，`strokeWidth=1.8`）。
- 虛線邊（`dashed:true`）→ 自訂型別 `cDash`（`strokeDasharray='6 4'`，`stroke='#7a8690'`）。
- 邊文字（`edgeText()`）：背景設為 `EDGE.textBg`（透明，`fill:'transparent', stroke:'none'`），不遮轉折線；文字改以白色描邊（`stroke=EDGE.haloColor`、`strokeWidth=EDGE.haloWidth=3.5`、`paintOrder='stroke'`）形成光暈維持清晰（全域修正 A）。

### 跨容器邊的標籤座標處理

端點含群組容器的邊無法直接喂給 dagre（dagre compound 不允許 cluster 當邊端點），處理分兩步：

1. **dagre 排序邊**：以 `repLeaf(gid)`（取群組的第一個 leaf 子節點）建立隱形排序邊，僅用於 dagre 決定群組相對位置，不顯示。
2. **標籤位置計算（`labelPos`）**：
   - 一端在群組內、一端在外（跨界邊）：以 `LABEL_BIAS=0.62` 權重將標籤偏向群組框邊，遠離外部節點避免壓字；`LR` 方向對齊目標節點 y，`TB` 方向對齊目標節點 x，以分散 hub 節點多條邊的標籤。
   - 兩端均在外/均在內但中點落在某群組 box 內：把標籤移至該 box 左外側（`box.x - box.w/2 - LABEL_GAP`，`LABEL_GAP=28`）。
   - 中點不在任何 box 內：交由 LogicFlow 預設位置。

## 自動化機制

### 版面通用推算（零逐圖魔術數字）

節點尺寸與畫布大小完全由數據推算，所有常數為與圖內容無關的全域預設：

| 常數 | 值 | 用途 |
|---|---|---|
| `FONT_SIZE` | 14 | 節點字級（px） |
| `LINE_H` | 22 | 行高（px） |
| `NODE_MAXW` / `DIAMOND_MAXW` | 230 / 110 | 換行觸發寬度（px） |
| `PAD_X` / `PAD_Y` | 28 / 22 | 矩形內距 |
| `DIA_PAD_X` / `DIA_PAD_Y` | 60 / 46 | 菱形內距（對角需較大留白） |
| `NODE_MINW` / `NODE_MINH` | 120 / 56 | 矩形最小尺寸 |
| `DIA_MINW` / `DIA_MINH` | 150 / 110 | 菱形最小尺寸 |
| `NODE_SEP` | 36 | dagre 同層節點間距 |
| `RANK_SEP_TB` / `RANK_SEP_LR` | 55 / 82 | dagre 層距（LR 因水平標籤需較大） |
| `MARGIN` | 20 | dagre 邊距 |
| `CANVAS_MARGIN` | 60 | 畫布外緣留白 |
| `GROUP_TITLE` | 26 | 群組標題列高 |
| `LABEL_GAP` / `LABEL_BIAS` | 28 / 0.62 | 跨界邊標籤間隙 / 偏容器側權重 |

### 節點尺寸量測（`sizeOf` + `wrap` + `measure`）

1. `measure(text, font)`：以隱藏 `<canvas>` 的 `2d` context 量測實際字元像素寬度。
2. `wrap(label, maxW, font)`：逐字元（`Array.from` 支援中文多位元組）斷行，超過 `maxW` 時換行。
3. `sizeOf(label, isDiamond)`：取最寬一行加內距（`padX*2`），行數乘行高加內距（`padY*2`），套最小尺寸下限，傳回 `{ w, h, text }`（`text` 為以 `\n` 連接的斷行後字串）。

### 畫布自動裁切貼邊

所有節點（含群組容器）的 `x±w/2`、`y±h/2` 求 `minX/minY/maxX/maxY` 後，畫布寬高為 `ceil(maxX-minX+CANVAS_MARGIN*2) × ceil(maxY-minY+CANVAS_MARGIN*2)`，再動態設定 `#app` 的 `width/height` style，對 `#app` 截圖即為貼邊結果。

### `rankDir` 自動映射

`data.dir` 由各圖數據本身決定（`'TB'` 或 `'LR'`），`translate()` 直接傳入 dagre `rankdir`；`RANK_SEP` 也依 `fig.rankDir === 'LR'` 自動選用對應常數，無需逐圖設定。

## 已知限制 / 回退

- **長線性鏈**：線性鏈（節點逐一串接無分支）dagre 會拉長單一 rank，節點間距不受 `NODE_SEP` 調節，可能導致圖面過窄或過寬。
- **同標籤平行邊重疊**：同一對節點若有多條邊（如同時有實線與虛線），LogicFlow polyline 不自動偏移，標籤會重疊，需數據層避免。
- **群組容器無法當 dagre 邊端點**：端點為群組的邊以 `repLeaf` 代替 leaf 建立隱形排序邊，LeafNode 選第一個子節點，排版順序可能與預期略有差異。
- **邊路徑為折線（polyline）**：所有邊強制使用 `polyline` 型別，對複雜拓樸可能出現折角路徑而非平滑曲線；LogicFlow 無內建曲線自動路由。
- **群組 bbox 精度依賴 dagre compound**：dagre compound cluster 的 bbox 計算在子節點很少時可能偏大，容器框視覺上顯得空曠。
- **字型量測依賴 Canvas API**：`measure()` 使用 Chromium headless 的 `<canvas>` 2d context，在 headless 環境下字型 fallback 可能影響寬度量測，導致換行點與實際渲染略有差異。
