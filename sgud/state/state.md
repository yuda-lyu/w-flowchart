# 狀態(現況)

本檔記當前已開發功能之最新狀態:各功能做到哪裡、對應之規則帳本條目與測試檔、已知缺口與待辦、最近一次驗證或發布之版本.只記現況,不寫過程(過程寫入`sgud/exp/experience.md`).規則帳本為藍圖(`sgud/rule/rulebook.md`),兩者比對即知尚未做到者.

## 最近一次驗證(2026-11-26,排程第 651 項:測試之 CDN 路由改用 w-playwright 啟動後鉤子)

- 套件版號 1.0.67(本輪未改版、未發布、未提交;`src/`、`package.json`、`script.txt`、`dist/`、標準圖皆 0 改動;只改測試端 4 檔:`test/tools/cdn.mjs`、`test/unit-cdnWiring.test.mjs`、`test/api-wpwWiring.test.mjs`、`test/p10.test.mjs`;相依為 w-playwright 1.0.6、w-package-tools-e2e 1.0.55).
- `installCdn()` 改以 `wpw.onBrowserCreated((t) => cdn.routeBrowser(t))` 掛路由(鉤子之註冊集中於橋接檔一處),回傳還原函數;刪除 `setBrowserTypeForTest` 替身內自包 `cdn.routeBrowser(await next())` 之接線(橋接檔與 `api-wpwWiring.test.mjs`)與其「每處 `next()` 皆包裝」之靜態守門;改為「鉤子已掛、啟動出口 `cdn.isRouted(browser)`」守門(規則帳本 R-FC-CDN-04,8 案;R-FC-CDN-02 增 1 案).`p10.test.mjs` 之 `before` 時限改 `cdn.hookTimeoutMs + wpw.LAUNCH_HOOK_TIMEOUT_MS`(串行相加).
- 全套 `npm test`:**391 passing、0 failing、0 pending**(約 3 分;385 舊案 + 6 新案:`unit-cdnWiring.test.mjs` 12 → 18 案);`npm pack` 發布包解開之目錄配置(複製 `test/` 含 `_cache` 與 `node_modules` 之非連結副本)391 passing;斷網情境(`W_CDN_OFFLINE=1`、全域 `fetch` 對非回送位址拒絕、Chromium 加 `--host-resolver-rules=MAP * ~NOTFOUND`)391 passing,啟動 299 次、被阻擋之 `fetch` 0 筆.受影響三檔(`unit-cdnWiring`、`api-wpwWiring`、`p10`)連跑 5 次皆 82 passing.標準圖 0 張改變.變異驗證見規則帳本規則 3.
- eslint:四檔無新增(`p10.test.mjs` 既有 5 項同改前).

## 前次驗證(2026-11-25,排程第 632 項續:測試不連 CDN 改用共用函式;已被上段更新接線方式與案數)

- 套件版號 1.0.63(本輪未改版、未發布、未提交;`src/`、`script.txt`、`dist/` 皆 0 改動;`package.json` 只加 `devDependencies.w-package-tools-e2e ^1.0.51`,`package-lock.json` 隨之更新,wsemi 1.9.74 → 1.9.75 為該套件所依).
- 「測試不連 CDN」改由自有套件 **w-package-tools-e2e 之 `createCdnLocal`**(README §2.13)提供,本庫移除自寫之原型(`test/tools/cdnLocal.mjs`、`genCdnManifest.mjs`、`cdnAcquireChild.mjs`、`cdnLocal.manifest.json`、`test/unit-cdnLocal.test.mjs` 29 案);保留本庫專屬之接線:橋接檔 `test/tools/cdn.mjs`、`test/tools/cdn.roots.mjs`(根網址＝`src/common/cdn.mjs` 之 `PKG` 表)、清單 `test/tools/cdn.manifest.json`(共用庫 CLI 產生,內容與原型之清單 126 檔逐一相同)、`test/unit-cdnWiring.test.mjs`(12 案);`snapshot.mjs`、`lib.mjs`、`p10.test.mjs`、`wflowchart.test.mjs`、`api-wpwWiring.test.mjs` 改接 `cdn`.規則見規則帳本規則 3(R-FC-CDN-01~05).
- 全套 `npm test`:**385 passing、0 failing、0 pending**(約 3 分;373 舊案 + 12 新案).清空快取後平行全套 385 passing,`downloads.jsonl` 125 列/125 種內容各 1 列/1 個行程;暖快取連跑 3 次皆 385 passing;發布包解開之目錄配置(`npm pack` 解開後複製 `test/` 與 `node_modules`)385 passing;斷網情境(`W_CDN_OFFLINE=1`、全域 `fetch` 對非回送位址拒絕、Chromium 加 `--host-resolver-rules=MAP * ~NOTFOUND`)385 passing,攔截紀錄 0 筆;`unit-cdnWiring.test.mjs` 單檔連跑 20 次皆 12 passing.標準圖 0 張改變(`git status --short test/pics` 無輸出).19 項接線變異全轉紅.
- 測試首次執行會自 jsDelivr 下載 126 個網址(約 14 MB)至 `test/_cache/cdn/`(`W_CDN_OFFLINE=1` 時不連網);修改 `src/common/cdn.mjs` 後須以共用庫 CLI 重產清單(規則 3).

