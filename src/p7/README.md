# p7 — JointJS + dagre 產線

## 技術核心

- **繪圖庫**：`@joint/core`（JointJS）搭配 `dagre`，改由 jsDelivr CDN 載入（免安裝），於 Playwright 頁內以外部 `<script src>` 標籤（`cdnScript('joint')`、`cdnScript('dagre')`，版本鎖定於 `src/common/cdn.mjs`）載入；渲染時需連網存取 CDN。
- **載入方式**：Node 端以 Playwright 的 `page.setContent(html)` 建立含兩段外部 `<script src>` 的完整 HTML 頁，等候 `window.__ready` 旗標確認兩套庫皆就緒後，再透過 `page.evaluate()` 驅動頁內 JavaScript 函式進行排版與渲染。
- **渲染方式**：排版完成後以 `P.fitToContent({ padding: 28, allowNewOrigin: 'any', useModelGeometry: true })` 讓 JointJS Paper 自適應內容邊界，截圖目標為 `#paper svg`（`page.$('#paper svg').screenshot()`），直接輸出 PNG。
- **解析度**：`browser.newPage({ deviceScaleFactor: 2 })` 以 2 倍像素密度開頁，截出的 PNG 實際像素為邏輯尺寸的兩倍，保有高清品質。
- **字型**：頁內使用 `Microsoft JhengHei`（微軟正黑體）作為主字型，canvas 量測與 JointJS 渲染均使用同一 `FONT` 字串，確保量測結果與渲染結果一致。
- **調用方式**：本模組匯出 `genPng(data, opt) → Promise<Buffer>` 與 `genSvg(data, opt) → Promise<string>`，輸入皆為正規化繪圖數據 `{ dir, nodes, edges }`；`genPng` 回傳 PNG 之 Node Buffer，`genSvg` 取 `#paper svg` 之 DOM 序列化結果並修正為 standalone SVG（補 `xmlns`、`width`/`height` 由 `100%` 改為 `fitToContent` 後之實際像素值、移除依賴容器定位之 `position:absolute;inset:0`）；由 `src/WFlowchart.mjs` 統一匯入並依 `p7` 鍵值調用，本身不寫檔、不涉及批次流程。

## 產製原理（資料驅動）

### translate(data) 轉換

`translate(data)` 將正規化數據轉為 JointJS 渲染外殼所需的 `els` 陣列與 `rankDir`：

- **節點映射**：每個 `node` 轉為 `{ id, label, cls, parent }`，其中 `node.group` 直接映射為 `parent`（群組歸屬）；`cls` 缺省時補 `'blue'`。
- **邊映射**：每個 `edge` 轉為 `{ source, target, label, cls }`，`from/to` 改名為 `source/target`；`kind === 'dashed'` 時 `cls` 設為 `'dashed'`，觸發後續虛線樣式；`label` 缺省補空字串。
- **流向映射**：`data.dir` 直接成為 dagre 的 `rankDir`（如 `'TB'`、`'LR'`），控制整體排列方向。

### CLS 色票推導

`CLS` 由 `common/palette.mjs` 的 `PALETTE` 在 Node 端靜態推導後序列化注入頁內：

- 所有 cls 均帶 `fill`、`stroke`、`color`（對應 PALETTE 的 `text`）。
- `PALETTE.shape === 'diamond'` 時加入 `shape: 'diamond'`，後續節點渲染選用 `joint.shapes.standard.Polygon`（`refPoints: '50,0 100,50 50,100 0,50'`）；否則使用 `joint.shapes.standard.Rectangle`（`rx/ry: 6`）。
- `PALETTE.group === true` 時加入 `group: true`，節點被識別為群組容器。

### 群組容器表達

- `groups`（`CLS[cls].group === true` 的節點）以 `joint.shapes.standard.Rectangle` 繪製外框，`fillOpacity: 0.5`、`rx/ry: 8`，標籤欄位留空。
- 群組標題另用獨立 `joint.shapes.standard.TextBlock` 置於容器左上角（`x+8, y+4`），文字為動態換行後的多行標題，字重為 `bold`，字色取 `CLS[cls].color`（群組色調的深色前景）。
- 群組標題元件最後 push 進 cells（置於最上層），確保標題不被節點遮蔽；群組矩形本體在 `graph.resetCells()` 後再呼叫 `cellById[gp.id].toBack()` 確保沉底。
- 支援巢狀群組：`layoutContainer` 遞迴排版，子群組先排內部再以整體尺寸參與外層 dagre。

### 邊與虛線

