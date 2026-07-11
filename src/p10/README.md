# p10 — ELK 直用 + 自寫 SVG 渲染器 產線

p1~p9 為現成繪圖套件;**p10 是唯一「自寫 SVG 渲染器」產線**:用 elkjs 只負責「算佈局」,座標拿到後由本產線**自行繪製 SVG**,版面與樣式完全可控。

## 技術核心

- **佈局引擎**:`elkjs`(Eclipse Layout Kernel 的 JS 版,`elk.bundled.js` UMD 主執行緒、免 worker),由本機 `node_modules` 讀出後於 `gen.mjs` 模組載入時以 `common/pkg.mjs` 的 `pkgScript` 內聯注入 `PAGE_HTML`(取代 CDN,斷網環境可用),於 Playwright headless 頁內執行。`new ELK().layout(graph)` 回傳各節點/容器之座標尺寸與各邊之 sections(轉折點)。
- **渲染**:本產線**自行把 ELK 結果組成 SVG 字串**(rect / polygon 菱形 / path 折線 + 箭頭 / foreignObject 文字),插入頁面後對 `#stage svg` 截圖。`deviceScaleFactor:2`。中文以 `foreignObject` 內 div 渲染(瀏覽器原生量字、不爆框)。
- **呼叫入口**:`export async function genPng(data, opt = {})` 與 `export async function genSvg(data, opt = {})` 為對外介面,`genPng` 回傳 `Promise<Buffer>`(PNG),`genSvg` 回傳本產線自組之 standalone SVG 字串(`#stage` 內容,`&nbsp;` 正規化為 `&#160;`);由 `src/WFlowchart.mjs` 之 `GENS.p10` 統一調用(`mode: 'p10'`)。`data` 為正規化繪圖數據 `{ dir, nodes, edges }`;`opt` 保留擴充,目前原樣接收但未使用。`gen.mjs` 另外 `export function translate` 與 `export const PAGE_HTML`,供 `test/`(結構不變量 + 快照回歸測試)重用真實管線(不複製渲染器)。

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
- **菱形端點貼齊(共進共出)**:ELK 以外接矩形算邊端點,落在矩形邊上非頂點處會與菱形斜邊「空接」。依「側」(上/下/左/右)獨立處理:**出**→一律由該側「頂點」出發,多條共用首段後於各自高度 90 度轉出(分岔);**進**→該側無出時全部匯入「頂點」(各自橫移至中軸共用末段,箭頭重合),該側有出時依「半側」匯入該半側「斜邊中點」(頂點讓給出,進出不同點)。正交線交叉允許存在(正交路由常態),一致性優先。13 種進出組合由測試之單元驗證逐一把關(其中「同半側」類組合受 ELK 埠序限制,乾淨合成圖排不出,僅能在函式層驗證)。
- **正交路徑化簡(碰撞偵測把關)**:ELK 階層邊(`INCLUDE_CHILDREN`)偶發「先繞反方向再折返」的 S/U 形繞行(跨容器回邊尤甚)。渲染前對每條路徑反覆嘗試把「平行-垂直-平行」三段窗收斂為兩段,僅在碰撞偵測全過才接受:不撞節點框/容器標題帶/邊標籤、不與他邊平行段貼齊併線;端點段軸向與方向不可翻轉(維持節點進出方向,先於菱形貼齊執行故不干擾其規則);邊標籤若因化簡脫離路徑則整段還原。已極簡之路徑零誤觸。
- 版面間距為通用常數(`elk.spacing.*`),尺寸由內容自然決定,無逐圖魔術數字。

## 已知限制

- **循環(回邊)起點**:ELK 的斷環點不一定讓「流程起點」落在最上(如流程的「退回」迴圈),屬版面取捨、非錯誤(可調 ELK cycle-breaking 選項)。
- **線性長鏈**:純線性流程(如批次)會被拉得較高(與 dagre 系一致)。
- **A4 折排容器不可含內部循環**:被自動折排(`elk.aspectRatio` + `SINGLE_EDGE` wrapping)挑中的容器,若其內部邊集含循環,折排結果不穩定,部分節點數組合會令 elkjs 內部拋例外(`IndexOutOfBoundsException` / `NoSuchElementException`)。實測經驗法則:讓會被折排的容器內部保持無環、單一入出口,退回/重試循環放在該容器之外或小型巢狀子群組內。
- **二層巢狀 + 密集帶標籤邊之組合**:巢狀子群組內有「4+ 節點直鏈且 3+ 連續帶標籤邊」,或「子群組內部帶標籤/分支邊 + 同深度姊妹群組間直連邊」之組合,部分情況會觸發 elkjs 內部例外。繞法:讓功能區群組各自獨立成鏈/分支,跨區以共用之獨立葉節點中繼,或改用群組↔群組邊。
