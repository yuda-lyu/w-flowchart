# 規則帳本

本檔為套件設計與開發階段之規則帳本(藍圖),為要求程式碼須長成什麼樣,或由規格產出之測試(項目/說明/流程)有哪些,包含軸、單一擁有者、已知限制、破壞性變更紀錄,以及對應是哪些測試檔案或指令等,由agent自行編列、擴充與維護.當前已做到哪些記於`sgud/state/state.md`.過長時依類型拆為`rulebook_<類型>.md`,本檔只留索引.

## 規則 1:PNG 快照基準之比對度量(pixelmatch 8)

**規則**:測試中所有 PNG 像素比對一律以 pixelmatch 8 之下列選項判定,容差(反鋸齒雜訊像素上限)`MAXDIFF = 60`:

```js
pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1, includeAA: false, checkerboard: true })
```

- `threshold: 0.1`、`includeAA: false`、`checkerboard: true` 皆**明寫**,不依賴函式庫預設(8 之 `checkerboard` 預設為 true,明寫為避免日後預設改變而悄悄改變判定).
- **度量變更(破壞性,2026-11-09)**:pixelmatch 8 之色差度量由 YIQ 改為 OKLab HyAB,無選項可還原 7 之判定.8 比 7 敏感之處:近黑區 16~31 級明度差、飽和色 16~31 級色偏;透明背景下半透明內容之真實改變 8 抓得到而 7 抓不到(`checkerboard: true`).每通道 ≤ 12 級之雜訊兩版皆不計.參數與容差之取捨來自上游自有套件(w-package-tools-e2e)之量測,本套件沿用同值,不自行放寬.
- **瀏覽器變更(破壞性,2026-11-09)**:`playwright` `^1.63.0` → `^1.64.1`(Chromium 153.0.8010.12 → 156.0.8078.4;headless shell 1243 → 1248)改變 p9 連線標籤(React Flow `edge-textwrapper`)之文字量測與次像素定位:標籤矩形變動 ≤ 1.4 CSS px、字形原點位移 ≤ 0.9 CSS px,節點、群組、連線路徑 0 變動、文字與折行不變、畫布尺寸不變.p9 含連線標籤之標準圖 20 張因此重產(清單見 `sgud/state/state.md`);無連線標籤之案與其他產線(p1~p8、p10)比對結果不變.
- 不放寬 `MAXDIFF` 與 `threshold` 去吸收度量或瀏覽器差異;不整批重產.

**單一擁有者**:`pngCompare` 於兩處各內嵌一份(`test/p10.test.mjs`、`test/snapshot.mjs`),選項與容差必須同值.

**盤點指令**(站點全集;預期恰 2 處且選項字串相同):

```
git grep -n "pixelmatch(" -- test
git grep -n "MAXDIFF = " -- test
```

| 站點 | 選項 | 容差 | 判定 |
|---|---|---|---|
| `test/p10.test.mjs:38` | `{ threshold: 0.1, includeAA: false, checkerboard: true }` | `MAXDIFF = 60`(`:23`) | 已套 |
| `test/snapshot.mjs:29` | 同上 | `MAXDIFF = 60`(`:15`) | 已套 |

**升度量或瀏覽器(playwright)後標準圖比對失敗之處置**(只在度量變更、瀏覽器換版時適用;對照組一律「暫裝舊版」,**不寫入 `package.json` 與 lock**):
1. 先跑既有測試,全綠者無須處理.動工前先存一份 `git diff -- package.json package-lock.json`(還原後比對用).
2. 有失敗者,依變更類型暫裝舊版取得對照:
   - **度量(pixelmatch)**:`npm i --no-save pixelmatch7@npm:pixelmatch@7.2.0`,對「標準圖 vs 當次輸出」以 7 與 8 各算一次(同一組選項).`snapshot.mjs` 失敗時 `<案>.new.png` 為當次輸出;`p10.test.mjs` 只存 `<案>.diff.png`,須先重跑取得當次輸出;有 `<案>.alt.png` 者主基準與 alt 都要算.
   - **瀏覽器(playwright)**:`npm i --no-save playwright@<舊版> playwright-core@<舊版>`(兩者一併;舊版 headless shell 須已在 `%LOCALAPPDATA%/ms-playwright`),先確認 `node_modules/playwright-core/package.json` 為舊版,再單檔跑失敗之 `test/pN.test.mjs`(標準圖由舊版產出者,舊版應全綠).要取得「每案」像素計數(單檔測試只在失敗時回報計數)與兩版並排,可另裝別名 `npm i --no-save pw_old@npm:playwright@<舊版>`,於暫存腳本內同一行程各 import 一次、各渲染同一案;單檔測試之失敗證據 `<案>.new.png` 在還原後重跑時會再產生.
3. 分類:METRIC-ONLY(7 之計數 ≤ 容差 < 8 之計數)、BROWSER-ONLY(舊版綠、新版紅)為重產候選;度量兩版計數皆 > 容差、或瀏覽器舊版也紅(BOTH-FAIL)非該變更所致,依一般流程查因,**不得以重產處理**,寫入報告由主控裁定.
4. **還原**(瀏覽器):`npm i --no-audit --no-fund`(依現 lock;別名套件隨之被修剪),確認 `node_modules/playwright`、`playwright-core` 為新版、`package.json` 仍為新版範圍,且 `git diff -- package.json package-lock.json` 與第 1 步所存相同.
5. 只重產候選中**逐張目視確認畫面內容確實未改變**者:`UPDATE_BASELINE=1` 搭配 `--grep`(`it` 標題為 `[合成|範例圖|菱形|方位|真圖] <名>`;mocha 之 `--grep` 須寫成 `"/…(a|b|c)$/"` 才視為正規式,否則字串被跳脫)只跑該案,實跑 passing 數須等於候選數;重產後 `git diff --stat test/pics` 須只含這些張,且重產檔與當次輸出位元相同(兩次渲染位元決定性).
   - 瀏覽器換版之「內容未改變」判準(三項皆須成立,不能只憑目視):①並存兩版渲染同一案並傾印 `#shot` 內全部元素與文字節點之版面矩形(`getBoundingClientRect`、`Range.getClientRects`):元素集與順序相同、節點與群組容器與連線路徑 ≤ 0.01 CSS px、文字內容與折行相同、畫布尺寸相同;②差異像素 100% 落在「版面有變動之元素矩形(外擴 4 CSS px)」內;③新舊並排放大逐張目視(基準 | 新輸出 | 差異×8),存證據夾.任一項不成立(節點位移、換行改變、尺寸不同)即屬內容改變,不重產,列入報告附放大圖與座標.
6. 結束前移除暫裝之舊版,`package.json` 與 lock 不得含 `pixelmatch7`、舊版 playwright 或別名套件;刪除 `test/pics/*/` 內之 `*.new.png`、`*.diff.png`.

**對應測試**:`test/p10.test.mjs`、`test/p1.test.mjs`~`test/p9.test.mjs`(經 `test/snapshot.mjs`);指令 `npm test`.
