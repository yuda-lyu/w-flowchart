// WFlowchart 統一入口(mocha) — p1~p10 各以範例圖數據渲染 PNG 與 SVG(p9 除外), 驗輸出合法性; 並驗入參檢查與 inp 不可變
import assert from 'assert'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { chromium } from 'playwright'
import WFlowchart from '../src/WFlowchart.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const inp = JSON.parse(fs.readFileSync(resolve(__dir, 'data', '電商平台架構圖.json'), 'utf8'))

const isPng = (buf) => Buffer.isBuffer(buf) && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
const SVG_MODES = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p10']

describe('WFlowchart(inp, opt) → PNG Buffer', function() {

    for (let i = 1; i <= 10; i++) {
        const m = 'p' + i
        it(`${m} 產出合法 PNG`, async function() {
            const buf = await WFlowchart(inp, { mode: m })
            assert.ok(isPng(buf), '非合法 PNG Buffer')
            assert.ok(buf.length > 10000, 'PNG 過小: ' + buf.length)
        })
    }

    it('未指定 opt.mode 預設 p10', async function() {
        const def = await WFlowchart(inp)
        const p10 = await WFlowchart(inp, { mode: 'p10' })
        assert.ok(isPng(def), '非合法 PNG Buffer')
        // 位元組級比對會受次像素反鋸齒不決定性影響, 以尺寸一致驗證走的是同一條產線
        assert.strictEqual(def.readUInt32BE(16) + 'x' + def.readUInt32BE(20), p10.readUInt32BE(16) + 'x' + p10.readUInt32BE(20), '預設輸出尺寸應與 mode:p10 相同')
    })

    // opt.output:'svg' — 各支援產線產出 standalone SVG; 收集後由下一測項統一驗 XML 可解析
    const SVGS = {}
    for (const m of SVG_MODES) {
        it(`${m} 產出合法 SVG(output:'svg')`, async function() {
            const svg = await WFlowchart(inp, { mode: m, output: 'svg' })
            assert.strictEqual(typeof svg, 'string', '非字串')
            assert.ok(/^(?:<\?xml[^>]*\?>\s*)?<svg[^>]*xmlns=/.test(svg), '根元素非 <svg> 或缺 xmlns(允許 <?xml?> 宣告前綴)')
            assert.ok(svg.includes('</svg>'), '缺結尾 </svg>')
            assert.ok(!svg.includes('&nbsp;'), '含 XML 未定義之 &nbsp; 實體')
            SVGS[m] = svg
        })
    }

    it('SVG 可被瀏覽器以 XML 解析(standalone 直開)', async function() {
        const browser = await chromium.launch()
        try {
            const page = await browser.newPage()
            for (const m of Object.keys(SVGS)) {
                await page.goto('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(SVGS[m]))
                const errTxt = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 120) : '')
                assert.ok(!/error|Entity/i.test(errTxt), `${m} XML 解析失敗: ${errTxt}`)
            }
        }
        finally {
            await browser.close()
        }
    })

    it('p9 不支援 svg 輸出應拋錯', async function() {
        await assert.rejects(() => WFlowchart(inp, { mode: 'p9', output: 'svg' }), /不支援 svg/)
    })

    it('拒絕非法 opt.output 字串', async function() {
        await assert.rejects(() => WFlowchart(inp, { output: 'jpg' }), /invalid opt\.output/)
    })

    it('拒絕非法 opt.mode 字串', async function() {
        await assert.rejects(() => WFlowchart(inp, { mode: 'p99' }), /invalid opt\.mode/)
        await assert.rejects(() => WFlowchart(inp, { mode: 'abc' }), /invalid opt\.mode/)
    })

    it('拒絕非法 inp', async function() {
        await assert.rejects(() => WFlowchart({}), /invalid inp/)
        await assert.rejects(() => WFlowchart({ dir: 'TB', nodes: [], edges: [] }), /invalid inp/)
        await assert.rejects(() => WFlowchart({ dir: 'TB', nodes: [{ id: 'a', label: 'A', cls: 'blue' }] }), /invalid inp/)
    })

    it('不改動 caller 傳入之 inp', async function() {
        const snap = JSON.stringify(inp)
        await WFlowchart(inp)
        assert.strictEqual(JSON.stringify(inp), snap)
    })

})
