# p2 — mermaid@11 + ELK 產線

## 技術核心

- **繪圖庫**：mermaid 第 11 版系列（package.json 以 npm alias `mermaid11` 安裝，與 p1 之第 10 版系列並存）+ `@mermaid-js/layout-elk`。兩者皆為 chunk 式 ESM（無 UMD 版可內聯注入），改以虛擬 origin `https://pkg.local/` 供應本機 `node_modules` 檔案：`routeLocalPkgs()` 對該 page 掛 `page.route(PKG_ORIGIN + '**', ...)`，攔截後以 `fs.readFileSync(pkgFile(rel))` 讀本機檔案回應（含相對 chunk import，因同 origin 而一併被攔截解析），頁內腳本以 `await import('https://pkg.local/mermaid11/dist/mermaid.esm.min.mjs')` 等路徑動態載入；不經 CDN，斷網環境亦可運作。
- **ELK 排版引擎**：啟動前呼叫 `mermaid.registerLayoutLoaders(elk)`，再於 frontmatter（`FM` 常數）中指定 `layout: elk`，使所有圖改由 ELK 演算法自動計算節點/邊位置，取代 mermaid 原生 Dagre。**實測事實**：舊版以 CDN `+esm` 載入 `@mermaid-js/layout-elk` 時，`registerLayoutLoaders` 會靜默失效並悄悄退回 dagre 版面（無錯誤訊息）；改為現行本機 ESM chunk 載入後，才確實套用 ELK 排版。
- **渲染方式**：透過 `mermaid.render('g'+idx, code)` 在頁內取得 SVG 字串，注入 `#box` div，再呼叫 `page.locator('#box svg').screenshot()` 對 SVG 元素精確截圖，回傳 PNG Buffer（不落地寫檔）。
- **解析度**：`browser.newPage({ deviceScaleFactor: 2 })` 讓截圖以 2× 像素密度渲染，輸出圖像像素尺寸為 SVG 邏輯尺寸的兩倍。
- **SVG 尺寸固定**：`renderFig` 內先讀 `viewBox.baseVal` 取 `w`/`h`，若取不到則 fallback 至 `svgEl.getBBox()`，再以 `setAttribute('width', Math.ceil(w))` / `setAttribute('height', Math.ceil(h))` 鎖定尺寸，防止截圖留白。
- **字型**：頁面 body 及 mermaid `themeVariables.fontFamily` 均設為微軟正黑體（`'微軟正黑體','Microsoft JhengHei',sans-serif`），截圖前等待 `document.fonts.ready` 確保字型載入完成。

## 產製原理（資料驅動）

所有邏輯集中於 `translate(data)` 函式，將標準正規化數據轉為 mermaid flowchart DSL 字串。

### 流向（dir）

- 取 `data.dir`，預設 `'TB'`（Top-to-Bottom）。
- `innerDir`（子群組內部方向）= 補方向：`dir === 'TB'` → `innerDir = 'LR'`；`dir === 'LR'` → `innerDir = 'TB'`。

### 節點形狀

- `cls === 'diamond'` → 菱形語法 `{label}`（決策節點）。
- 其餘所有 cls → 方形圓角語法 `["label"]`。

### 群組容器（subgraph）

- 判斷依據：`isGroupCls(nd.cls)`，即 cls 以 `G` 或 `G2` 結尾（如 `blueG`、`greenG2`）。
- 群組容器輸出為 `subgraph nodeId["label"]` + `direction innerDir` + 遞迴子節點 + `end`。
- 群組成員關係由 `nd.group` 欄位指向父群組 id；無 `group` 屬性的節點為頂層節點，遞迴入口為 `topNodes`。
- 嵌套群組：子群組本身若 `isGroupCls`，繼續遞迴展開為內層 `subgraph`，縮排隨遞迴深度加倍（每層 2 個空格）。

### 邊與虛線

- `ed.kind === 'dashed'` → 虛線箭頭 `-.->` ；否則實線箭頭 `-->`。
- 有 `ed.label` → 插入 `|"label"|` 於箭頭中。
- 跨容器邊（from/to 分屬不同 subgraph）直接在 edges 區輸出，mermaid + ELK 自行處理跨界路由，不需額外標記。

