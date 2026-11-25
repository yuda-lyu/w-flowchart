# 累積經驗

本檔為執行工作時特有之累積經驗,留給後續之嘗試、執行與判斷,由agent自行編列、擴充與維護.過長時抽出舊者為`experience_<年月日>.md`,並於本檔註明何時抽出.

## 2026-11-25 測試不連 CDN 改用共用函式 `createCdnLocal`(排程第 632 項續)

- **結果**:移除自寫原型(約 450 行取得／鎖／路由／補丁 + 29 案),改用 w-package-tools-e2e `^1.0.51` 之 `createCdnLocal`;本庫只留橋接檔 `test/tools/cdn.mjs`、`cdn.roots.mjs`、清單 `cdn.manifest.json` 與 12 案接線測試 `unit-cdnWiring.test.mjs`;全套 373 → 385 passing,標準圖 0 張改變,`src` 0 行.規則見規則帳本規則 3(R-FC-CDN-01~05).
- **遷移要點**:①清單格式相容——以共用庫 CLI 重產之清單與原型清單 126 檔 sha256／大小逐一相同,`--check` 一致,下載日誌 125 列(同內容之兩網址只取一次);②`routeBrowser` 為 async,於 `setBrowserTypeForTest` 之 `launch` 替身內 `await cdn.routeBrowser(await next())`,疊放之替身(`api-wpwWiring.test.mjs`)其 `next()` 不經下層替身,逐處自行包裝並斷言 `cdn.isRouted`;③共用庫預設放行回送位址(原型一律視為外部),本庫頁面皆 `setContent`、不連本機服務,故於橋接檔設 `allowLoopback: false` 維持「預設拒絕」,並以案例斷言回送位址之 `fetch` 亦拋 `E_CDN_EXTERNAL`;④橋接檔與 `cdn` 實例為模組層單例,mocha worker 重用於多檔時共用之,故各檔以 `violationMark()`／`assertNoViolation(mark)` 界定本檔之違規(同 worker 之 `unit-cdnWiring` 刻意製造違規不影響他檔);⑤`installed` 旗標須在兩步(接縫、`patchFetch`)皆成功後才設,否則拋錯後同 worker 之後續檔 `installCdn()` 變成空操作而靜默連真 CDN(複審指出).
- **不能憑內容比對證明「取自本地」**:版本釘死,`cdnFetchText` 取得內容之 sha256 與清單相同,不論取自本地副本或真 CDN 皆成立;以 `cdn.stats().served.fetch` 之增量(補丁供應次數)才有鑑別力.頁面端同理用 `served.browser`.
- **涵蓋盤點之強化**(複審):除「呼叫 `installCdn()`」外,另須有 `cdn.ensure()`、`this.timeout(cdn.hookTimeoutMs…)`、`cdn.violationMark()`、`cdn.assertNoViolation(`(剔除註解),且 `launchChromiumPersistent(` 亦視為啟動;使用 `setBrowserTypeForTest` 之檔每一處 `next()` 皆須為 `cdn.routeBrowser(await next())`.
- **變異腳本**:鏡像根;錨點隨改碼失效時腳本報「錨點出現 0 次」(不靜默略過),更新錨點後重跑;19 項接線變異全轉紅.共用庫本身之機制(鎖、取得、路由)不在本庫重複變異,各舊案之涵蓋對照以案號逐一 Grep 核對(規則 3).
- **機器忙碌**:本機同時有他套件之 agent 跑測試,每次全套前 CPU 常逾 70%,依規定等待至 ≤70%(單輪 10~25 分);鏈腳本內建檢查與等待,不要手動插入其他測試.
- **`npm i -D` 副作用**:`package-lock.json` 頂層 `version` 同步為 `package.json` 之 1.0.63(原 1.0.62,非改版);共用庫依賴 wsemi `^1.9.75`,lock 內 wsemi 由 1.9.74 升為 1.9.75,`package.json` 之 `wsemi ^1.9.74` 不變.

## 2026-11-25 測試不連 CDN(排程第 632 項;自寫原型,已由上段取代)