## 前次驗證(2026-11-25,排程第 632 項:測試不連 CDN,自寫原型版;已被上段取代)

- 全套 402 passing(373 + 29 新案)、冷快取／暖快取／發布包配置／斷網情境皆綠,19 次全套 1 次失敗(p6 `flat-tb` 逾時,見〈已知缺口〉);修前(HEAD 之測試,斷網阻擋器):62 passing、311 failing(15 分 44 秒).

## 前次驗證(2026-11-13,排程第 442 項:改經 w-playwright 啟動)

- 套件版號 1.0.45(該輪未改版、未發布、未提交;`dist/` 未重建).
- 渲染瀏覽器一律經自有套件 **w-playwright ^1.0.1**(實裝 1.0.1;其依賴 `playwright-core` 精確 1.64.1,與前版 `playwright` 1.64.1 同版),本套件 `package.json` 已無 `playwright`／`playwright-core`(規則 2).
- 全套 `npm test`(`mocha --parallel "test/*.test.mjs" --timeout 180000`):**373 passing、0 failing、0 pending**(約 3.5 分;其中新增 24 案:`test/api-wpwWiring.test.mjs` 20 案、`test/unit-wpwOnly.test.mjs` 4 案).標準圖 0 張改變(`git status --short test/pics` 無輸出).
- 只啟動 headless shell(無頭預設),未啟動真 Chrome／Edge／完整 Chromium;全套前後錯誤密碼次數皆 0.

## 更早之驗證(2026-11-09;p9 標準圖基線之來源)

- 套件版號 1.0.38(該輪未改版、未發布).
- 全套 `mocha --parallel "test/*.test.mjs" --timeout 180000`:**349 passing、0 failing、0 pending**(約 2.5 分).
- 渲染瀏覽器(該輪為 `dependencies.playwright` **^1.64.1**,lock 1.64.1;現已改由 w-playwright 釘住同版):Chromium 156.0.8078.4、headless shell 1248;前版 1.63.0 為 Chromium 153.0.8010.12、1243.升版後 p9 有 20 案比對失敗(151~3872 像素差,容差 60),經對照舊版(1.63.0 全 31 案綠且與標準圖逐像素 0 差)分類為 BROWSER-ONLY,逐張目視與 DOM 幾何對照確認僅連線標籤之文字次像素定位不同(節點、連線、文字、折行、尺寸不變)後,**重產 p9 標準圖 20 張**(`test/pics/p9/`):
  - 合成 8:`diamond`、`edges-mix`、`cycle`、`english`、`group-edge`、`newline-label`、`newline-multi`、`newline-lr`.
  - 範例圖 12:電商平台架構圖、微服務叢集架構圖、物聯網平台架構圖、系統分層架構圖、訂單處理流程圖、會員註冊流程圖、資料清洗流程圖、工單處理流程圖、模組組成圖、頁面導覽關聯圖、資料流向圖、權限角色關聯圖.
  - 其餘 303 張標準圖(含 p10 與 p9 之 11 案)0 變更;`git diff --stat test/pics` 恰為上列 20 張.
- 影像比對度量已隨 `devDependencies.pixelmatch` 升至 **8.0.0**(lock 釘 8.0.0),判定選項統一為 `{ threshold: 0.1, includeAA: false, checkerboard: true }`,容差 `MAXDIFF = 60` 不變;該次升版時 323 張標準圖 0 張比對失敗、0 張重產.
  其中含半透明像素(0 < alpha < 255)者 66 張(p4 5 張、p5 29 張、p6 32 張),亦全數通過.

## 功能與狀態

