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