- **結果**:不改 `src`(0 行),全套 373 → 402 passing(新增 `test/unit-cdnLocal.test.mjs` 29 案),標準圖 0 張改變;規則見規則帳本規則 3.
- **為何不改 src、也不用 fsEnsureBins**:w-playwright 已有 `setBrowserTypeForTest`(fake.launch 收 `(opt, next)`,回傳之 browser 可包裝),於其回傳之 browser 之 `newContext`／`newPage` 掛 `context.route('**/*')` 即可,產品零改動;Node 端 p8 之 `fetch` 於呼叫當下才取全域,測試補丁 `globalThis.fetch` 即生效.wsemi `fsEnsureBins` 只收 GitHub 資產／40 碼提交原始檔網址,jsDelivr 被拒;改用 `fsDownloadFileVerify`(sha256＋大小校驗、暫存檔、原子更名)加自有鎖資料夾.
- **陷阱(皆實際踩到或複審指出)**:①`setBrowserTypeForTest` 之替身**疊放**時,上層替身之 `next()` 直接走真啟動、不經下層替身,故 `api-wpwWiring.test.mjs` 走真路徑之案須自行 `wrapBrowserCdnLocal(await next())`,並以盤點測試逐處檢查;②`fsDownloadFileVerify` 於每次請求取全域 `fetch`,補丁後之取得下載須傳保存之原始 `fetch`(`realFetch`),否則被自己攔截;③mocha `--parallel` 之 worker 會重用於多個測試檔,ESM 模組只載入一次,故**不能**以 root hook 註冊 after 檢查,改為各檔 `before` 取 `cdnViolationMark()`、`after` 呼叫(以「自標記起之新增」界定);④Playwright 之 `route` 不對 `data:` 觸發,Worker 內與 WebSocket 之請求不一定被攔(本套件之頁面皆不用);⑤mermaid 11 為 chunk 式 ESM(`import()` 載入),對照表須含相對匯入閉包(126 個網址,另有 1 組同內容之兩網址),由產生器掃 `from`／`import()` 之相對路徑求得,否則離線時缺 chunk;⑥取得鎖之測試**不得**斷言「某行程從未取到鎖」——等候者於持鎖者釋放後取到鎖(清單已備妥、無檔可下載)為合法交錯,斷言須寫成不變式(不回收、不下載、每檔只請求 1 次);該錯誤由變異驗證時無關變異之偶發失敗露出;⑦判定殘留鎖與回收之間若直接 `rm`,後到之回收者會刪掉先到者剛建立之新鎖(複審指出,以兩個回收者之確定性交錯測試重現),改為改名搬走後核對 token,不符即改回;⑧`git grep` 預設不搜未追蹤檔,未入版控之新檔須 `--untracked`.
- **修前紅燈之做法**:HEAD 之測試不改,以 `NODE_OPTIONS=--import=<預載腳本>` 於 mocha 主行程與各 worker 預載「斷網阻擋器」(包裝 `wpw.launchChromium` 回傳之 browser 之 context 一律 `abort`、全域 `fetch` 拒絕 http(s)):`npm test` 62 passing、311 failing(15 分 44 秒,p10 等 `window.__ready` 與各產線 `waitForFunction` 逾時);阻擋器改包 `wpw.launchChromium` 屬性(而非用接縫)才能涵蓋疊放之替身.修後之斷網驗收改用強化版:全域 `fetch` 對非回送位址拒絕(須先於 `cdnLocal.mjs` 載入,使其保存之 `realFetch` 即為被封鎖者)、Chromium 加 `--host-resolver-rules=MAP * ~NOTFOUND`(使路由未接住之請求即真失敗)、`W_FC_CDN_OFFLINE=1`.
- **發布包配置**:`.npmignore` 排除 `/test/`,發布包不含測試;沙箱為 `npm pack` 解開後複製 `test/`(排除 `_cache`、`_tmp`)與 `node_modules`(274 MB、約 2.5 萬檔,以 robocopy 複製、非連結;robocopy 離開碼 1 為成功),於沙箱根以 `node node_modules/mocha/bin/mocha.js --parallel "test/*.test.mjs" --timeout 180000` 跑.
- **p6 `flat-tb` 逾時一次**:見 `sgud/state/state.md`〈已知缺口〉;不以放寬逾時或重試掩蓋.
- **派工守門**:Bash 內含 heredoc 字樣(即使只是想看檔尾)與含 `start ` 字樣之 grep 樣式會被主控守門擋下;讀檔用 Read／Grep 工具,查進度檔以 Read.

## 2026-11-13 改經 w-playwright 啟動瀏覽器(排程第 442 項;移除 playwright 直接依賴)

- **結果**:10 個啟動點收斂為 `src/common/launchBrowser.mjs`(內部 `wpw.launchChromium({ headless: true })`);`package.json` 移除 `playwright`、加入 `w-playwright ^1.0.1`;全套 349 → 373 passing(新增 24 案),標準圖 0 張改變(同 playwright-core 1.64.1、同 headless shell 1248,只多守門功能).規則見規則帳本規則 2.
- **修前紅燈不啟動任何瀏覽器**:先裝 w-playwright(保留 playwright)並寫接線測試,以 `PLAYWRIGHT_BROWSERS_PATH` 指向空資料夾跑修前程式——舊站點直接呼叫 `chromium.launch()` 於「Executable doesn't exist」處失敗(尚未起行程),測試依「替身應被呼叫」「選項含守門」轉紅(1 passing、23 failing);修後同指令之 24 案全綠.
- **接線測試寫法**:`wpw.setBrowserTypeForTest({ launch: async (o, next) => … })` 之替身記錄 `o`(w-playwright 合併後之選項)後拋錯,經公開入口 `WFlowchart(inp, { mode, output })` 驅動各產線;替身拋錯依 w-playwright 規則轉為帶 `code: 'E_LAUNCH'` 之 Error,由產線原樣往外(不被產線吞掉或改包).替身拋出含 `Executable doesn't exist at` 之訊息則轉為 `E_BROWSER_MISSING`(替身層不自動安裝).`next()` 以合併後選項走真路徑.必須斷言替身呼叫次數 > 0,否則依賴樹有兩份 w-playwright 或站點繞過時測試空過.
- **逐站點變異**:以暫存腳本(`./tmp/pm-flc/mutate.mjs`,結束即清)把第 k 個 `await launchBrowser()` 改為拋 `E_LAUNCH` 之立即函式(使判別只剩「替身被呼叫」),跑接線測試取 json 報告,還原後以 `git diff -- src | md5sum` 前後相同驗證;單站點紅 1~2 案(p6 兩站點各 1、p9 1、其餘 2),共同啟動點紅 17 案.
- **ESM／CJS 介接**:`import wpw from 'w-playwright'` 得含 7 個函式之物件(w-playwright 之 UMD 主檔 `module.exports` 即該物件);外部化後本套件 UMD 為 `require("w-playwright")`、以 `r.launchChromium(…)` 呼叫,暫存建置＋實渲染 p10 驗證可用.不要把 w-playwright 打包進 dist(須使 playwright-core 精確版本留在 w-playwright).
- **陷阱**:①`npm i` 會把 `package-lock.json` 頂層 `version` 同步為 `package.json` 之版本(本輪 1.0.44 → 1.0.45,非手改);②w-playwright 於 playwright-core 版本 ≠ 內附表即 `E_PW_VERSION`,故規則 1 之瀏覽器換版對照不能只 `npm i --no-save playwright-core@舊版`,須換整個 w-playwright(尚未實跑);③`rg` 於本機僅為殼層函式,`which rg` 查不到不代表不能用.

