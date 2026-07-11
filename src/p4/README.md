# p4 — Cytoscape.js + dagre 產線

## 技術核心

- **繪圖庫**：Cytoscape.js（`cytoscape/dist/cytoscape.min.js`）搭配 dagre 排版引擎（`dagre/dist/dagre.min.js`）與橋接外掛（`cytoscape-dagre/dist/cytoscape-dagre.js`），三者由本機 `node_modules` 讀出後內聯注入頁面 `<script>`（`common/pkg.mjs` 的 `pkgScript()`），非透過 CDN，斷網環境亦可渲染。
- **渲染環境**：由 Playwright `chromium.launch()` 開啟無頭瀏覽器，`page.setContent()` 注入含三段內聯 script 的靜態 HTML，頁面掛載一個 `1400×1400px` 的 `<div id="cy">` 作為 Cytoscape 容器。
- **截圖與匯出**：排版完成後呼叫 `cy.png({ full:true, scale:2, bg:'#ffffff', output:'base64' })` 取得 base64 字串，存入全域變數 `window.__png`，再由 `page.evaluate()` 讀回 Node 端，以 `Buffer.from(b64, 'base64')` 轉為 PNG Buffer 回傳。`full:true` 使輸出範圍自動裁切至實際元素範圍，`scale:2` 使最終 PNG 解析度為實際佈局尺寸的 2 倍；`deviceScaleFactor` 設為 `1`（由 `browser.newPage({ deviceScaleFactor:1 })` 指定），縮放完全由 `cy.png` 的 `scale:2` 控制。
- **呼叫方式**：`genPng(data, opt)` 為單張渲染函式，接受正規化繪圖數據 `{ dir, nodes, edges }`，內部自建 browser/page 並於結束時關閉，回傳 PNG 的 Node Buffer（不落地檔案），由 `src/WFlowchart.mjs` 統一調用（`mode: 'p4'`）；同結構之 `genSvg(data, opt)` 經 `cytoscape-svg` 外掛將同一份佈局/樣式匯出為 SVG 字串（canvas 引擎重繪為 SVG，經像素級忠實度驗證）。

## 產製原理（資料驅動）

### translate(data) — `toEls(data)`

`toEls(data)` 將標準數據轉成 Cytoscape elements 陣列：

- **節點**：每個 `node` 轉成 `{ data: { id, label, parent }, classes }` 元素。
  - `parent` 直接取自 `nd.group`；若 `nd.group` 為 falsy（無所屬群組），`parent` 為 `undefined`，Cytoscape 視為根節點。
  - `classes` 直接取自 `nd.cls`（如 `green`、`diamond`、`blueG` 等），用於後續 style selector 指派顏色與形狀。
- **邊**：每條 `edge` 轉成 `{ data: { source, target, label }, classes }` 元素。
  - `ed.kind === 'dashed'` 時 `classes` 設為 `'dashed'`，否則為 `undefined`，套用虛線樣式。

### 節點上色與形狀

樣式由行內 JSON style 陣列定義，與 `common/palette.mjs` 語意對應：

| cls | 形狀 | 填色 / 框色 |
|---|---|---|
| （預設 / blue） | round-rectangle | `#eef4fb` / `#3f6fb0` |
| `green` | round-rectangle | `#eaf4ef` / `#348a5c` |
| `orange` | round-rectangle | `#fcf0e2` / `#c46e1a` |
| `purple` | round-rectangle | `#f4f0fa` / `#8163ad` |
| `red` | round-rectangle | `#fbecea` / `#c0392b` |
| `done` | round-rectangle | `#eaf4ef` / `#256046`（文字同色） |
| `diamond` | diamond | `#fcf0e2` / `#c46e1a`，`padding:34px`，`text-max-width:120px` |
| `blueG` / `blueG2` | 群組容器 | 較淺藍色系，標題文字藍色 |
| `greenG` / `greenG2` | 群組容器 | 較淺綠色系，標題文字綠色 |
| `orangeG` | 群組容器 | 較淺橘色系，標題文字橘色 |
| `purpleG` | 群組容器 | 較淺紫色系，標題文字紫色 |

### 群組容器

Cytoscape 原生支援 compound node（巢狀節點）。`:parent` selector（凡帶有子節點的節點皆命中）套用群組容器樣式（`text-valign:top`、`background-opacity:0.35`、`border-width:2`、`padding:16px`，標題名置頂），再由 `blueG`／`greenG`／`orangeG`／`purpleG` 等 cls selector 疊加各群組色相。子節點在 `data.parent` 欄位帶入群組節點的 `id` 即可自動歸屬，**無需額外處理**，巢狀亦可多層。

### 邊與虛線

所有邊使用 bezier 曲線（`curve-style:bezier`）；文字標籤背景透明（`text-background-opacity:0`，不使用不透明白底），可讀性改以白色描邊光暈達成（`text-outline-color:#ffffff`、`text-outline-width:3`）。`classes:'dashed'` 的邊由 `edge.dashed` selector 套用 `line-style:dashed`。

### 流向（dir）

`data.dir`（如 `'TB'`、`'LR'`）直接作為 dagre layout 的 `rankDir` 參數，由呼叫端傳入的數據決定排版方向，產線本身不硬寫任何方向值。

## 自動化機制

### 版面通用推算

dagre layout 使用三個通用常數，**不因圖而異**：

- `nodeSep: 42`——同 rank 內節點水平間距（px）
- `rankSep: 55`——相鄰 rank 垂直間距（px）
- `edgeSep: 18`——同 rank 邊的間距（px）

節點本身的寬高由 Cytoscape 的 `width:"label"` / `height:"label"` 機制自動依文字量決定，輔以 `padding:"10px"` 與 `text-max-width:"360px"` 限制，無需逐圖指定固定尺寸。

### 自動裁切至元素範圍

`cy.png({ full:true, ... })` 使輸出 PNG 自動裁切到所有元素的 bounding box，不輸出容器 `<div>` 的空白留白。

### 排版穩定等待

`l.promiseOn('layoutstop')` 確保 dagre 排版完成後才執行截圖；排版事件後再 `setTimeout(..., 250)` 給予 250ms 讓瀏覽器完成渲染，避免字型/邊標尚未繪製完即截圖。

### 頁面字型就緒

在呼叫 `renderFig` 前執行 `document.fonts.ready`，確保 Microsoft JhengHei 等中文字型載入完成，避免字型回退造成尺寸偏差。

## 已知限制 / 回退

- **線性鏈拉長**：節點數少、邊為單鏈時，dagre 會將所有節點排成一列，圖形縱向（TB）或橫向（LR）被拉長，留白偏多。
- **同標籤平行邊重疊**：兩節點間有多條方向相同的邊（`from`/`to` 相同）時，bezier 路徑幾乎重疊，標籤互蓋，難以區分。
- **diamond 節點在群組容器內偏大**：`diamond` cls 固定使用 `padding:34px` 以撐開菱形可視範圍，在小型群組容器內可能撐爆容器邊界。
- **跨容器邊路由**：Cytoscape compound node 下，跨群組的邊由 dagre 自動路由，部分情況下路由線會穿越容器框線，視覺上不夠乾淨，但功能正確。
- **無碰撞偵測迴圈**：版面為單次 dagre 計算，若節點數量極多、標籤極長，可能出現節點標籤截斷（超出 `text-max-width:360px`）或節點互疊，無自動調整機制。
- **本機套件相依**：cytoscape／dagre／cytoscape-dagre 由本機 `node_modules` 讀出內聯注入，需先完成 `npm install`；執行環境本身不需連網。
</content>
