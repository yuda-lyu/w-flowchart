# p10 — ELK 直用 + 自寫 SVG 渲染器 產線

p1~p9 為現成繪圖套件;**p10 是唯一「自寫 SVG 渲染器」產線**:用 elkjs 只負責「算佈局」,座標拿到後由本產線**自行繪製 SVG**,版面與樣式完全可控。

## 技術核心

- **佈局引擎**:`elkjs`(Eclipse Layout Kernel 的 JS 版,`elk.bundled.js` UMD 主執行緒、免 worker),由本機 `node_modules` 讀出後於 `gen.mjs` 模組載入時以 `common/pkg.mjs` 的 `pkgScript` 內聯注入 `PAGE_HTML`(取代 CDN,斷網環境可用),於 Playwright headless 頁內執行。`new ELK().layout(graph)` 回傳各節點/容器之座標尺寸與各邊之 sections(轉折點)。
- **渲染**:本產線**自行把 ELK 結果組成 SVG 字串**(rect / polygon 菱形 / path 折線 + 箭頭 / foreignObject 文字),插入頁面後對 `#stage svg` 截圖。`deviceScaleFactor:2`。中文以 `foreignObject` 內 div 渲染(瀏覽器原生量字、不爆框)。
- **呼叫入口**:`export async function genPng(data, opt = {})` 為唯一對外介面,回傳 `Promise<Buffer>`(PNG);由 `src/WFlowchart.mjs` 之 `GENS.p10` 統一調用(`mode: 'p10'`)。`data` 為正規化繪圖數據 `{ dir, nodes, edges }`;`opt` 保留擴充,目前原樣接收但未使用。`gen.mjs` 另外 `export function translate` 與 `export const PAGE_HTML`,供 `test/`(19 案結構不變量 + 快照回歸測試)重用真實管線(不複製渲染器)。

## 產製原理(資料驅動)

`translate(data)` 把標準數據轉成 ELK 圖 + 渲染:
- **節點**:量測標籤(`#meas` 隱形 div)得寬高 → ELK node width/height;`diamond` 類別畫 polygon 菱形(尺寸放大以內含標籤),其餘畫圓角 rect;色彩依 `colorOf(cls)`。
- **群組/巢狀容器**:群組為 ELK 的 child node、其成員為該 node 的 `children`(支援多層巢狀);`elk.padding` 上方留標題空間;`hierarchyHandling:INCLUDE_CHILDREN` 確保**跨容器邊不會把成員拉出容器**。渲染時容器 rect 墊底(深度小先畫)+ 標題置頂粗體。
- **邊**:依 source/target 之最近共同祖先容器(LCA)宣告(無共同容器則掛於 root)——ELK 對「宣告於某容器的邊」回傳之 section 座標相對該容器,故渲染時需對位;ELK 以 `edgeRouting:ORTHOGONAL` 算**正交直角路由**,輸出 sections 轉折點 → 本產線繪 polyline + 自繪三角箭頭。座標依邊所在容器之絕對位移還原。
- **流向**:`dir` → ELK `elk.direction`(TB→DOWN、LR→RIGHT)。

## 自動化機制

- **巢狀容器零逃逸**:ELK `INCLUDE_CHILDREN` 是本產線相對 maxGraph/vis 的關鍵優勢——群組成員一律待在容器內,容器自動依成員撐大(含多層巢狀)。
- **正交直角邊路由**:現成 10 套皆無;由 ELK 演算、本產線自繪。
- **字型全覆蓋**:所有 SVG 文字(節點/容器標題/邊標籤)走 `foreignObject` + `font-family:Microsoft JhengHei`,無遺漏、不爆框。
- **邊標籤白光暈**:邊標籤 div 以多向 `text-shadow` 白光暈(`EDGE.haloColor/haloWidth`),透明底、不遮線。
- **菱形標籤置中**:菱形以 polygon 畫、標籤 foreignObject 置中於外接框,天然置中(優於 vis 需 vadjust 硬調)。
- 版面間距為通用常數(`elk.spacing.*`),尺寸由內容自然決定,無逐圖魔術數字。

## 已知限制

- **循環(回邊)起點**:ELK 的斷環點不一定讓「流程起點」落在最上(如作業流程的「退回」迴圈),屬版面取捨、非錯誤(可調 ELK cycle-breaking 選項)。
- **線性長鏈**:純線性流程(如批次)會被拉得較高(與 dagre 系一致)。
