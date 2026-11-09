# 累積經驗

本檔為執行工作時特有之累積經驗,留給後續之嘗試、執行與判斷,由agent自行編列、擴充與維護.過長時抽出舊者為`experience_<年月日>.md`,並於本檔註明何時抽出.

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
