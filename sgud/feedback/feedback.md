# 回饋

任務中發現之自有套件、全域技能、全域設定之調整與抽提提案.只增不改,處置結果另記一列.回饋是紀錄與提案,不等於自行修改.

| 日期 | 類別 | 對象 | 內容 | 依據 |
|---|---|---|---|---|
| 2026-11-09 | 自有套件 | w-flowchart(本套件)`test/p10.test.mjs` | PNG 比對失敗時只寫 `<案>.diff.png`,不存當次輸出(`test/snapshot.mjs` 則寫 `<案>.new.png`).度量變更後若 p10 有失敗,無從以「標準圖 vs 當次輸出」雙算 7/8 分類,須先重跑.建議 p10 失敗時亦寫 `<案>.new.png`,與 snapshot 一致(屬測試輔助行為改動,未於本輪處理) | `test/p10.test.mjs:88-89`、`test/snapshot.mjs:61` |
| 2026-11-09 | 自有套件 | w-flowchart(本套件)兩處 `pngCompare` | `test/p10.test.mjs:34-41` 與 `test/snapshot.mjs:25-32` 內嵌兩份相同之比對函式與 `MAXDIFF`,升度量須兩處同步改;宜收斂為單一測試輔助模組(如 `test/lib.mjs` 匯出),或改由上游 e2e 比對套件提供(其已集中選項) | `git grep -n "pixelmatch(" -- test` 恰 2 處 |
