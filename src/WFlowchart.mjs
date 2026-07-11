// WFlowchart — 統一產圖入口: 輸入正規化繪圖數據 inp, 產出 PNG 圖
//   inp: 正規化繪圖數據 { dir, nodes, edges }(與繪圖庫無關, 結構同 test/data/*.json; cls 見 common/palette.mjs)
//   opt.mode: 'p1'~'p10', 各對應一套產線(繪圖引擎與佈局各異, 見各 pN/gen.mjs 檔頭說明), 預設 'p10'
//     p1: mermaid(dagre)   p2: mermaid(ELK)     p3: nomnoml         p4: cytoscape(dagre)
//     p5: D2               p6: G6(antv-dagre)   p7: JointJS(dagre)  p8: LogicFlow(dagre)
//     p9: dagre 自寫渲染    p10: ELK 自寫渲染
//   回傳: Promise<Buffer>(PNG)
import get from 'lodash-es/get.js'
import cloneDeep from 'lodash-es/cloneDeep.js'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import { deriveLabels } from './common/derive.mjs'
import { genPng as genPngP1, genSvg as genSvgP1 } from './p1/gen.mjs'
import { genPng as genPngP2, genSvg as genSvgP2 } from './p2/gen.mjs'
import { genPng as genPngP3, genSvg as genSvgP3 } from './p3/gen.mjs'
import { genPng as genPngP4, genSvg as genSvgP4 } from './p4/gen.mjs'
import { genPng as genPngP5, genSvg as genSvgP5 } from './p5/gen.mjs'
import { genPng as genPngP6, genSvg as genSvgP6 } from './p6/gen.mjs'
import { genPng as genPngP7, genSvg as genSvgP7 } from './p7/gen.mjs'
import { genPng as genPngP8, genSvg as genSvgP8 } from './p8/gen.mjs'
import { genPng as genPngP9 } from './p9/gen.mjs'
import { genPng as genPngP10, genSvg as genSvgP10 } from './p10/gen.mjs'

const GENS_PNG = {
    p1: genPngP1,
    p2: genPngP2,
    p3: genPngP3,
    p4: genPngP4,
    p5: genPngP5,
    p6: genPngP6,
    p7: genPngP7,
    p8: genPngP8,
    p9: genPngP9,
    p10: genPngP10,
}

// svg 輸出: p1/p2/p3/p5/p10 引擎原生輸出 SVG 字串; p7/p8 為 SVG DOM 序列化(樣式已內嵌);
//   p4 經 cytoscape-svg 外掛、p6 經 @antv/g-svg renderer 重繪為 SVG(皆經像素級忠實度驗證);
//   p9 節點為 React Flow 之 HTML DOM, 無忠實 SVG 可產 → 不支援
const GENS_SVG = {
    p1: genSvgP1,
    p2: genSvgP2,
    p3: genSvgP3,
    p4: genSvgP4,
    p5: genSvgP5,
    p6: genSvgP6,
    p7: genSvgP7,
    p8: genSvgP8,
    p10: genSvgP10,
}

/**
 * 產製流程圖 PNG
 *
 * @param {Object} inp 輸入正規化繪圖數據物件,格式 { dir, nodes, edges },與繪圖引擎無關
 * @param {String} [inp.dir='TB'] 輸入佈局方向字串,可選 'TB'(上而下)或 'LR'(左而右),預設 'TB'
 * @param {Array} inp.nodes 輸入節點陣列,每項為一般節點 { id, label, cls, group? } 或富節點 { id, title, items, cls, group? };cls 為色票鍵(見 src/common/palette.mjs),結尾 G/G2 者為群組容器,group 為所屬容器 id(容器可巢狀)
 * @param {Array} inp.edges 輸入邊陣列,每項為 { from, to, label?, kind? },kind 給 'dashed' 為虛線
 * @param {Object} [opt={}] 輸入設定物件,原樣傳遞給產線,預設 {}
 * @param {String} [opt.mode='p10'] 輸入產線模式字串,可選 'p1'~'p10',各對應一套繪圖引擎產線(技術概念見各 src/pN/README.md),未指定或非有效字串時預設 'p10'
 * @param {String} [opt.output='png'] 輸入輸出格式字串,可選 'png'(回傳 PNG Buffer)或 'svg'(回傳 standalone SVG 字串),未指定或非有效字串時預設 'png';svg 支援 p1~p8 與 p10,p9(React Flow 之 HTML DOM 渲染)不支援,給 svg 會拋錯
 * @returns {Promise} 回傳 Promise,resolve 依 opt.output 回傳 PNG 圖之 Buffer 或 SVG 字串,reject 回傳錯誤訊息
 * @example
 *
 * import fs from 'fs'
 * import WFlowchart from 'w-flowchart'
 *
 * let inp = {
 *     dir: 'TB',
 *     nodes: [
 *         { id: 'A', label: '開始', cls: 'blue' },
 *         { id: 'G', label: '處理群組', cls: 'greenG' },
 *         { id: 'B', label: '步驟一', cls: 'green', group: 'G' },
 *         { id: 'C', title: '服務', items: ['項目一', '項目二'], cls: 'green', group: 'G' },
 *         { id: 'D', label: '判斷?', cls: 'diamond' },
 *         { id: 'E', label: '結束', cls: 'orange' },
 *     ],
 *     edges: [
 *         { from: 'A', to: 'B' },
 *         { from: 'B', to: 'C', label: '呼叫' },
 *         { from: 'C', to: 'D' },
 *         { from: 'D', to: 'E', label: '通過' },
 *         { from: 'D', to: 'B', kind: 'dashed', label: '退回' },
 *     ],
 * }
 *
 * let buf = await WFlowchart(inp) //預設 mode 'p10'; 可用 WFlowchart(inp, { mode: 'p3' }) 指定產線
 * fs.writeFileSync('flowchart.png', buf)
 * // => 產出 flowchart.png
 *
 * let svg = await WFlowchart(inp, { output: 'svg' }) //輸出 standalone SVG 字串(p9 不支援)
 * fs.writeFileSync('flowchart.svg', svg)
 * // => 產出 flowchart.svg
 */
async function WFlowchart(inp, opt = {}) {
    let mode = get(opt, 'mode')
    if (!isestr(mode)) mode = 'p10' //未指定或非有效字串時預設 p10
    const m = mode.trim().toLowerCase()
    if (!GENS_PNG[m]) throw new Error(`invalid opt.mode[${mode}], 須為 ${Object.keys(GENS_PNG).join(', ')} 之一`)
    let output = get(opt, 'output')
    if (!isestr(output)) output = 'png' //未指定或非有效字串時預設 png
    const o = output.trim().toLowerCase()
    if (o !== 'png' && o !== 'svg') throw new Error(`invalid opt.output[${output}], 須為 png 或 svg`)
    if (o === 'svg' && !GENS_SVG[m]) throw new Error(`mode[${m}] 不支援 svg 輸出, 支援: ${Object.keys(GENS_SVG).join(', ')}`)
    if (!iseobj(inp)) throw new Error('invalid inp, 須為 { dir, nodes, edges } 正規化繪圖數據')
    if (!isearr(inp.nodes)) throw new Error('invalid inp.nodes, 須為非空陣列')
    if (!isarr(inp.edges)) throw new Error('invalid inp.edges, 須為陣列')
    const data = deriveLabels(cloneDeep(inp)) //deriveLabels 會就地改動, 先複製避免污染 caller 之 inp
    return await (o === 'svg' ? GENS_SVG : GENS_PNG)[m](data, opt)
}

export default WFlowchart
