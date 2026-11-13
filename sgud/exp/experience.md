# 累積經驗

本檔為執行工作時特有之累積經驗,留給後續之嘗試、執行與判斷,由agent自行編列、擴充與維護.過長時抽出舊者為`experience_<年月日>.md`,並於本檔註明何時抽出.

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
