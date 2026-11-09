# 回饋

任務中發現之自有套件、全域技能、全域設定之調整與抽提提案.只增不改,處置結果另記一列.回饋是紀錄與提案,不等於自行修改.

| 日期 | 類別 | 對象 | 內容 | 依據 |
|---|---|---|---|---|
| 2026-11-09 | 自有套件 | w-flowchart(本套件)`test/p10.test.mjs` | PNG 比對失敗時只寫 `<案>.diff.png`,不存當次輸出(`test/snapshot.mjs` 則寫 `<案>.new.png`).度量變更後若 p10 有失敗,無從以「標準圖 vs 當次輸出」雙算 7/8 分類,須先重跑.建議 p10 失敗時亦寫 `<案>.new.png`,與 snapshot 一致(屬測試輔助行為改動,未於本輪處理) | `test/p10.test.mjs:88-89`、`test/snapshot.mjs:61` |
| 2026-11-09 | 自有套件 | w-flowchart(本套件)兩處 `pngCompare` | `test/p10.test.mjs:34-41` 與 `test/snapshot.mjs:25-32` 內嵌兩份相同之比對函式與 `MAXDIFF`,升度量須兩處同步改;宜收斂為單一測試輔助模組(如 `test/lib.mjs` 匯出),或改由上游 e2e 比對套件提供(其已集中選項) | `git grep -n "pixelmatch(" -- test` 恰 2 處 |
| 2026-11-09 | 自有套件 | w-flowchart(本套件)`test/snapshot.mjs`、`test/p10.test.mjs` | 比對通過之案不記錄像素計數,升度量或瀏覽器後無法得知通過案距容差(`MAXDIFF = 60`)之餘裕,只能另寫暫存腳本逐案重算.建議加可選之環境變數(預設關閉、不改現行行為)印出每案計數,與上一則收斂比對函式一併處理(屬測試輔助改動,未於本輪處理) | `test/snapshot.mjs:25-32`;本輪以暫存腳本得 31 案全表(11 案 0~2 像素、20 案 110~3872 像素) |
| 2026-11-09 | 全域技能 | role-coder-for-test(§2 pixel baseline)/ role-coder-for-test-e2e 之 pixel-mismatch-diagnosis | 現有「超容差七步」偏 e2e 流程;對非 e2e 之渲染回歸(單檔快照)在**瀏覽器換版**時缺可重跑之分類作法.建議補:①暫裝舊版取對照(BROWSER-ONLY / BOTH-FAIL);②同一行程並存兩版(npm 別名)傾印 DOM 版面矩形,證明節點與連線 0 變動;③差異像素落點遮罩(差異是否全在版面有變動之元素內);④新舊並排放大圖.本套件已將此寫入 `sgud/rule/rulebook.md` 規則 1 可供抽提 | `sgud/rule/rulebook.md` 規則 1 第 2、5 點;本輪 20 張之證據 |
