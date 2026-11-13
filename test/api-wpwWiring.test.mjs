// 啟動接線測試(規則帳本 R-FC-WPW-01、R-FC-WPW-02; w-playwright 之 R-PW-WIRING)
//   本套件之瀏覽器啟動點(p1~p10 共 10 站點)皆須經 w-playwright, 送出之選項含守門(恰一串 --disable-features 且含 AutofillAiWalletPrivatePasses)
//   做法: 以 wpw.setBrowserTypeForTest 之替身取代 BrowserType, 經公開入口 WFlowchart(inp, { mode, output }) 驅動各產線,
//        替身收到之即為 w-playwright 合併後之選項; 替身記錄後即拋錯, 不啟動任何瀏覽器
//   斷言替身確被呼叫(次數 > 0): 依賴樹若有兩份 w-playwright 或某站點未經 w-playwright, 替身不會被呼叫, 不得空過
//   接縫不用替身之一案: 替身 next() 走真路徑, 真啟動 headless shell 完成一張圖(headless shell 不觸發登入守門所防之 LogonUser)
import assert from 'assert'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve, join } from 'path'
import wpw from 'w-playwright'
import WFlowchart from '../src/WFlowchart.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const srcDir = resolve(__dir, '..', 'src')
const inp = JSON.parse(fs.readFileSync(resolve(__dir, 'data', '電商平台架構圖.json'), 'utf8'))

// 站點全集(與 src 之 launchBrowser() 呼叫逐檔對照; p5 為 D2(WASM)無瀏覽器)
const SITES = { p1: 1, p2: 1, p3: 1, p4: 1, p6: 2, p7: 1, p8: 1, p9: 1, p10: 1 }
// 各站點可達之 (mode, output) 組合; p6 之兩站點分別為 genPng 與 genSvg; p9 不支援 svg
const COMBOS = [
    ['p1', 'png'], ['p1', 'svg'], ['p2', 'png'], ['p2', 'svg'], ['p3', 'png'], ['p3', 'svg'], ['p4', 'png'], ['p4', 'svg'],
    ['p6', 'png'], ['p6', 'svg'], ['p7', 'png'], ['p7', 'svg'], ['p8', 'png'], ['p8', 'svg'], ['p9', 'png'], ['p10', 'png'], ['p10', 'svg'],
]

function makeProbe(next_) {
    const calls = []
    const fake = {
        launch: async (o, next) => {
            calls.push(o)
            if (next_) {
                return next()
            }
            throw new Error('stub: no real launch')
        },
    }
    return { calls, fake }
}

// 對應「送出之選項含守門」: 恰一串 --disable-features、置於 args 之末、含守門功能、Playwright 預設那一串被去掉、無頭
function assertGuarded(o) {
    assert.ok(Array.isArray(o.args), 'args 應為陣列')
    const ds = o.args.filter(s => /^--disable-features=/i.test(s))
    assert.strictEqual(ds.length, 1, '命令列應恰一個 --disable-features')
    assert.strictEqual(o.args[o.args.length - 1], ds[0], '該串應置於 args 最後一個元素')
    assert.ok(ds[0].slice('--disable-features='.length).split(',').includes('AutofillAiWalletPrivatePasses'), '應含守門功能 AutofillAiWalletPrivatePasses')
    assert.ok(Array.isArray(o.ignoreDefaultArgs) && o.ignoreDefaultArgs.some(s => /^--disable-features=/i.test(s)), 'ignoreDefaultArgs 應去掉 Playwright 預設之 --disable-features 串')
    assert.strictEqual(o.headless, true, '應為無頭(headless shell)')
}

describe('啟動接線: 本套件之啟動點皆經 w-playwright(送出之選項含守門)', function() {

    it('站點全集: src 內 launchBrowser() 之呼叫站點恰為 10 處, 與接線表一致; 啟動僅在 common/launchBrowser.mjs 經 wpw.launchChromium', function() {
        // 對應「每個啟動點皆須經 w-playwright」: 站點多於表者表示有新增站點未被接線測試涵蓋
        const found = {}
        let wpwCalls = []
        for (const d of fs.readdirSync(srcDir, { withFileTypes: true })) {
            if (!d.isDirectory()) continue
            for (const f of fs.readdirSync(join(srcDir, d.name))) {
                if (!f.endsWith('.mjs')) continue
                const txt = fs.readFileSync(join(srcDir, d.name, f), 'utf8')
                const n = (txt.match(/\blaunchBrowser\(\)/g) || []).length
                if (d.name !== 'common' && n > 0) found[d.name] = (found[d.name] || 0) + n
                if (/\bwpw\.launchChromium\(/.test(txt)) wpwCalls.push(d.name + '/' + f)
            }
        }
        assert.deepStrictEqual(found, SITES)
        assert.strictEqual(Object.values(found).reduce((a, b) => a + b, 0), 10)
        assert.deepStrictEqual(wpwCalls, ['common/launchBrowser.mjs'])
    })

    for (const [mode, output] of COMBOS) {
        it(`${mode}/${output}: 啟動經 w-playwright, 選項含守門`, async function() {
            const { calls, fake } = makeProbe(false)
            const restore = wpw.setBrowserTypeForTest(fake)
            try {
                // 替身拋錯依真啟動之規則轉為固定詞彙錯誤 E_LAUNCH, 由產線原樣往外
                await assert.rejects(() => WFlowchart(inp, { mode, output }), err => err && err.code === 'E_LAUNCH')
            }
            finally {
                restore()
            }
            assert.ok(calls.length >= 1, '替身應被呼叫(啟動點未經 w-playwright 或替身未作用於同一份模組)')
            for (const o of calls) assertGuarded(o)
        })
    }

    it('接縫不用替身: next() 走真路徑, 真啟動 headless shell 產出合法 PNG, 其選項含守門', async function() {
        const { calls, fake } = makeProbe(true)
        const restore = wpw.setBrowserTypeForTest(fake)
        let buf
        try {
            buf = await WFlowchart(inp, { mode: 'p10' })
        }
        finally {
            restore()
        }
        assert.ok(Buffer.isBuffer(buf) && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47, '非合法 PNG Buffer')
        assert.strictEqual(calls.length, 1)
        assertGuarded(calls[0])
    })

    it('受管瀏覽器缺檔時 reject 帶 code E_BROWSER_MISSING 之 Error(行為變更: 訊息改為 w-playwright 之固定詞彙)', async function() {
        // 替身拋出 Playwright 缺檔之訊息字樣, 依 w-playwright 規則轉為 E_BROWSER_MISSING; 本套件不自動安裝
        const restore = wpw.setBrowserTypeForTest({
            launch: async () => {
                throw new Error('browserType.launch: Executable doesn\'t exist at X')
            },
        })
        try {
            await assert.rejects(() => WFlowchart(inp, { mode: 'p10' }), err => err && err.code === 'E_BROWSER_MISSING' && /ensureChromium/.test(err.message))
        }
        finally {
            restore()
        }
    })

})
