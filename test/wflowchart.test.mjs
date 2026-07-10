// WFlowchart 統一入口(mocha) — p1~p10 各以真圖數據渲染一張, 驗 PNG 合法性; 並驗入參檢查與 inp 不可變
import assert from 'assert'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import WFlowchart from '../src/WFlowchart.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const inp = JSON.parse(fs.readFileSync(resolve(__dir, 'data', '系統架構圖.json'), 'utf8'))

const isPng = (buf) => Buffer.isBuffer(buf) && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47

describe('WFlowchart(mode, inp) → PNG Buffer', function() {

    for (let i = 1; i <= 10; i++) {
        const m = 'p' + i
        it(`${m} 產出合法 PNG`, async function() {
            const buf = await WFlowchart(m, inp)
            assert.ok(isPng(buf), '非合法 PNG Buffer')
            assert.ok(buf.length > 10000, 'PNG 過小: ' + buf.length)
        })
    }

    it('拒絕非法 mode', async function() {
        await assert.rejects(() => WFlowchart('p99', inp), /invalid mode/)
        await assert.rejects(() => WFlowchart(123, inp), /invalid mode/)
    })

    it('拒絕非法 inp', async function() {
        await assert.rejects(() => WFlowchart('p1', {}), /invalid inp/)
        await assert.rejects(() => WFlowchart('p1', { dir: 'TB', nodes: [], edges: [] }), /invalid inp/)
        await assert.rejects(() => WFlowchart('p1', { dir: 'TB', nodes: [{ id: 'a', label: 'A', cls: 'blue' }] }), /invalid inp/)
    })

    it('不改動 caller 傳入之 inp', async function() {
        const snap = JSON.stringify(inp)
        await WFlowchart('p10', inp)
        assert.strictEqual(JSON.stringify(inp), snap)
    })

})
