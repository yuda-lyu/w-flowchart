# p5 — D2 (Node 端 + sharp) 產線

## 技術核心

- **繪圖庫**：`@terrastruct/d2`（JS 包裝 + 內建 WASM 引擎），於 Node 端直接呼叫 `new D2()`，不啟動瀏覽器。
- **載入方式**：純 Node 端套件匯入（`import { D2 } from '@terrastruct/d2'`），無 Playwright、無 CDN。
- **D2 instance 生命週期**：`D2` 建構即啟動常駐 `worker_threads` 且無公開關閉 API；若掛在模組層，僅 import 就會令 caller 程序無法自然結束。因此 `genPng` 每次呼叫皆逐次 `new D2()`，並在 `finally` 等待 `d2inst.ready` 後呼叫 `d2inst.worker.terminate()` 釋放 worker。
- **渲染流程**：
  1. `d2inst.compile({ fs: { index: d2src }, options: baseOpt })` — 把 D2 DSL 字串交給 WASM 版面引擎（dagre），取得 `diagram` 與 `renderOptions`。
  2. `d2inst.render(res.diagram, res.renderOptions)` — 產生 SVG 字串。
  3. `injectEdgeLabelHalo(svg)` — 修正邊標籤遮罩、為標籤文字加白色光暈描邊（見下節「邊標籤光暈」）。
  4. `injectFont(svg)` — 在 SVG 內注入 `<style>` 覆寫 `font-family`（見下節字型處理）。
  5. `sharp(Buffer.from(svg), { density }).png().toBuffer()` — 由 sharp（底層 librsvg）依系統字型描繪文字、轉成 PNG Buffer。
- **解析度處理**：不使用固定 `deviceScaleFactor`，改為通用公式依 SVG `viewBox` 寬動態推算 `density`（見自動化機制節），讓輸出像素寬落在 1600–2200 px 區間。
- **字型問題**：本專案所用之 D2 傳入自訂 font buffer 會穩定回傳 `"invalid JSON input"`（實測），故不傳字型給 D2，改在產生的 SVG 插入 `<style>text{font-family:"Microsoft JhengHei","Microsoft YaHei",sans-serif !important;}</style>` 讓 librsvg 以系統安裝的 Microsoft JhengHei 描繪中文。D2 引擎本身已內建 CJK 全形寬度量測，故即使長中文標籤，box 寬度也不溢出。
- **邊標籤光暈**：D2 對有標籤的邊會用 `mask` + 黑色 `rect` 遮斷連線偽造白底效果，且標籤文字疊在連線正上方；`injectEdgeLabelHalo(svg)` 移除 mask 內黑色 rect 讓連線完整穿過標籤區，並注入 CSS 為 `.text-italic` 加 `paint-order:stroke` + 白色描邊，使標籤文字在線段上仍清晰可讀。
- **介面**：`genPng(data, opt)` 為單張渲染函式，回傳值為 PNG Buffer（不寫檔），由 `src/WFlowchart.mjs` 統一調用；`data` 為正規化繪圖數據 `{ dir, nodes, edges }`（caller 已完成 label 衍生）。

## 產製原理（資料驅動）

### translate(data) 的轉換邏輯

`translate(data)` 將 caller 傳入的正規化繪圖數據（`{ dir, nodes, edges }`）轉成 D2 DSL 字串：

#### 全域方向

```
direction: <DIR_MAP[data.dir]>
```

`data.dir` 為 `TB / LR / BT / RL`，透過 `DIR_MAP` 對應至 D2 關鍵字 `down / right / up / left`。

#### 節點與群組容器

- **父子關係建立**：掃描 `nodes`，凡有 `nd.group` 欄位者記入 `parentMap`（`nodeId → parentId`）與 `childrenMap`（`parentId → [node]`）。無 `group` 的節點為頂層節點。
- **群組容器**（`isGroupCls(nd.cls)` 為真，即 cls 結尾為 `G` 或 `G2`）：
  - 產生 D2 block（`id: "label" { ... }`），在 block 內設定 `direction`（延用圖的頂層方向）與樣式。
  - 遞迴呼叫 `renderNode` 展開子節點，縮排 +2 空格。
  - `style.bold: true`（群組標題加粗）、`style.font-color` 取自 palette `text` 欄。
- **一般節點**（含 diamond）：同樣產生 block，由 `styLines` 填入 `style.fill`、`style.stroke`；若 `c.shape === 'diamond'` 則補 `shape: diamond`。
- **cls 上色**：呼叫 `colorOf(cls)`（查無則回退 `blue`），對應 `common/palette.mjs` 的 `PALETTE` 色票，取 `fill / stroke / text / shape`。

#### 邊

所有邊一律在 DSL 頂層宣告。跨群組容器的邊使用 `qualifiedId(nodeId, parentMap)` 遞迴向上追溯，組成 `"父.子"` 完整路徑，讓 D2 正確解析巢狀容器內的子節點引用。

- `ed.kind === 'dashed'`：補 `{ style.stroke-dash: 4 }`。
- `ed.label` 存在時補 `: "label"`。
- `$` 字元以 `esc()` 轉成 `\$`，避免 D2 變數展開。

## 自動化機制

### 版面全通用，無逐圖魔術數字

所有 9 張圖共用同一組通用常數：

| 常數/公式 | 值 / 說明 |
|---|---|
| `layout` | `'dagre'`（所有圖一致） |
| `pad` | `40`（D2 四邊留白，單位 px，SVG 空間） |
| `themeID` | `0`（D2 預設主題，所有圖一致） |
| `density` 公式 | `96 × clamp(1.4, 2.4, 1700 / viewBoxWidth)` |

### density 動態推算

渲染完 SVG 後，以正規表達式取出 `viewBox="0 0 W H"` 的寬度 `W`，代入：

```
density = 96 * Math.min(2.4, Math.max(1.4, 1700 / W))
```

- `W` 越小（節點少、圖緊湊）→ density 趨近 2.4（放大），確保輸出不糊。
- `W` 越大（節點多、圖寬）→ density 趨近 1.4（縮小），避免輸出過大。
- `W` 無法取得時回退 `1000`。
- 輸出像素寬大致落在 **1600–2200 px**。

此公式取代舊版逐圖手調 scale 或固定 `deviceScaleFactor`，對全部 9 張圖自動適應。

### 字型注入（自動覆寫，非逐圖設定）

`injectFont(svg)` 自動在 SVG 頂層插入 style 區塊，注入點邏輯：若 SVG 已含 `<style`，則插在首個 `<style` 之前；否則插在根元素開頭 `>` 之後。無需對各圖個別處理。

## 已知限制 / 回退

- **無碰撞偵測與自動間距迴圈**：版面全部由 dagre 排定，不另行疊代調整間距，節點密集時可能重疊或擠壓。
- **線性鏈被拉長**：dagre 對純線性鏈（無分支）傾向垂直拉伸，圖面縱橫比可能不理想。
- **平行邊重疊**：同一對節點若有兩條方向相同的邊（含同標籤平行邊），D2/dagre 可能使其重疊，難以區分。
- **不支援自訂字型傳入 D2**：傳 font buffer 必定回 `"invalid JSON input"`（實測），字型須倚賴系統安裝的 Microsoft JhengHei，移至無此字型的環境時中文渲染可能退化為 sans-serif 備援。
- **無自動裁切貼邊**：`pad: 40` 為固定四邊留白，不會依內容動態裁切。
- **群組容器巢狀深度**：D2 DSL 支援巢狀 block，但 dagre 版面引擎對三層以上深度巢狀的排版品質未有保證。
