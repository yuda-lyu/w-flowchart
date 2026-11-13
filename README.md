# w-flowchart
A package for flowchart.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-flowchart.svg?style=flat)](https://npmjs.org/package/w-flowchart) 
[![license](https://img.shields.io/npm/l/w-flowchart.svg?style=flat)](https://npmjs.org/package/w-flowchart) 
[![npm download](https://img.shields.io/npm/dt/w-flowchart.svg)](https://npmjs.org/package/w-flowchart) 
[![npm download](https://img.shields.io/npm/dm/w-flowchart.svg)](https://npmjs.org/package/w-flowchart) 
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-flowchart.svg)](https://www.jsdelivr.com/package/npm/w-flowchart)

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-flowchart/w-flowchart.html).

## Installation

### Using npm(ES6 module):
```alias
npm i w-flowchart
```

### 渲染瀏覽器(經 w-playwright 啟動)
本套件以無頭瀏覽器(Playwright 之 Chromium headless shell)渲染,**一律經自有套件 `w-playwright` 啟動**,不直接依賴 `playwright`／`playwright-core`;渲染所用之繪圖庫由 jsDelivr CDN 於頁面內載入,渲染時需連網。

1. **安裝即帶入 playwright-core 1.64.1**(經 w-playwright 之 `dependencies`,精確版本)。不需、也不應另裝 `playwright` 或 `playwright-core`。
2. **受管瀏覽器之取得**:本套件**不自動下載瀏覽器**。首次使用(或離線部署前)以 w-playwright 取得,**不要用 `npx playwright install`**(依賴樹中他版被提升時會下載到不同版本之瀏覽器):
   ```js
   import wpw from 'w-playwright'

   await wpw.ensureChromium() //取得 headless shell(本套件渲染所用)
   ```
   未安裝而渲染時,`WFlowchart()` reject 之 Error 帶 `code: 'E_BROWSER_MISSING'`(訊息附 `ensureChromium` 用法)。
3. **離線**:於可連網之機器以同版 w-playwright 執行 `ensureChromium()`,把 Playwright 之瀏覽器資料夾(Windows 預設 `%LOCALAPPDATA%\ms-playwright` 內之 `chromium_headless_shell-1248`)複製至目標機,並以環境變數 `PLAYWRIGHT_BROWSERS_PATH` 指向該資料夾;**此變數須在載入本套件前設定**(Playwright 於模組載入時決定瀏覽器目錄)。此項只涵蓋瀏覽器;繪圖庫仍由 jsDelivr CDN 載入(本套件目前無改用本機來源之選項),渲染時仍需連網。
4. **本套件只用受管之 headless shell,不使用系統之 Google Chrome／Microsoft Edge**,故不需安裝它們。
5. **一律加入之守門參數**:w-playwright 於每次啟動之命令列恰給一個 `--disable-features`(Playwright 預設清單＋`AutofillAiWalletPrivatePasses`＋呼叫端自給者,置於呼叫端 args 之末),並以 `ignoreDefaultArgs` 去掉 Playwright 預設之那一串。原因:Windows 上 Chromium 153 起,每啟動一個新的瀏覽器根行程,即以無效密碼替目前之 Windows 使用者呼叫一次 `LogonUser`(安全性紀錄 4625、錯誤密碼次數 +1,本機原則 10 分鐘內 10 次即鎖定帳號);停用功能 `AutofillAiWalletPrivatePasses` 即不再發生。本套件之使用者不能停用此守門。
6. **不支援之環境**:`PWDEBUG` 為 inspector 模式之值、`SELENIUM_REMOTE_URL` 有值時(會使守門失效),啟動 reject `E_ENV`。
7. **行為變更**(自改經 w-playwright 啟動起):①啟動失敗時 `WFlowchart()` reject 之 Error 帶 w-playwright 之 `code`(`E_BROWSER_MISSING`、`E_LAUNCH`、`E_LAUNCH_TIMEOUT`、`E_ENV`、`E_PW_VERSION`),訊息為固定詞彙,不再是 Playwright 之原訊息(如 `Executable doesn't exist`);②環境變數 `W_PLAYWRIGHT_LOGON_GUARD` 開啟(預設關)時,w-playwright 於啟動非 headless shell 之瀏覽器前檢查錯誤密碼次數;本套件只啟動 headless shell,不受此守門限制;③輸出之 PNG／SVG 不變(同 Playwright 1.64.1、同參數,只多守門功能)。

## Example

```js
import fs from 'fs'
import WFlowchart from 'w-flowchart'

let inp = {
    dir: 'TB',
    nodes: [
        { id: 'A', label: '開始', cls: 'blue' },
        { id: 'G', label: '處理群組', cls: 'greenG' },
        { id: 'B', label: '步驟一', cls: 'green', group: 'G' },
        { id: 'C', title: '服務', items: ['項目一', '項目二'], cls: 'green', group: 'G' },
        { id: 'D', label: '判斷?', cls: 'diamond' },
        { id: 'E', label: '結束', cls: 'orange' },
    ],
    edges: [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'C', label: '呼叫' },
        { from: 'C', to: 'D' },
        { from: 'D', to: 'E', label: '通過' },
        { from: 'D', to: 'B', kind: 'dashed', label: '退回' },
    ],
}

let buf = await WFlowchart(inp) //預設 opt.mode 為 'p10'; 可用 WFlowchart(inp, { mode: 'p3' }) 指定產線('p1'~'p10' 各對應一套繪圖引擎)
fs.writeFileSync('flowchart.png', buf)
// => 產出 flowchart.png

let svg = await WFlowchart(inp, { output: 'svg' }) //輸出 standalone SVG 字串(p1~p8 與 p10 支援; p9 不支援)
fs.writeFileSync('flowchart.svg', svg)
// => 產出 flowchart.svg
```

label 換行行為(p10):label 過寬時會依最大寬度自動斷行(中文於字間、英數於空白/標點,不會攔腰斷字);label 內可用 `\n` 強制換行(節點、群組標題、菱形與邊標籤皆支援),其餘空白照常摺疊。其他產線(p1~p9)之換行行為依各引擎而定。
