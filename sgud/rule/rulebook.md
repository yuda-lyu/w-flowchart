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
   - **瀏覽器(playwright-core;2026-11-13 起經 w-playwright,規則 2)**:版本由 w-playwright 精確釘住,本套件不直接宣告 `playwright`／`playwright-core`;且 w-playwright 於實裝 playwright-core ≠ 其內附表時拒絕啟動(`E_PW_VERSION`),故不能只換 playwright-core.對照組改暫裝舊版 w-playwright(`npm i --no-save w-playwright@<舊版>`,其精確釘住之 playwright-core 隨之換版;**此作法尚未實跑**,舊版須存在於私有倉庫、其 headless shell 須已在 `%LOCALAPPDATA%/ms-playwright`),先確認 `node_modules/playwright-core/package.json` 為舊版,再單檔跑失敗之 `test/pN.test.mjs`(標準圖由舊版產出者,舊版應全綠).要取得「每案」像素計數(單檔測試只在失敗時回報計數)與兩版並排,可另裝別名 `npm i --no-save pw_old@npm:playwright@<舊版>`,於暫存腳本內同一行程各 import 一次、各渲染同一案;單檔測試之失敗證據 `<案>.new.png` 在還原後重跑時會再產生.
3. 分類:METRIC-ONLY(7 之計數 ≤ 容差 < 8 之計數)、BROWSER-ONLY(舊版綠、新版紅)為重產候選;度量兩版計數皆 > 容差、或瀏覽器舊版也紅(BOTH-FAIL)非該變更所致,依一般流程查因,**不得以重產處理**,寫入報告由主控裁定.
4. **還原**(瀏覽器):`npm i --no-audit --no-fund`(依現 lock;別名套件隨之被修剪),確認 `node_modules/w-playwright`、`playwright-core` 為新版、`package.json` 仍為新版範圍,且 `git diff -- package.json package-lock.json` 與第 1 步所存相同.
5. 只重產候選中**逐張目視確認畫面內容確實未改變**者:`UPDATE_BASELINE=1` 搭配 `--grep`(`it` 標題為 `[合成|範例圖|菱形|方位|真圖] <名>`;mocha 之 `--grep` 須寫成 `"/…(a|b|c)$/"` 才視為正規式,否則字串被跳脫)只跑該案,實跑 passing 數須等於候選數;重產後 `git diff --stat test/pics` 須只含這些張,且重產檔與當次輸出位元相同(兩次渲染位元決定性).
   - 瀏覽器換版之「內容未改變」判準(三項皆須成立,不能只憑目視):①並存兩版渲染同一案並傾印 `#shot` 內全部元素與文字節點之版面矩形(`getBoundingClientRect`、`Range.getClientRects`):元素集與順序相同、節點與群組容器與連線路徑 ≤ 0.01 CSS px、文字內容與折行相同、畫布尺寸相同;②差異像素 100% 落在「版面有變動之元素矩形(外擴 4 CSS px)」內;③新舊並排放大逐張目視(基準 | 新輸出 | 差異×8),存證據夾.任一項不成立(節點位移、換行改變、尺寸不同)即屬內容改變,不重產,列入報告附放大圖與座標.
6. 結束前移除暫裝之舊版,`package.json` 與 lock 不得含 `pixelmatch7`、舊版 w-playwright／playwright 或別名套件;刪除 `test/pics/*/` 內之 `*.new.png`、`*.diff.png`.

**對應測試**:`test/p10.test.mjs`、`test/p1.test.mjs`~`test/p9.test.mjs`(經 `test/snapshot.mjs`);指令 `npm test`.

## 規則 2:瀏覽器啟動一律經 w-playwright(2026-11-13,排程第 442 項;w-playwright 帳本 R-PW-ONLY、R-PW-WIRING 於本套件之落實)

**背景**:Windows 上 Chromium 系瀏覽器(真 Chrome 153 起、完整 Chromium、Edge)每啟動一個新根行程即以錯誤密碼替目前使用者呼叫一次 `LogonUser`,10 分鐘內 10 次即鎖帳號.w-playwright 於每次啟動合併出恰一串 `--disable-features`(Playwright 預設＋`AutofillAiWalletPrivatePasses`＋呼叫端自給者)並統一 Playwright 版本(`playwright-core` 精確 1.64.1).本套件只啟動無頭 headless shell(不觸發 `LogonUser`),但依全庫規則一律經 w-playwright.

