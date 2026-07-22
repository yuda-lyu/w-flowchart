# p9 — React Flow + dagre 產線

## 技術核心

- **繪圖庫**：`@xyflow/react@12`（React Flow）搭配 `@dagrejs/dagre@1` 自動排版引擎。
- **載入方式**：`react`、`react-dom`、`@xyflow/react`、`@dagrejs/dagre` 之 UMD 版本與 `@xyflow/react` 樣式表，改由 jsDelivr CDN 載入（免安裝，版本鎖定於 `src/common/cdn.mjs`）：`page9.html` 內以佔位符 `/*__XYFLOW_CSS__*/`、`/*__REACT_JS__*/`、`/*__REACT_DOM_JS__*/`、`/*__XYFLOW_JS__*/`、`/*__DAGRE_JS__*/` 預留插入點，`gen.mjs` 讀入該檔全文後以 `common/cdn.mjs` 的 `cdnScript`/`cdnStyle` 將各佔位標籤整段換成對應之外部 `<script src>`/`<link>` 標籤，`replace` 用函式形式回傳以避免庫碼內 `$` 序列被誤當替換樣板；渲染時需連網存取 CDN。`@xyflow/react` UMD 之外部依賴含全域 `jsxRuntime`（React 18 UMD 未提供），`page9.html` 內建等價 shim（以 `React.createElement` 實作 `jsx`/`jsxs`/`Fragment`）補上。
- **渲染流程**：`genPng(data, opt)` 每次呼叫皆啟動一個新的 `chromium` browser 與 page（`finally` 內關閉），以 `page.setContent(html)` 注入內聯好各繪圖庫的 `page9.html` 全文（`html` 於模組載入時讀取並完成佔位符替換一次，跨呼叫重用字串），等待 `document.title === 'READY'` 確認 React 與 dagre 啟動完成後，呼叫 `page.evaluate(s => window.renderFig(s), spec)`（`spec` 為 `translate(data)` 之輸出）觸發單張渲染，渲染函式內 `setTimeout 900ms` 後 resolve，確保 React commit 完成。
- **截圖目標**：對 `#shot` 元素截圖（`page.locator('#shot').screenshot()`）；`#shot` 為 `display:inline-block` 的 div，內含 `#stage`（React Flow 掛載點），外加 `padding:24px` 白邊，截出的 PNG 即為完整含留白之圖片。
- **解析度**：`browser.newPage({ deviceScaleFactor: 2 })` 開啟 2x 縮放，所有量測與佈局座標仍以 CSS px 計算，截出的 PNG 實際像素為畫布尺寸之 2 倍，確保中文字型清晰。
- **字型**：`Microsoft JhengHei, sans-serif`，中文主字型一致貫穿節點、標籤、邊標籤。
- **呼叫入口**：`export async function genPng(data, opt = {})` 為唯一對外介面，回傳 `Promise<Buffer>`（PNG）；由 `src/WFlowchart.mjs` 之 `GENS.p9` 統一調用（`mode: 'p9'`）。`data` 為正規化繪圖數據 `{ dir, nodes, edges }`；`opt` 保留擴充，目前原樣接收但未使用。**不支援 SVG 輸出**（本產線節點為 React Flow 之 HTML div，非純 SVG，無法序列化為 standalone SVG）。

## 產製原理（資料驅動）

### translate(data) 轉換流程

`gen.mjs` 的 `translate(data)` 將標準數據格式轉為 `page9.html` 的 `renderFig spec`：

1. **節點對映**：遍歷 `data.nodes`，每個節點輸出 `{ id, label, kind }`。
   - `kind` 直接取自 `n.cls`（cls 即為色票 key，如 `blue`、`diamond`、`blueG`）。
   - 若節點有 `n.group`，則輸出 `parent: n.group`，作為 dagre compound 的子→容器歸屬。
   - 標籤**不預折**，原樣傳入 `label`；折行完全交由 `page9.html` 的 `measure`/`Label` 以 `max-width` + `overflow-wrap:break-word` 於量測與渲染 div 內自然斷行（中文於字間斷行、英數 token 於空白/標點斷，不會攔腰斷字）。
   - 群組容器（`kind` 結尾為 `G`/`G2`）由 `page9.html` 內 `layoutDagreCompound` 之 `isGrp = n => /G2?$/.test(n.kind || '')` 判斷，非於 `translate()` 階段標記。

2. **邊對映**：遍歷 `data.edges`，輸出 `{ s: e.from, t: e.to }`。
   - 若有 `e.label` 則附帶 `l: e.label`。
   - 若 `e.kind === 'dashed'` 則附帶 `dashed: true`，頁內渲染為橘色虛線（`strokeDasharray: '6 4'`，顏色 `#c46e1a`），否則為深灰實線（`#44505a`）。

3. **方向對映**：`layout: 'dagrec'` 固定使用 compound dagre 佈局；`rankDir: data.dir || 'TB'` 將數據的 `dir` 欄位直接映射為 dagre 的 `rankdir`（如 `LR` 為左→右，`TB` 為上→下）。

4. **節點形狀**：
   - `kind === 'diamond'`：渲染為 `DiamondNode`，以旋轉 45° 的 div 實作菱形外框，填色 `#fcf0e2`、框色 `#c46e1a`，尺寸由對角線方框計算（見自動化機制）。
   - `kind` 結尾為 `G` 或 `G2`：渲染為 `GroupNode`（type `grp`），淡底色加粗框，標題置頂。
   - 其餘：渲染為 `BoxNode`（type `box`），圓角矩形，顏色取自 `COL[kind] || COL.blue`。