| 功能 | 狀態 | 規則帳本 | 測試 |
|---|---|---|---|
| 以資料自動佈局並繪製流程圖(`src/WFlowchart.mjs`,p1~p10 十條產線) | 可用 | — | `test/wflowchart.test.mjs`、`test/p1~p9.test.mjs`、`test/p10.test.mjs` |
| p1~p9 渲染回歸(PNG 快照基準) | 已涵蓋 16 合成案 + 12 範例圖,基準為 `test/pics/<mode>/<案>.png` | 規則 1 | `test/snapshot.mjs`(共用層)經各 `pN.test.mjs` 調用 |
| p10 渲染回歸(結構不變量 + SVG 逐字 + PNG 快照) | 已涵蓋合成案、菱形、方位、真圖,另含菱形 13 種進出組合單元驗證 | 規則 1 | `test/p10.test.mjs` |
| 影像比對度量(pixelmatch 8) | 已套用於兩處呼叫點,守門為上列兩測試之比對本身 | 規則 1 | 同上 |
| 渲染瀏覽器(w-playwright ^1.0.1 → playwright-core 1.64.1) | p1~p10 標準圖綁定 Chromium 156 headless shell;換版處置程序見規則 1(換版即升 w-playwright) | 規則 1 | 同上 |
| 瀏覽器啟動經 w-playwright(單一啟動點 `src/common/launchBrowser.mjs`,10 站點) | 已完成;接線測試 20 案＋盤點 4 案;逐站點變異 11 次皆轉紅;`src/test/toolg` 直接匯入 playwright 0 處 | 規則 2(R-FC-WPW-01~04) | `test/api-wpwWiring.test.mjs`、`test/unit-wpwOnly.test.mjs` |
| 測試不連 CDN(共用函式 `createCdnLocal` 之接線:啟動後鉤子路由、Node 端 fetch 補丁、清單、離線) | 已完成;接線測試 18 案;鉤子接線 10 類變異全轉紅;斷網情境、冷快取、發布包配置全套皆綠 | 規則 3(R-FC-CDN-01~05) | `test/unit-cdnWiring.test.mjs`(橋接檔 `test/tools/cdn.mjs`);各 pN 測試經 `snapshot.mjs`／`lib.mjs` 接線 |

## 已知缺口與待辦

- **p6 `flat-tb` 之偶發逾時(2026-11-25,根因未證實)**:第一次冷快取全套中 p6 之第一案(`[合成] flat-tb`)逾 180 秒(其餘 396 案通過);同案單檔重跑 10 次全過,其後 18 次全套(含冷快取 4 次)0 失敗(2026-11-25 改用共用函式後再 6 次全套含冷快取 1 次亦 0 失敗).該案頁面僅載入 `g6` 一檔並於 `page.evaluate(renderFig)`／`snap` 等待 G6,這兩處與 `document.fonts.ready` 皆無逾時(`src/p6/gen.mjs:183-188`),頁面端懸置時會拖到 mocha 之 180 秒.未發現路由或快取路徑會致懸置之機制,也無法排除為既有之 G6／瀏覽器偶發;失敗率 1/25 次全套.再現時請保留當次 log 並比對是否為首輪啟動之尖峰負載.
- 取得鎖之「判定殘留與改名之間」仍有極小空窗(共用庫 README §2.13〈限制〉⑧),至多重複下載,不損檔.
- `test/snapshot.mjs`(含 p5)於 `before` 一律 `cdn.ensure()`;p5(D2/WASM)不用 CDN,離線且快取缺檔時 p5 也會因此失敗(輕微).

- `test/pics/<mode>/<案>.alt.png`(替代基準)目前僅 1 張(`test/pics/p6/物聯網平台架構圖.alt.png`),用於存在佈局雙吸子非決定性之引擎;主基準不符時改比對 alt(`test/snapshot.mjs` 之 `definePngSuite`).判定度量所致之失敗時,主基準與 alt 兩者都要對當次輸出各算一次(規則 1 之重產程序).
- 比對失敗時之證據形式兩處不同:`test/snapshot.mjs` 寫出 `<案>.new.png`(當次輸出)與 `<案>.diff.png`;`test/p10.test.mjs` 只寫 `<案>.diff.png`,**不存當次輸出**.p10 之 PNG 比對失敗要分類度量所致與否時,須先重跑取得當次輸出(見經驗).
- 兩測試之比對函式(`pngCompare`)與選項各自內嵌一份,升度量時須同步改兩處(規則 1 之盤點指令以此防分叉).
- p9 含連線標籤之標準圖,其標籤次像素定位隨瀏覽器版本而變,標準圖與 Chromium 156 綁定(本次換版 p1~p8、p10 未受影響);再換瀏覽器版本時依規則 1 之程序分類與重產.
- 測試每案各自啟動 headless shell(全套約 245 次),同檔共用瀏覽器屬效能(設計 §5.2 選做),本輪未做;只啟動 headless shell,不觸發 `LogonUser`.
- 規則 1 之瀏覽器換版對照改為暫裝舊版 w-playwright(2026-11-13 起),該作法尚未實跑(私有倉庫現僅確認有 1.0.1).
- `dist/` 為發布時自動產製,本輪未重建(仍為舊版,含 `require("playwright")`);`toolg/gDistRollup.mjs` 之 external 已改 `w-playwright`,以相同選項建置至暫存夾驗證:UMD 包 `require("w-playwright")`、無 playwright 字樣,經該包渲染 p10 一張(headless shell)得合法 PNG(1110x1652).
- `test/snapshot.mjs` 通過之案不記錄像素計數,通過案距容差之餘裕無資料;需要時以暫存腳本逐案算計數(見經驗).
