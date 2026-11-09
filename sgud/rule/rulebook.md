# 規則帳本

本檔為套件設計與開發階段之規則帳本(藍圖),為要求程式碼須長成什麼樣,或由規格產出之測試(項目/說明/流程)有哪些,包含軸、單一擁有者、已知限制、破壞性變更紀錄,以及對應是哪些測試檔案或指令等,由agent自行編列、擴充與維護.當前已做到哪些記於`sgud/state/state.md`.過長時依類型拆為`rulebook_<類型>.md`,本檔只留索引.

## 規則 1:PNG 快照基準之比對度量(pixelmatch 8)

**規則**:測試中所有 PNG 像素比對一律以 pixelmatch 8 之下列選項判定,容差(反鋸齒雜訊像素上限)`MAXDIFF = 60`:

```js
pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1, includeAA: false, checkerboard: true })
```

- `threshold: 0.1`、`includeAA: false`、`checkerboard: true` 皆**明寫**,不依賴函式庫預設(8 之 `checkerboard` 預設為 true,明寫為避免日後預設改變而悄悄改變判定).
- **度量變更(破壞性,2026-11-09)**:pixelmatch 8 之色差度量由 YIQ 改為 OKLab HyAB,無選項可還原 7 之判定.8 比 7 敏感之處:近黑區 16~31 級明度差、飽和色 16~31 級色偏;透明背景下半透明內容之真實改變 8 抓得到而 7 抓不到(`checkerboard: true`).每通道 ≤ 12 級之雜訊兩版皆不計.參數與容差之取捨來自上游自有套件(w-package-tools-e2e)之量測,本套件沿用同值,不自行放寬.
- 不放寬 `MAXDIFF` 與 `threshold` 去吸收度量差異;不整批重產.

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

**升度量後標準圖比對失敗之處置**(只在度量變更、套件升版時適用):
1. 先跑既有測試,全綠者無須處理.
2. 有失敗者:暫裝舊版對照(`npm i --no-save pixelmatch7@npm:pixelmatch@7.2.0`,不寫入 `package.json`),對「標準圖 vs 當次輸出」以 7 與 8 各算一次(同一組選項).`snapshot.mjs` 失敗時 `<案>.new.png` 為當次輸出;`p10.test.mjs` 只存 `<案>.diff.png`,須先重跑取得當次輸出;有 `<案>.alt.png` 者主基準與 alt 都要算.
3. 分類:METRIC-ONLY(7 之計數 ≤ 容差 < 8 之計數)為重產候選;兩版計數皆 > 容差(BOTH-FAIL)非度量所致,依一般流程查因,**不得以重產處理**.
4. 只重產 METRIC-ONLY 且逐張目視確認畫面內容確實未改變者:`UPDATE_BASELINE=1` 搭配 `--grep <案名>`(`it` 標題為 `[合成|範例圖|菱形|方位|真圖] <名>`)只跑該案;重產後 `git diff --stat test/pics` 須只含這些張.
5. 結束前移除暫裝之舊版,`package.json` 與 lock 不得含 `pixelmatch7`.

**對應測試**:`test/p10.test.mjs`、`test/p1.test.mjs`~`test/p9.test.mjs`(經 `test/snapshot.mjs`);指令 `npm test`.