5. **群組容器（巢狀）**：群組本身在 dagre compound graph 中以 `g.setParent(childId, parentId)` 建立歸屬，支援巢狀（容器亦可有 `parent`）；群組尺寸不需手動指定，由 dagre cluster 自動推算子節點排版後的邊界框。

6. **跨容器邊（邊端點為容器）**：dagre compound 不允許對容器節點直接連邊（ranking 階段會崩），故排版用「代表葉節點」替代容器端點（取該容器第一個直接葉子後代，存入 `repLeaf` 表），實際繪線仍以容器的絕對 box 邊界計算 handle 位置（`pickHandles`）。此為通用處理，非逐圖特例。

## 自動化機制

### 標籤尺寸量測（sizeOf + measure）

頁內以隱形 `#meas` 容器實際渲染文字後取 `getBoundingClientRect()`，得到以瀏覽器實際字型為準的像素尺寸：

- 矩形節點：`measure(label, fontSize=14, padX=18, padY=12, maxW=320)`，回傳 `{w, h}`（各加 2px 安全邊距）。
- 菱形節點：取量測結果之 `max(w, h) + 56`，正方形展開為對角線方框（使文字置中於菱形中心）。
- 群組容器：不在此量測（由 dagre cluster 自動撐開）。

### 版面通用推算常數

| 常數 / 公式 | 值 | 說明 |
|---|---|---|
| `nodesep` | 46 px | 同 rank 節點橫向間距（dagre 預設值） |
| `ranksep` | 62 px | 跨 rank 層距（dagre 預設值） |
| `marginx / marginy` | 12 px | 圖形邊緣留白 |
| 標題列高度 `titleBand` | `round(fontSize * 1.4) + 12` | 群組置頂標題區高度，依字級通用推算 |
| 畫布尺寸 | `ceil(gg.width) + 48` / `ceil(gg.height) + 48` | dagre 佈局結果加 48 px 緩衝 |
| 折行寬度 `maxW` | 320 px（矩形節點）/ 160 px（菱形節點） | `measure()` 的 `max-width`，由 CSS `overflow-wrap:break-word` 自然折行，非字元數門檻 |

### 畫布尺寸自動推算

`layoutDagreCompound` 在 `dagre.layout(g)` 完成後，從 `g.graph().width / height` 取得佈局實際占用尺寸，加 48 px 緩衝後動態設定 `#stage` 的 `width / height`，再以 `fitView: true`（`padding: 0.04`）讓 React Flow 自動縮放填滿容器。無任何逐圖手寫 W/H 常數。

### 群組容器頂部擴張

dagre 給出群組的中心座標與尺寸後，佈局後自動向上擴張一個 `titleBand` 高度（`y -= band; h += band`），確保置頂標題列不壓蓋第一列子節點，且此擴張量以字級通用計算而非逐圖手調。

### 自動 handle 選取（pickHandles）

邊繪製前，以兩端節點絕對 box 中心的相對位置（`dx`、`dy`），自動判斷應從哪側 handle 出入：`|dx| >= |dy|` 時走左右（`l`/`r`），否則走上下（`t`/`b`）。每個節點（BoxNode、DiamondNode、GroupNode）四邊各有一組 source + target handle（共 8 個，`opacity:0` 隱藏），確保任意方向的連邊都能正確接合。

### 由逐圖手調「一般化」而來的原則

此產線以 `layout: 'dagrec'`（compound dagre）取代舊版 `figs9.json` 中的逐圖座標，一般化的核心原則如下：

- **節點尺寸不再手寫**：舊版以固定寬高常數，新版以 `sizeOf` 實際量測字型像素，標籤換行前後尺寸自動跟隨。
- **群組尺寸不再手寫**：舊版逐圖指定容器 w/h，新版以 dagre cluster 由子節點自動撐開。
- **座標不再手寫**：所有 x/y 由 dagre 排版引擎輸出，`rankDir` 取自數據 `dir` 欄位。
- **跨容器邊不再指定 handle**：`pickHandles` 依幾何自動計算，舊版需逐邊指定 `sh/th`。

## 已知限制 / 回退

- **線性鏈被拉長**：dagre 對長直鏈（如流程圖無分支）會在 `ranksep` 作用下縱向拉伸，層距固定不因鏈長自動縮短，適合節點多且有分支的關係圖，純序列流程圖建議改用 `layoutDagre`（非 compound）或調整 `ranksep`。
- **同標籤平行邊視覺重疊**：React Flow `default` 邊類型不自動分叉，同一對節點若有多條邊（不同 label）會重疊繪製，僅最後一條可見。
- **邊標籤定位不精確**：React Flow 邊標籤自動置於邊中點，對長距或折線路徑可能覆蓋其他節點或標籤。
- **無碰撞偵測**：dagre 以 rank/layer 排版，不保證節點間絕對不重疊（特別是跨 rank 的長邊標籤），若出現遮擋需調整 `nodesep`/`ranksep`。
- **群組代表葉節點選取**：跨容器邊的 ranking 代理節點取「第一個葉子後代」，若該葉子在容器內位置偏，可能影響 dagre 的 rank 分配導致邊繞路，此為設計限制非 bug。
- **無自動裁切貼邊**：`#shot` 截圖範圍固定為 `#stage` 外加 24 px padding，若個別圖實際內容較小，PNG 會有較多空白邊；若內容超出 stage 則被裁切（`fitView` 會縮放但 stage 尺寸已固定）。
- **React 渲染非同步延遲**：`renderFig` 以 `setTimeout(900ms)` 等待 React commit，若圖形節點數量極多（>200）或字型載入較慢，900ms 可能不足，截圖會取到未完成畫面。
