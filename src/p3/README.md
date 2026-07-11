# p3 — nomnoml 產線

## 技術核心

- **繪圖庫**：nomnoml（`nomnoml/dist/nomnoml.js`），與其相依 `graphre`（`graphre/dist/graphre.js`）由本機 `node_modules` 讀出後內聯注入頁面 `<script>`（`common/pkg.mjs` 的 `pkgScript()`），非透過 CDN，斷網環境亦可渲染；nomnoml UMD 模組依賴全域 `graphre`，注入順序須 graphre 先於 nomnoml。npm 版 nomnoml 之佈局由套件自宣告相依的 graphre 驅動，與舊版 CDN bundle（`nomnoml.web.js`，內部改捆 `@dagrejs/dagre`）佈局引擎不同，兩者排版結果可能略有差異。
- **渲染方式**：於頁面注入 `window.renderAndDetect(src)` 函式，呼叫 `window.nomnoml.renderSvg(src)` 將 DSL 字串渲染為 SVG，並將結果寫入 `#box` div 的 innerHTML。
- **截圖目標**：以 Playwright locator `#box svg` 精確擷取 SVG 元素本身，排除頁面邊距干擾。
- **解析度**：啟動 `browser.newPage({ deviceScaleFactor: 2 })`，輸出為 2× 實體像素的高解析度 PNG。
- **呼叫方式**：`genPng(data, opt)` 為單張渲染函式，接受正規化繪圖數據 `{ dir, nodes, edges }`，內部自建 browser/page 並於結束時關閉，回傳 PNG 的 Node Buffer（不落地檔案），由 `src/WFlowchart.mjs` 統一調用（`mode: 'p3'`）；同結構之 `genSvg(data, opt)` 回傳 `#box` 內引擎原生輸出之 SVG 字串（`&nbsp;` 正規化為 `&#160;`）。

## 產製原理（資料驅動）

### 資料輸入格式（標準化數據）

每份圖的數據含：
- `nodes`：`{ id, label, cls, group? }` — 節點清單，`group` 為所屬容器節點 id
- `edges`：`{ from, to, label?, kind }` — 邊清單，`kind` 為 `'solid'` 或 `'dashed'`
- `dir`：`'LR'`（左右）或 `'TB'`（上下）

### nomnoml 兩項庫層限制與對策

nomnoml 有兩項硬限制（經實測 + 源碼 classifier regex `<([a-z]*)>` 確認），決定本套轉譯策略：

- **限制一**：classifier 名（`<...>`）只接受純小寫字母 `[a-z]+`；含大寫或數字（如 `blueG`、`greenG2`）比對失敗，整段 `<...>` 會被當成字面標籤文字渲染，外洩內部標記。
  對策：`clsAlias(cls)` 把每個 cls 逐字映射成純小寫字母且彼此唯一的別名（大寫字母 → 小寫、數字 `2` → `b`、其餘非 `[a-z]` 字元 → `g`），如 `blueG→blueg`、`blueG2→bluegb`、`greenG2→greengb`；樣式（`#.<alias>: fill=... stroke=...`）仍照常套用，classifier 名不外顯。
- **限制二**：nomnoml 節點識別子＝標籤文字本身（無 `id=` 屬性），且巢狀容器（`[容器 | 子節點]`）內的子節點無法被外部邊參照——以子節點標籤當邊端點會「新建一份重複節點」而非連到既有子節點，造成同內容畫兩份／連線斷裂。nomnoml 無 compound graph，此為庫本身限制。
  對策：所有節點一律「頂層平鋪宣告」（不用巢狀），群組歸屬改以「容器→成員」虛線關聯邊表達（比照 p10/vis 對相同限制之作法；成員與容器共用色相已表群組），邊端點一律以「既有節點之確切標籤」參照，形成單一連通圖、零重複節點。

### translate(data) 轉換流程

**方向映射**：`data.dir === 'LR'` 輸出 `#direction: right`；否則輸出 `#direction: down`。

**節點著色與形狀**：
- `buildClsDirectives()` 迭代 `PALETTE`，為每個非 `diamond` cls 輸出一行 nomnoml 自訂類別指令，格式為 `#.<clsAlias(cls)>: fill=<fill> stroke=<stroke>`。
- `diamond` cls 直接對應 nomnoml 內建 `<choice>` 分類器（不需自訂樣式）；其餘 cls 經 `classifier()` 對應 `<clsAlias(cls)>`（如 `blue`→`<blue>`、`blueG`→`<blueg>`）。

**節點宣告（頂層平鋪）**：
- 所有節點不分是否屬於群組，一律輸出頂層宣告 `[<classifier>標籤]`，不使用巢狀容器語法。

**群組歸屬（關聯邊，取代巢狀容器）**：
- 節點含 `group` 欄位且該 group 對應之節點存在時，額外輸出一條「容器 → 成員」關聯邊 `[容器標籤] --> [成員標籤]`（語意上僅表示歸屬，非資料流向），使排版把成員擺在容器旁；群組邊界主要靠成員與容器共用色相辨識。

**數據明列之邊**：
- 邊端點以節點的確切標籤文字參照既有節點（不新建節點）。
- `kind === 'dashed'` 輸出 `-->`；其餘輸出 `->`。
- 邊的標籤插在箭頭符號前（如 `[A] 標籤 -> [B]`）；無標籤時插一個空格。