| 條 | 規則 | 測試 |
|---|---|---|
| R-FC-WPW-01 | `src/common/launchBrowser.mjs` 為**唯一**瀏覽器啟動點(內部呼叫 `wpw.launchChromium({ headless: true })`),p1~p10 之 10 個站點皆呼叫 `launchBrowser()`,不得出現第二個 `wpw.launchChromium(` 於 `src/`;每個站點送出之選項含守門:恰一個 `--disable-features`、置於 `args` 最後、含 `AutofillAiWalletPrivatePasses`、`ignoreDefaultArgs` 含 Playwright 預設串、`headless: true` | `test/api-wpwWiring.test.mjs`(站點全集 1 案;17 個 (模式,輸出) 組合各 1 案,以 `setBrowserTypeForTest` 替身斷言**替身確被呼叫**且選項含守門) |
| R-FC-WPW-02 | 接縫至少一案不用替身:替身 `next()` 走真路徑,真啟動 headless shell 產出合法 PNG,且送出之選項含守門;受管瀏覽器缺檔時 `WFlowchart()` reject 帶 `code: 'E_BROWSER_MISSING'`(本套件不自動安裝,`autoInstall` 維持預設關) | `test/api-wpwWiring.test.mjs`(末二案);全套之真啟動 |
| R-FC-WPW-03 | `src`、`test`、`toolg` 之 `.mjs`／`.js` 不得以靜態匯入、動態 `import()`、`require` 引用 `playwright`／`playwright-core`;`package.json` 不宣告兩者,`dependencies` 宣告 `w-playwright`;`toolg/gDistRollup.mjs` 之 `external` 與 `globals` 以 `w-playwright` 取代 `playwright`;不得為對照舊版瀏覽器而把 playwright 加回 `package.json`(對照用暫裝,規則 1) | `test/unit-wpwOnly.test.mjs`(4 案,含掃描檔數防空集合與正則自檢) |
| R-FC-WPW-04 | `README.md` 之安裝段寫明:安裝即帶入 playwright-core 1.64.1、受管瀏覽器以 `wpw.ensureChromium()` 取得且不寫 `npx playwright install`、離線以 `PLAYWRIGHT_BROWSERS_PATH`(載入前設定)、本套件不用系統 Chrome／Edge、一律加入之守門參數與原因、`PWDEBUG`／`SELENIUM_REMOTE_URL` 不支援、行為變更 | 人工(盤點指令見下) |

**盤點指令**(站點全集;預期 10 處站點、`wpw.launchChromium(` 於 `src/` 恰 1 處):