- 所有邊使用 `joint.shapes.standard.Link`，`stroke: '#44505a'`、`strokeWidth: 2.2`，`connector: 'rounded'`（`radius: 6`），箭頭為實心三角。
- `cls === 'dashed'` 時加 `strokeDasharray: '6,4'`。
- 有標籤的邊以自訂 markup（單一 `text` 元素，無背景框）顯示標籤；文字以白色描邊（`stroke: '#ffffff'`、`strokeWidth: 3.5`、`paintOrder: 'stroke'`）形成光暈，使底下轉折線能透出而文字仍清晰。標籤位置 `position.distance`：虛線邊固定 `0.32`（靠近來源端）；實線邊依端點是否落在群組內動態調整——進入群組（僅目標端在群組內）為 `0.26`（靠來源/群組外），離開群組（僅來源端在群組內）為 `0.74`（靠目標/群組外），其餘置中 `0.5`，避免標籤疊入群組內節點。

### 跨容器邊處理

兩段式 layout 採用 `liftTo(nodeId, containerId)` 函式，將邊端點往上抬升至指定容器的直接子節點，使 dagre 排版能正確決定群組之間的相對 rank，同時用 `seen` 集合去除因多條邊被抬升至同一對容器而產生的重複邊，避免 dagre compound 對「群組為邊端點」的 rank bug。

## 自動化機制

### 兩段式 layout 流程

1. **第一段 `layoutContainer('__root')`（由葉到根遞迴）**：對每一容器（`__root` 或具名群組）以 dagre 排版其直接子節點，得到子節點在容器內容區的相對偏移 `innerPos[childId + '@' + containerId]`，同時計算容器所需內容尺寸。群組尺寸包含兩側內距 `GPAD = 16`、動態計算的標題列高度 `titleH`。
2. **第二段 `place('__root', 0, 0)`（由根到葉遞迴攤平）**：將相對偏移疊加為絕對中心座標 `pos[id] = { x, y, w, h }`，群組內容區起點為 `(x + GPAD, y + GPAD + titleH)`。

### 節點尺寸通用推算

所有葉節點尺寸由 canvas 量測（`__cx.measureText`）自動推算，無逐圖手調：

- 換行寬度上限：`maxLeafW = 480`（通用常數），`wrapText` 逐字累積，超限即斷行。
- **矩形節點**：`w = max(textWidth + 34, 90)`、`h = lines × (14 + 7) + 24`（字型大小 `FS = 14`、行間距 `+7`、上下 padding `24`）。
- **菱形節點**：`tw = textWidth + 24`、`th = lines × (14 + 6) + 16`，再以 `1.9` 倍放大後取 `max(tw*1.9, 130)` × `max(th*1.9, 90)`，使菱形外框有足夠空間包住文字。
- 群組標題列高度 `titleH`：`wrapText(gp.label, FSG=14.5, cw - GPAD*2)` 後 `lines × (14.5 + 4) + 12`，依群組內容寬度動態換行。

### dagre 排版常數

各層 dagre 使用相同通用常數：`nodesep: 32`、`ranksep: 48`（`genPng` 傳入之緊湊固定間距 `SEP`）、`marginx/marginy: 0`、`ranker: 'tight-tree'`，無逐圖調整。

### fitToContent 自動裁切貼邊

`P.fitToContent({ padding: 28, allowNewOrigin: 'any', useModelGeometry: true })` 讓 JointJS Paper 依實際內容邊界自動調整 Paper 尺寸與原點，截圖結果自動貼邊，四周留 28px 留白，無需手動指定畫布寬高。

### 從逐圖手調一般化的原則

- **群組標題列高度**：舊版需手動為每張圖的群組指定標題高度，現改為依群組內容寬換行後動態計算。
- **虛線邊標籤位置**：舊版逐圖調整 `distance`，現統一：虛線邊固定 `0.32`；實線邊依端點是否落在群組內動態取 `0.26`/`0.5`/`0.74`（見上「邊與虛線」）。
- **節點換行寬度**：舊版逐圖指定換行點，現統一 `maxLeafW = 480`，由 canvas 量測決定實際斷行位置。
- **菱形放大倍率**：統一 `1.9`，確保所有菱形節點文字不溢出。

## 已知限制 / 回退

- **長線性鏈**：dagre `tight-tree` ranker 在純線性鏈（無分叉）時可能將各節點縱向等距拉伸，導致圖高過長。
- **跨容器邊路由**：JointJS `router: 'normal'` 不感知容器邊界，跨群組邊可能穿越其他群組框體而非繞行。
- **平行邊重疊**：同一對節點若有多條邊（如雙向箭頭或多標籤），`router: 'normal'` 會使邊完全重疊，僅顯示最後繪製的一條。
- **群組巢狀深度**：目前兩段式 layout 支援任意深度巢狀，但 dagre 跨多層的 rank 對齊可能因 `liftTo` 抬升導致內層節點相對位置與預期有偏差。
- **canvas 量測字型依賴**：節點尺寸量測使用頁內 canvas，若環境未安裝 Microsoft JhengHei 字型，量測結果（`measureText`）與最終渲染寬度可能有數像素差距，影響節點框的緊湊度。