**字型**：全域以 `#font: Microsoft JhengHei` directive 強制統一——nomnoml 對每個 `<text>` 內聯輸出 CSS `font:` 簡寫（預設 Helvetica），會壓過 body 的 `font-family`，`#font:` 為庫層唯一能統一套用之機制，值須為裸族名（不帶引號/逗號，否則破壞 CSS 簡寫）。

### DSL 輸出結構

```
#direction: right|down
#font: Microsoft JhengHei
#.<clsAlias>: fill=... stroke=...      ← 每個非 diamond cls 一行
[<classifier>節點標籤]                  ← 所有節點頂層平鋪
[容器標籤] --> [成員標籤]                ← 群組歸屬關聯邊
[A] 標籤 -> [B]                        ← 數據明列之邊
```

## 自動化機制

### 邊標籤可讀性：白色光暈 + z-order 提層

nomnoml 不為邊標籤畫底色（邊標籤背景透明），緊湊間距下邊標籤文字若與節點/容器填色重疊會被蓋住。`renderAndDetect` 對每個「無 `data-name` 屬性」的 `<text>`（節點標籤皆帶 `data-name`，無此屬性者即為邊標籤）做兩件事：

- **白色描邊**（`paint-order:stroke` + `stroke=#ffffff`、`stroke-width≈3.5`，對應 `common/palette.mjs` 的 `EDGE.haloColor`/`EDGE.haloWidth`），使文字在線段/填色上仍清晰可讀。
- **提升 z-order**：nomnoml SVG 的 DOM 順序為「邊標籤 → 邊線 → 節點 rect/text」，故將每個邊標籤 `<text>` 搬移至 `<svg>` 尾端（最後繪製），使其永遠疊在節點 rect／容器填色之上。

### 碰撞偵測迴圈（autofix）

本產線「額外添加」的自動化核心，替代逐圖手調間距的魔術數字：

- `renderAndDetect(src)` 渲染後取頁內所有 `svg text` 元素的 `getBoundingClientRect()`，兩兩比對重疊量，若兩軸重疊均超過 2px 則計為一次碰撞。**只計「節點×節點」文字重疊**（節點標籤帶 `data-name`，邊標籤無）——任一方為邊標籤的重疊一律不算碰撞，因其可讀性已由上述 halo + z-order 保證，不該用加大間距處理（否則長邊標籤會把圖撐爆）；只有節點本體互疊才驅動間距調整。
- `autofix(page, src)` 以掃描序列 `[40, 60, 85]`（px）依序嘗試 `#spacing: N`，取「第一個達到零碰撞」的最小間距；若掃完仍有碰撞，取碰撞數最少的間距（不放棄輸出）。掃描上限封在 85（原則：封頂緊湊）——若 85 仍殘留少量重疊，寧可保持緊湊留下該重疊（代表此圖不適合 nomnoml，交由挑選階段換其他產線），絕不灌大間距讓圖撐大、字變小。
- 確定最佳間距後，以 `#spacing: <best> + DSL` 重繪一次，等待字型就緒（`document.fonts.ready`）及 180ms 穩定後截圖。

此機制使產線不需逐圖指定間距，完全由碰撞結果通用決定版面密度。

### 版面通用化原則

- `#direction` 直接從數據 `dir` 推算，無逐圖硬碼方向。
- 間距（`#spacing`）由碰撞偵測迴圈通用決定，無逐圖魔術數字。
- 群組歸屬由 `group` 欄位自動合成關聯邊，無逐圖手工排列子節點。
- 節點分類器與著色由 `PALETTE` 統一驅動，新增 cls 只需在 `palette.mjs` 中定義即可自動生效（`clsAlias()` 自動處理別名唯一性）。

### 穩定性處置

截圖前執行 `document.fonts.ready` 等待中文字型（Microsoft JhengHei）載入完成，再加 180 ms 額外緩衝，避免字型未就緒造成文字 bbox 量測偏差而誤報碰撞或截圖模糊。

## 已知限制 / 回退

- **邊以 label 文字匹配節點**：若兩個節點擁有相同的 label 文字，nomnoml 無法區分，邊可能連錯目標。數據設計應確保 label 唯一。
- **同 label 平行邊重疊**：nomnoml 對兩節點間的多條邊不做分叉偏移，平行邊會堆疊在同一條線上，標籤重疊難以辨識。
- **無原生群組容器框**：改以「容器→成員」關聯邊表達歸屬（見上），視覺上無實體容器外框，僅靠共用色相辨識群組邊界，不若原生 compound graph 直觀。
- **線性鏈被拉長**：對節點數多且為線性序列的圖（如長流程鏈），nomnoml 可能把畫布拉得很長，碰撞偵測的間距調整無法改善長寬比。
- **碰撞偵測上限**：掃描序列最大值為 85px，若在此間距下仍有碰撞（如標籤極長或節點極密），會以殘留碰撞數最少者輸出。
- **本機套件相依**：nomnoml／graphre 由本機 `node_modules` 讀出內聯注入，需先完成 `npm install`；執行環境本身不需連網。
</content>