## 2026-11-09 playwright 升 1.64.1(渲染瀏覽器換版,Chromium 153 → 156)

- **結果**:p9 之 31 案中 20 案(含連線標籤者)比對失敗(151~3872 像素差);暫裝 1.63.0 後 31 案全綠且與標準圖逐像素 0 差(標準圖由舊版產出、渲染位元決定性)→ BROWSER-ONLY,逐張確認後重產該 20 張;其餘 303 張 0 變更;重產後全套 349 passing.處置程序已寫入規則 1.
- **成因**:p9(React Flow)連線標籤為 SVG `text`,以 `getBBox` 量測後置中;Chromium 156 量得之寬高與 153 差 ≤ 1.4 CSS px,標籤底板與字形原點隨之位移 ≤ 0.9 CSS px(整數 DPR 2 下約 1~2 裝置像素).同一行程傾印兩版 DOM 矩形可證:節點、群組、連線路徑 0 變動,只有 `edge-textwrapper`/`edge-textbg`/`edge-text` 及其外層 `edge` 群組之矩形有差;差異像素 100% 落在標籤矩形內.無連線標籤之 11 案 0~2 像素差.
- **做法**:並存兩版不必來回重裝——`npm i --no-save pw_old@npm:playwright@1.63.0` 之別名在同一暫存腳本內各 import 一次;結束後 `npm i --no-audit --no-fund` 修剪並核對 `git diff -- package.json package-lock.json` 與動工前相同.單檔測試只在失敗時回報像素計數,要全案計數與餘裕須用暫存腳本逐案算.
- **陷阱**:mocha `--grep` 傳純字串會被跳脫成字面比對,要用 `"/(a|b|c)$/"` 才是正規式;`UPDATE_BASELINE=1` 下 passing 數即為被重產張數,應與候選數相等.

## 2026-11-09 pixelmatch 升 8(比對度量改變)

- **結果**:`devDependencies.pixelmatch` `^7.2.0` → `^8.0.0`(lock 釘 8.0.0),兩處比對呼叫選項改 `{ threshold: 0.1, includeAA: false, checkerboard: true }`,容差 `MAXDIFF = 60` 不變.升版後全套 349 passing、0 failing;323 張標準圖 0 張失敗、0 張重產.
- **風險預判落空**:323 張中 66 張含半透明像素(alpha 在 0~255 之間;p4 5 張、p5 29 張、p6 32 張,另有 35 張含全透明像素),原預期度量與半透明背景處理兩項都改變會讓一部分比對失敗,實跑全數通過.不能由此推論 8 與 7 計數相同:測試只在計數超過容差時才回報細節,通過者之實際計數未被記錄,故無「餘裕」資料.日後若需知離容差多遠,須另寫暫存腳本逐案算計數,不要改測試.
- **取證不對稱**:`test/snapshot.mjs` 失敗時存 `<案>.new.png`(當次輸出)與 `.diff.png`;`test/p10.test.mjs` 只存 `.diff.png`.p10 之 PNG 失敗要做 7/8 雙算分類時,先重跑取得當次輸出,不可只拿 diff 圖當證據.
- **升度量無須安裝舊版**:全綠時不需暫裝 `pixelmatch7`(`--no-save` 別名);只在有失敗要雙算分類時才裝,用完移除並確認 `package.json`、lock 無殘留(規則 1).
- **`npm install pixelmatch@8.0.0` 副作用**:npm 會把 `package-lock.json` 頂層 `version` 同步為 `package.json` 之版號(本次 1.0.36 → 1.0.37,版號本身未動)、並在 `package.json` 檔尾補換行,diff 內出現屬正常,非改版.