### 顏色（classDef）

- 遍歷所有節點的 `cls`，從 `common/palette.mjs` 的 `PALETTE` 取 `fill`、`stroke`、`text`；查無對應 cls 則 fallback 至 `PALETTE.blue`。
- 輸出 `classDef <cls> fill:...,stroke:...,stroke-width:1.5px,color:...;`，再輸出 `class <id1,id2,...> <cls>;` 將同 cls 節點合併至同一 class 行。
- 群組容器的 `stroke-width` 與一般節點同為 `1.5px`（程式碼中 `isGroupCls` 分支現值相同）。

### 視覺後處理（setup 頁內腳本）

渲染後對 DOM 套用強制覆寫：
- 所有 `.edgePaths path`、`path.flowchart-link` 等邊線：`stroke: #333333; stroke-width: 3px`（`!important`）。
- 所有 `marker path`（箭頭）：`fill: #333333; stroke: #333333`。
- 節點 rect/polygon/circle/path：`stroke-width: 2px`。
- cluster（subgraph 框）rect/polygon/path：`stroke: #777; stroke-width: 1.5px`。

### 對外介面

- 產線唯一輸出入口為 `genPng(data, opt)`，`data` 為正規化繪圖數據 `{ dir, nodes, edges }`，回傳 `Promise<Buffer>`（PNG）；`genPng` 自帶瀏覽器生命週期（`chromium.launch()` → 渲染 → `browser.close()`），呼叫端不需自行管理 Playwright。
- 統一由 `src/WFlowchart.mjs` 依 `mode === 'p2'` 呼叫，不提供批次流程或落地寫檔行為，是否寫檔、寫至何處由呼叫端決定。

## 自動化機制

### 零魔術數字

p2 產線完全依賴 ELK 演算法自動排版，不手動指定任何節點座標、層距、畫布尺寸。版面計算由 ELK 根據圖結構（節點數、邊數、巢狀群組深度、`dir`/`innerDir`）自行決定。

### 畫布自適應

`renderFig` 在渲染後讀取實際 SVG 尺寸（`viewBox` → `getBBox` fallback），以 `Math.ceil` 取整後寫回 `width`/`height` attribute，使截圖框恰好貼合圖形，不留多餘白邊。

### 單張渲染

`genPng` 每次呼叫各自 `chromium.launch()` 一個新瀏覽器、開一個新 `page`，呼叫 `window.renderFig(code, 0)` 完成單張渲染後，等待 250 ms（`page.waitForTimeout(250)`）確保 SVG 穩定再截圖，最後關閉瀏覽器；多張圖需由呼叫端（如 `WFlowchart.mjs`）逐張呼叫 `genPng`。

### 方向自動取補

`innerDir` 由 `dir` 自動取補（無需逐圖手調），確保子群組在視覺上與父層流向正交，整體排列更清晰。

### 色票統一

classDef 由 `PALETTE` 查表生成，所有產線（pN）共用同一套色票，保證跨產線視覺一致；新增 cls 只需在 palette.mjs 新增一項，產線無需改動。

## 已知限制 / 回退

- **線性鏈可能被橫向拉長**：ELK 對純線性長鏈（無分支、無群組）在 `TB` 方向有時會將節點散佈過寬，標籤換行不受控。
- **subgraph 邊框樣式有限**：mermaid subgraph 邊框不支援 dashed，群組容器視覺區分度依賴填色深淺，複雜巢狀時邊框層次較難辨別。
- **同標籤平行邊重疊**：mermaid + ELK 對同一 from→to 存在多條邊（不同 label）時，邊路徑可能重疊，label 互相遮蔽。
- **跨容器邊路由**：ELK 對穿越多層 subgraph 的邊，有時路由繞行路徑較長，視覺上不夠直觀。
- **無碰撞偵測迴圈**：p2 不含自訂碰撞偵測或間距迭代，全部交給 ELK；若 ELK 版本升級改變排版策略，輸出版面可能有差異。
- **setup 失敗處理**：mermaid/ELK 模組載入或初始化若拋錯，setup 頁內腳本以 `try/catch` 設 `window.__setupErr`，`genPng` 讀到後 `throw new Error(setupErr)` 中止該次渲染。