```
git grep -n --untracked "launchBrowser()" -- "src/*.mjs"
git grep -n --untracked "wpw\.launchChromium(" -- src
rg -n --glob "*.{mjs,js}" --glob "!**/node_modules/**" --glob "!**/dist/**" "(from\s+|import\(\s*|require\(\s*)['\"`]playwright(-core)?['\"`/]" src test toolg
rg -n --glob "**/package.json" --glob "!**/node_modules/**" "\"playwright(-core)?\"\s*:" .
```

| 站點(`launchBrowser()` 呼叫) | 可達之 (模式,輸出) | 判定 |
|---|---|---|
| `src/p1/gen.mjs:191` | p1 png、svg | 已套 |
| `src/p2/gen.mjs:195` | p2 png、svg | 已套 |
| `src/p3/gen.mjs:176` | p3 png、svg | 已套 |
| `src/p4/gen.mjs:73` | p4 png、svg | 已套 |
| `src/p6/gen.mjs:175` | p6 png | 已套 |
| `src/p6/gen.mjs:267` | p6 svg | 已套 |
| `src/p7/gen.mjs:369` | p7 png、svg | 已套 |
| `src/p8/gen.mjs:398` | p8 png、svg | 已套 |
| `src/p9/gen.mjs:51` | p9 png(不支援 svg) | 已套 |
| `src/p10/gen.mjs:420` | p10 png、svg | 已套 |
| p5(D2/WASM,無瀏覽器) | — | 不適用 |

測試側之直接啟動(非 production 站點,亦經 w-playwright):`test/lib.mjs`(p10 舞台頁)、`test/wflowchart.test.mjs`(SVG XML 解析案).

**逐站點變異**(2026-11-13):將各站點改為不經 w-playwright(拋出帶 `E_LAUNCH` 之錯,使判別只剩「替身應被呼叫」),11 次變異(10 站點＋共同啟動點)接線測試皆轉紅且恰為該站點可達之組合(單站點 1~2 案、共同啟動點 17 案),還原後 `git diff -- src` 位元不變.

**行為變更**(寫於 README):啟動失敗之 `Error` 帶 w-playwright 之 `code`(`E_BROWSER_MISSING`、`E_LAUNCH`、`E_LAUNCH_TIMEOUT`、`E_ENV`、`E_PW_VERSION`;`E_LOGON_GUARD` 只用於非 headless shell,本套件不會遇到),訊息為固定詞彙,不再是 Playwright 之原訊息.輸出之 PNG／SVG 不變(標準圖 0 張改變).

**不納入**:`dist/` 為發布時自動產製,本輪未重建(`toolg/gDistRollup.mjs` 已改 external;以相同選項建置至暫存夾,UMD 包為 `require("w-playwright")`,經該包真渲染 p10 一張為合法 PNG).

## 規則 3:測試不連 CDN(2026-11-24,排程第 632 項;全域技能 role-coder-for-test §5.3;2026-11-25 改用共用函式)

**背景**:產品之渲染頁自 jsDelivr 載入 21 個鍵(16 個庫;`src/common/cdn.mjs` 之 `PKG`,版本精確鎖定),p8 另於 Node 端 `fetch` 其 CSS.測試依賴外網,網路不穩時大量轉紅(本機 2026-11-24 外網不穩時全套 81 紅,錯誤為 `dagre`／`G6`／`ELK`／`ReactDOM` 未定義、`Failed to fetch dynamically imported module`).**本規則只改測試端,不改產品**:`src/` 不含任何測試接縫,未經測試接縫時產品仍照舊連 CDN(R-FC-CDN-05 守門).

**設計**:取得、校驗、鎖、路由、`fetch` 補丁等通用機制由自有套件 **w-package-tools-e2e 之 `createCdnLocal`**(`devDependencies ^1.0.51`;介面、限制與時限見其 `README.md` §2.13)提供,**本庫不再自寫**(2026-11-24 之原型 `test/tools/cdnLocal.mjs` 與其 29 案已於 2026-11-25 移除,各案之涵蓋對照見下);本庫只保留「接線」與「與產品網址表之一致性」:
1. **橋接檔 `test/tools/cdn.mjs`**:建立本行程唯一之實例 `cdn`(`manifest: test/tools/cdn.manifest.json`、`cacheDir: test/_cache/cdn`〔以檔案位置定位,不隨 `process.cwd()`〕、`allowLoopback: false`——本套件之頁面皆 `setContent`、不連本機服務,回送位址亦視為外部);`installCdn()`(行程內只裝一次,兩步皆成功才設旗標;**回傳還原函數**——呼叫即撤回兩者、旗標歸零,之後再呼叫 `installCdn()` 即重裝;已裝好時重複呼叫回傳同一還原函數):以 w-playwright(≥1.0.6)之**啟動後鉤子** `wpw.onBrowserCreated((t) => cdn.routeBrowser(t))` 對每個**最終回傳給呼叫端**之 browser 掛路由(本套件之單一啟動出口 `src/common/launchBrowser.mjs` 與測試端直接 `wpw.launchChromium` 皆經此),並 `cdn.patchFetch()`(p8 之 `cdnFetchText`).鉤子與 `setBrowserTypeForTest`(替換、只有堆疊頂之替身被呼叫)正交:測試檔自設之替身(`api-wpwWiring.test.mjs` 之 `makeProbe(true)`)內直接回傳 `next()` 之結果即可,**不自包 `cdn.routeBrowser`**,鉤子之註冊只在橋接檔此一處.鉤子於替身回傳**之後**才對最終回傳者套用(替身內 `next()` 之內層結果當下尚未掛),故 `cdn.isRouted` 須於啟動完成後斷言;替身若回傳非 Playwright 物件之假物件,鉤子之 `routeBrowser` 拋 `E_CDN_ARG` 而啟動 reject `E_LAUNCH_HOOK`,以假物件驗接線之測試須先呼叫還原函數(本庫之替身只拋錯或回傳真 browser,不涉及).R-FC-CDN-04 守門之內容見下表.
2. **清單 `test/tools/cdn.manifest.json`**(126 個網址、125 種內容、21 個根,約 14 MB;sha256 為首次取得時釘選)由共用庫 CLI 依 `test/tools/cdn.roots.mjs`(單一事實來源＝`src/common/cdn.mjs` 之 `PKG` 表)產生:`node node_modules/w-package-tools-e2e/tools/genCdnManifest.mjs --roots test/tools/cdn.roots.mjs --out test/tools/cdn.manifest.json`(需連網;加 `--check` 重新下載比對、不寫檔).
3. **取得點與檢查**:各測試檔之 `before` 以 `this.timeout(cdn.hookTimeoutMs)`(35.5 分;`p10.test.mjs` 之 `before` 串行 `cdn.ensure()` 再啟動舞台頁,故為 `cdn.hookTimeoutMs + wpw.LAUNCH_HOOK_TIMEOUT_MS`〔w-playwright 之含首次安裝之啟動建議時限,1150000 毫秒;兩段最壞時間相加,常數取自 `wpw`、不自寫數字〕)呼叫 `cdn.ensure()` 再取 `cdn.violationMark()`,`after` 以 `cdn.assertNoViolation(mark)` 檢查(涵蓋 `close()` 未呼叫或其錯誤被吞掉者);不沿用 mocha 全域 180 秒.快取 `test/_cache/cdn/<sha256>`(內容定址;不入版控,`.gitignore`／`.npmignore` 皆列),`downloads.jsonl` 每個下載之檔一列(只下載一次之證據);**首次須能連 jsDelivr 下載約 14 MB**,多個 mocha worker 同時首次取得時只由一個行程下載(`.lock` 資料夾鎖,殘留回收、心跳、等候上限皆在共用庫).離線:`W_CDN_OFFLINE=1`(缺檔不連網,直接 `E_CDN_OFFLINE_MISSING`).
4. **npm 包**:依 dspec〈自有套件之npm發布範圍〉第 4 條 `test/tools/` 一律不排除,故 `.npmignore` 為 `/test/*` 加 `!/test/tools/`(`npm pack --dry-run`:`test/tools/` 3 檔入包,`test/pics`／`_cache`／`_tmp` 不入包).

| 條 | 規則 | 測試 |
|---|---|---|
| R-FC-CDN-01 | 清單之 `roots` 與 `cdn.roots.mjs`(＝`cdn.mjs` 之 `PKG` 表)之鍵與含版本網址逐一相同,每個根皆在清單內;清單內 `.mjs` 之相對匯入(含 `import()`)閉包完整 | `test/unit-cdnWiring.test.mjs`(2 案) |
| R-FC-CDN-02 | 本庫之啟動出口(`launchBrowser()`、測試端直接 `wpw.launchChromium`)回傳之 browser 與其頁面皆已 `isRouted`,頁面載入之庫由本地副本供應(`served.browser` 增加);表外網址(含同庫不同版本)被中止、`close()` 拋 `E_CDN_EXTERNAL` 且 `violations` 含逐筆網址、`assertNoViolation` 失敗;使用端自設 `setBrowserTypeForTest` 之替身且直呼 `next()` 者,回傳之 browser 與其頁面亦已 `isRouted` | 同上(4 案) |
| R-FC-CDN-03 | Node 端:`cdnFetchText` 取得之內容 sha256 與清單相同;補丁之 `fetch` 對清單內網址回本地副本(`served.fetch` +1),對表外網址與回送位址(本庫 `allowLoopback: false`)拋 `E_CDN_EXTERNAL` 並記違規 | 同上(3 案) |
| R-FC-CDN-04 | 涵蓋盤點:凡會啟動瀏覽器之測試檔(相對匯入閉包含產線入口,或 `launchChromium(`／`launchChromiumPersistent(`)皆呼叫 `installCdn()`、`cdn.ensure()`、`this.timeout(cdn.hookTimeoutMs…)`、`cdn.violationMark()`、`cdn.assertNoViolation(`(剔除註解);盤點器有合成檔集自檢.**啟動後鉤子之接線**(2026-11-26 起,取代原「替身內每處 `next()` 皆自包 `cdn.routeBrowser(await next())`」):①鉤子已掛——不起 Chrome 之案:替身(不呼叫 `next`)回傳具 `routeBrowser` 介面之假 browser,啟動後 `cdn.isRouted(b)` 為真;替身回傳 `{}` 者啟動 reject `E_LAUNCH_HOOK`(鉤子確在作用且失敗語意如文件);②啟動出口 `cdn.isRouted(browser)`——見 R-FC-CDN-02 之替身直呼 `next()` 案與 `api-wpwWiring.test.mjs` 真路徑案(啟動後斷言 `isRouted(next() 之結果)` 且 `served.browser` 增加);③`installCdn()` 回傳還原函數且只裝一次:還原後啟動之 browser 不再掛路由、全域 `fetch` 還原,再呼叫 `installCdn()` 重新掛上;回滾與身分守衛:`patchFetch` 失敗時撤回已掛之鉤子並原樣拋錯(重試可成功)、舊還原函數於重裝後呼叫不使旗標歸零亦不撤新鉤子;④靜態盤點(剔除註解與字串;本檔自身不掃):橋接檔恰一處 `wpw.onBrowserCreated((t) => cdn.routeBrowser(t))`、不用 `setBrowserTypeForTest`;其餘測試檔(含 `tools/`)不呼叫 `onBrowserCreated(`、不呼叫 `routeBrowser(`(即替身內不自包);盤點器有合成檔集自檢(已掛／未掛／鉤子不路由／橋接檔仍用替身／多處註冊／他檔自註冊／他檔自包／註解與字串不算) | 同上(8 案) |
| R-FC-CDN-05 | `src` 不含 `createCdnLocal`／`w-package-tools-e2e`／`cdn.manifest`／`W_CDN`／`setBrowserTypeForTest`／`installCdn`(產品預設行為不變) | 同上(1 案) |

**原型 29 案移除後之涵蓋對照**(共用庫測試位於 `node_modules/w-package-tools-e2e/test/`,案號於案名之 `[...]`;逐一以 Grep 核對案號與案名存在):

| 原型之案 | 共用庫之案 |
|---|---|
| 快取每檔大小與 sha256 獨立重算;清單格式檢核 | CL05、CL15、CL16;CL01、CL02 |
| 頁面端:表內回本地副本、chunk 式 ESM、表外中止且 `close()` 拋錯、`newContext`、`data:` 不計 | CE01、CE02、CE03、CE04(含 CL32)、CE08(含 CL23、CL29) |
| Node 端 `fetch`:表內回本地副本、表外拋錯、非 http(s) 通過、違規標記 | CL22、CL23／CL23b、CL21 |
| 取得流程:4 行程只下載一次、殘留鎖(行程已結束／心跳逾時)回收、持鎖者持續心跳不誤判、等候逾時、兩回收者交錯、同內容只取一次、逾預算不派發、sha256 不符拒收、快取損毀只重取、離線、時限對齊 | CA01、CL06／CA02、CL07、CL08／CA03／DL07、CL09、CL10／DL06、CL11、CL12、CL13／CL14、CL15／CL16、CL19／CA04、CL04 |
| 清單之鍵＝`cdn.mjs`、ESM 閉包完整、涵蓋盤點、`src` 不含接縫 | **本庫專屬,保留**於 `unit-cdnWiring.test.mjs`(R-FC-CDN-01、04、05) |

**盤點指令**(站點全集):

```
git grep -n -E "cdnScript\(|cdnUrl\(|cdnStyle\(|cdnFetchText\(" -- "src/*/gen.mjs"   # 外部載入站點;預期 25 處(不含 import 列),鍵皆須在清單內
git grep -n "fetch(" -- src                                  # Node 端 fetch;預期僅 src/common/cdn.mjs:67
git grep -n -E "https?://" -- src                            # 外部網址;預期除 w3.org 命名空間外僅 src/common/cdn.mjs:6 之 BASE
git grep -n --untracked "installCdn()" -- test               # 預期 snapshot.mjs、lib.mjs、wflowchart.test.mjs、api-wpwWiring.test.mjs、unit-cdnWiring.test.mjs 各 1 處(另有 tools/cdn.mjs 之定義)
git grep -n --untracked -E "launchChromium(Persistent)?\(|setBrowserTypeForTest\(" -- test src
git grep -n --untracked -E "onBrowserCreated\(|routeBrowser\(" -- test src               # 預期除 unit-cdnWiring.test.mjs(守門與字串)外,程式碼僅 tools/cdn.mjs 之 installCdn 一處 wpw.onBrowserCreated(其餘為註解)
node node_modules/w-package-tools-e2e/tools/genCdnManifest.mjs --roots test/tools/cdn.roots.mjs --out test/tools/cdn.manifest.json --check   # 連網;清單與線上內容一致
```

| 站點(外部載入) | 鍵 | 經由 | 判定 |
|---|---|---|---|
| `src/p1/gen.mjs:141` | mermaid10 | 頁面 `<script src>` | 已套(snapshot.mjs、wflowchart.test、wiring) |
| `src/p2/gen.mjs:141-142` | mermaid11-esm、layout-elk-esm(含 chunk 閉包) | 頁面 `import()` | 已套 |
| `src/p3/gen.mjs:109-110` | graphre、nomnoml | 頁面 | 已套 |
| `src/p4/gen.mjs:38-41` | cytoscape、dagre、cytoscape-dagre、cytoscape-svg | 頁面 | 已套 |
| `src/p6/gen.mjs:134,201-203` | g6、g-lite、g-svg | 頁面(png／svg 兩站點) | 已套 |
| `src/p7/gen.mjs:29-30` | joint、dagre | 頁面 | 已套 |
| `src/p8/gen.mjs:27-29` | logicflow-css、logicflow、dagre | 頁面 | 已套 |
| `src/p8/gen.mjs:446` | logicflow-css | **Node 端 `fetch`** | 已套(R-FC-CDN-03) |
| `src/p9/gen.mjs:21-25` | xyflow-css、react、react-dom、xyflow、dagrejs-dagre | 頁面 | 已套 |
| `src/p10/gen.mjs:26` | elkjs | 頁面(`test/lib.mjs` 之舞台頁亦同) | 已套(p10.test.mjs、lib.mjs) |
| p5(D2/WASM) | — | 無瀏覽器、無 CDN | 不適用 |

**修前紅／修後綠**(2026-11-24 原型輪;2026-11-25 改用共用函式後同結論):斷網情境＝以預載腳本使全域 `fetch` 拒絕 http(s)、並對 `wpw.launchChromium` 回傳之 browser 之 context 掛 `route('**/*')` 一律中止外部請求.①修前(HEAD 之測試未動):`npm test` 62 passing、**311 failing**(15 分 44 秒;`ELK is not defined`、`dagre is not defined`、`Failed to fetch dynamically imported module`…);②修後:斷網強化版(`W_CDN_OFFLINE=1`〔原型輪為 `W_FC_CDN_OFFLINE`〕、全域 `fetch` 對非回送位址拒絕、Chromium 加 `--host-resolver-rules=MAP * ~NOTFOUND` 使任何主機名稱皆無法解析)全套全綠、預載腳本攔截紀錄 0 筆;③清空快取後 `npm test`(平行)全綠,`downloads.jsonl` 125 列、125 種內容各 1 列、1 個行程(發布包解開之目錄配置之冷快取全套亦同);④暖快取全套連跑皆綠.改用共用函式後最終數字見 `sgud/state/state.md`.預載腳本為一次性暫存檔(未入庫);要重做斷網驗收時,以 `NODE_OPTIONS=--import=<預載腳本>` 掛於 mocha 主行程與各 worker.

**變異驗證(2026-11-26,啟動後鉤子接線;就地改檔、跑後以存檔副本還原並逐檔 `cmp` 驗證相同)**:10 類皆轉紅、0 存活——①舊接線(橋接檔仍以 `setBrowserTypeForTest` 替身自包、不掛鉤子;即修前紅,新測試 6 紅;以下①~⑧之紅燈數皆為補⑨⑩案前之實測)②橋接檔不掛鉤子(`restoreHook = () => {}`;8 紅,含 R-FC-CDN-02 三處啟動出口、替身直呼 `next()`、鉤子已掛、失敗語意、還原;另以「啟動加死 proxy」版之 `api-wpwWiring` 真路徑案證明該案獨自轉紅〔頁面載不到繪圖庫:`ELK is not defined`〕,正確橋接檔下同版為綠,過程不連真來源)③鉤子不對 target 呼叫 `cdn.routeBrowser`(`(t) => {}`;7 紅,含靜態盤點之 `bridgeRoutes`)④還原函數不撤鉤子(1 紅:還原後假物件仍使啟動 reject `E_LAUNCH_HOOK`)⑤還原函數不還原 `fetch`(1 紅)⑥`installCdn()` 非冪等、重複呼叫不回傳同一還原函數(1 紅)⑦測試檔於替身內自包 `cdn.routeBrowser(await next())`(靜態盤點 1 紅;行為案仍綠,因 `routeBrowser` 對同一 browser 冪等,故此類只有靜態盤點抓得到)⑧他測試檔自行註冊 `onBrowserCreated`(靜態盤點 1 紅)⑨還原函數之身分守衛移除(舊還原函數於重裝後使旗標歸零;1 紅)⑩`patchFetch` 失敗時不撤回已掛之鉤子(1 紅:殘留鉤子使假物件啟動 reject).⑨⑩為獨立複審指出「兩者原無測試」後補案.**以改前之測試檔(unit-cdnWiring、api-wpwWiring)對新橋接檔重跑**:僅舊靜態守門(寫死「橋接檔含 `setBrowserTypeForTest`」)1 紅,其餘 31 案綠;再對新橋接檔套用變異④⑤⑥組合,仍為同一 31 綠 1 紅——改前之測試抓不到還原／冪等之缺陷,新案補到洞.注意:挑案之 `--grep` 須涵蓋「對照表以外之外部網址」案(其於未路由時會讓頁面直連真來源),本輪一次疏漏見經驗.
**變異驗證(2026-11-25,舊接線,已過時;該些接線改為啟動後鉤子)**(鏡像根 `./tmp`,不動 repo;基準 12 案全綠;錨點不存在或不唯一即報失敗):19 項接線變異全轉紅、0 存活——`snapshot.mjs`／`lib.mjs`／`wflowchart.test.mjs`／`api-wpwWiring.test.mjs` 未呼叫 `installCdn()`、wiring 走真路徑之 `next()` 未包裝、wiring 另有一處未包裝之 `next()`、橋接檔之 `launch` 替身未呼叫 `routeBrowser`／回傳未包裝之 browser、橋接檔未呼叫 `cdn.patchFetch()`、橋接檔未設 `allowLoopback: false`、`cdn.mjs` 版本與清單不一致、`cdn.roots.mjs` 之網址與 `cdn.mjs` 不同、清單少一個 chunk 檔、清單 sha256 被改、`src` 含接縫字樣、`snapshot.mjs` 之 `after` 不檢查違規／取得點未掛 `cdn.hookTimeoutMs`／未取 `violationMark`、`p10.test.mjs` 之 `before` 不呼叫 `cdn.ensure()`.共用庫本身之機制(鎖、取得、路由、補丁)之變異由該庫之測試與變異(119 項)涵蓋.變異腳本為一次性暫存檔(未入庫);要重做時於 `./tmp` 建鏡像根(複製 `test/` 與 `src/`)逐項改鏡像檔再跑 `unit-cdnWiring.test.mjs`.

**修改 `src/common/cdn.mjs`(增刪庫或改版本)之處置**:① 執行上列 `genCdnManifest.mjs`(連網;不加 `--check`)重產清單並入版控,審視差異;② 跑 `test/unit-cdnWiring.test.mjs`(R-FC-CDN-01 轉綠);③ 渲染結果改變者依規則 1 之程序處理標準圖;④ 舊快取檔不會被清(內容定址,無害),要釋放空間時直接刪除 `test/_cache`.

**已知限制**(共用庫 README §2.13〈限制〉):路由只攔 Playwright 看得到之網路請求;SharedWorker 之請求、任何 Worker 內之 WebSocket、`context.request`(`APIRequestContext`)無 route 亦無事件(本套件之頁面皆不用);Node 端只覆寫全域 `fetch`.清單之 sha256 於首次取得時釘選,信任錨為首次產生清單當下之 jsDelivr 內容.`test/snapshot.mjs` 對 p5(無瀏覽器)亦 `cdn.ensure()`,離線且快取缺檔時 p5 亦失敗(輕微).
