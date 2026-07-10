# p1 — mermaid@10 dagre 產線

## 技術核心

- **繪圖庫**: mermaid 第 10 版系列（package.json 以 npm alias `mermaid10` 安裝，與 p2 之第 11 版系列並存），透過 `common/pkg.mjs` 的 `pkgScript('mermaid10/dist/mermaid.min.js')` 讀取本機 `node_modules` 內容並內聯注入 `<script>` 標籤，於 Playwright 開啟的 Chromium 頁面內執行；不經 CDN，斷網環境亦可運作。
- **渲染方式**: `genFig()` 為每張圖建立獨立的 Playwright `page`（`browser.newPage()`），避免 mermaid 內部 render id 衝突。將 `mermaidHtml()` 產生的 HTML 字串以 `page.setContent()` 注入，等待 `document.title === 'DONE'` 確認渲染完成（或 `FAIL` 時拋出錯誤），再以 `page.waitForFunction` 超時 30 秒防呆。
- **截圖目標**: `page.locator('#box svg').screenshot()`，只截 SVG 元素本身，不含外層 `div#box` 的 padding 背景。
- **解析度**: `deviceScaleFactor: 4`，Chromium 以 4 倍畫素密度渲染 SVG 向量圖，輸出 PNG 清晰度極高，適合印刷品質報告。
- **字型**: HTML `<body>` 及 mermaid `themeVariables.fontFamily` 均指定 `'微軟正黑體','Microsoft JhengHei',sans-serif`；截圖前以 `page.evaluate(() => document.fonts.ready)` 確保字型載入完成。

## 產製原理（資料驅動）

`translate(data)` 將標準數據的 `{ dir, nodes, edges }` 轉為 mermaid flowchart DSL 字串，流程如下：

### 節點形狀與色票

- `cls === 'diamond'` → `id{"label"}`（菱形決策節點）
- 其他所有 cls → `id["label"]`（矩形方框）
- 色票由 `PALETTE[cls] || PALETTE.blue` 取得，每個出現過的 cls 各產生一行 `classDef`：
  - 群組容器（`isGroupCls` 判斷，即 cls 結尾為 `G` 或 `G2`）：`stroke-width:1.8px`
  - diamond：`stroke-width:1.6px`
  - 其他一般節點：`stroke-width:1.5px`
- 最終以 `class id1,id2,... cls` 批次指派，每個 cls 一行。

### 群組容器（subgraph）與巢狀

- `isGroupCls(nd.cls)` 為 `true` 的節點視為群組容器，輸出為 `subgraph id["label"]`。
- 拓樸分析：
  - **頂層容器**：自身 `group` 欄位為空（無父容器）的容器。
  - **巢狀容器**：自身有 `group` 欄位（屬於某父容器）的容器，遞迴嵌入父容器 subgraph 內。
  - **獨立節點**：`!isGroupCls` 且無 `group` 欄位，直接輸出在 flowchart 頂層。
- `renderSubgraph(gid, indent)` 遞迴處理，支援二層巢狀（例如 DET 群組在 CORE 群組內）。

### 邊與虛線

- `ed.kind === 'dashed'` → `-..->`（虛線箭頭）
- 其他 → `-->`（實線箭頭）
- 有 `ed.label` 時插入 `|"label"|` 語法。
- 跨容器邊（from/to 分屬不同 subgraph）直接以一般 edge 語法處理，mermaid dagre 自行解決跨容器連線路由。

### 流向（dir）

- `data.dir` 直接對應 mermaid `flowchart <dir>`，例如 `TB`（上到下）或 `LR`（左到右），無任何轉換。

### 對外介面

- 產線唯一輸出入口為 `genPng(data, opt)`，`data` 為正規化繪圖數據 `{ dir, nodes, edges }`，回傳 `Promise<Buffer>`（PNG）；`genPng` 自帶瀏覽器生命週期（`chromium.launch()` → 渲染 → `browser.close()`），呼叫端不需自行管理 Playwright。
- 統一由 `src/WFlowchart.mjs` 依 `mode === 'p1'` 呼叫，不提供批次流程或落地寫檔行為，是否寫檔、寫至何處由呼叫端決定。

## 自動化機制

p1 的版面自動化完全委由 **mermaid dagre** 引擎處理，產線本身不計算任何節點座標、間距或畫布尺寸：

- **零逐圖魔術數字**：`translate()` 不依圖的節點數或標籤長度調整任何數值；所有佈局由 dagre 演算法依拓樸自動推算。
- **邊線樣式強制覆蓋**：mermaid `themeCSS` 設定 `.flowchart-link`、`.edgePaths .path` 的 stroke 為 `#44505a`、stroke-width `2.5px`、箭頭 fill/stroke `#44505a`，確保 theme:base 預設邊線色不干擾統一視覺。渲染完成後再以 `page.evaluate()` 對 DOM 補強一次 `!important` inline style（雙層覆蓋，防 mermaid 版本差異導致 themeCSS 失效）。
- **cluster（subgraph）框線**：DOM 後處理統一設 `.cluster rect` 等元素 stroke `#777777`、stroke-width `1.5px`。
- **獨立 page 防衝突**：每張圖開新 `page`，`mermaid.render('g', ...)` 的固定 id `g` 不會因先前渲染殘留而出錯。

## 已知限制 / 回退

- **線性鏈被拉長**：dagre 對長鏈節點（如單一主幹多節點）會垂直拉伸畫布，輸出圖比例偏高。
- **跨容器邊路由不可控**：mermaid 對跨 subgraph 的邊路由由 dagre 自動決定，邊可能繞行或重疊，無法手動指定路徑。
- **同標籤平行邊重疊**：若兩條邊 from/to 相同但 label 不同，mermaid 可能渲染為重疊線段，視覺難以區分。
- **subgraph 標題色不受 classDef 控制**：subgraph 標題文字顏色由 mermaid 主題決定，`classDef` 的 `color` 屬性僅影響節點內文字，容器標題需透過 `themeVariables` 或 CSS 覆蓋，現行產線未特別處理。
- **無自動裁切/縮放**：截圖對象為 `#box svg`，SVG 本身大小由 dagre 決定，若圖形極大則 PNG 尺寸亦大，無自動縮放至固定畫布。
