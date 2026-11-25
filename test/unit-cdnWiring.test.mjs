// 測試不連 CDN 之本庫專屬接線測試(規則帳本規則 3; R-FC-CDN-01~05)
//   共用庫 w-package-tools-e2e 之 createCdnLocal(取得、校驗、鎖、路由、fetch 補丁之各情境)由該庫之測試涵蓋,本檔只驗「本庫之接線」:
//   A. 清單與產品之 CDN 網址表一致、ESM 相對匯入閉包完整(R-FC-CDN-01)
//   B. 經本庫之啟動出口(src/common/launchBrowser.mjs 與測試端直接啟動)之 browser 皆已導向本地副本,表外請求使測試失敗(R-FC-CDN-02)
//   C. Node 端 fetch(p8 之 cdnFetchText)已導向本地副本(R-FC-CDN-03)
//   D. 涵蓋盤點: 凡會啟動瀏覽器之測試檔皆經 installCdn;疊放之替身其 next() 逐處包裝 cdn.routeBrowser(R-FC-CDN-04)
//   E. src 不含測試接縫(R-FC-CDN-05)
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import wpw from 'w-playwright'
import launchBrowser from '../src/common/launchBrowser.mjs'
import { cdnUrl, cdnFetchText } from '../src/common/cdn.mjs'
import { cdn, installCdn, MANIFEST_PATH } from './tools/cdn.mjs'
import { roots, cdnKeysFromSource } from './tools/cdn.roots.mjs'

installCdn()

const __dir = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.resolve(__dir, '..', 'src')

const relImports = (text) => {
    const out = []
    const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](\.{1,2}\/[^"']+)["']/g
    let m
    while ((m = re.exec(text))) out.push(m[1])
    return out
}

describe('CDN 接線: 清單與產品之 CDN 網址表(R-FC-CDN-01)', function() {

    before(async function() {
        this.timeout(cdn.hookTimeoutMs) // 首次需下載時之取得點, 時限對齊下載預算
        await cdn.ensure()
    })

    it('R-FC-CDN-01 清單之 roots 與 src/common/cdn.mjs 之 PKG 表逐一相同(鍵與含版本之網址), 每個根皆在對照表內', function() {
        const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
        const keys = cdnKeysFromSource()
        assert.ok(keys.length >= 16, '解析到之庫數過少(解析壞掉): ' + keys.length)
        assert.deepStrictEqual(Object.keys(m.roots).sort(), keys.slice().sort(), '清單之鍵與 cdn.mjs 不同: 修改 cdn.mjs 後須重產清單(見規則帳本規則 3)')
        assert.deepStrictEqual(m.roots, roots, '清單之 roots 與 cdn.roots.mjs(即 cdn.mjs 之 PKG 表)不同')
        for (const k of keys) {
            assert.strictEqual(m.roots[k], cdnUrl(k), `${k} 之網址(含版本)與 cdn.mjs 不同`)
            assert.ok(cdn.lookup(cdnUrl(k)), `${k} 不在對照表內`)
        }
        assert.ok(cdn.stats().files >= 100, '對照表檔數過少(chunk 式 ESM 之閉包應有上百檔): ' + cdn.stats().files)
    })

    it('R-FC-CDN-01 清單內 ESM 檔(.mjs)之相對匯入(含 import())閉包完整: 每個被匯入之檔皆在對照表內', function() {
        const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
        let nMjs = 0
        let nImp = 0
        for (const url of Object.keys(m.files)) {
            if (!/\.mjs$/.test(url)) continue
            nMjs++
            for (const spec of relImports(fs.readFileSync(cdn.fileOf(url), 'utf8'))) {
                nImp++
                assert.ok(m.files[new URL(spec, url).href], `${url} 匯入之 ${spec} 不在對照表內`)
            }
        }
        assert.ok(nMjs >= 100 && nImp >= 100, `掃描量過少: ${nMjs} 檔 ${nImp} 匯入`)
    })

})

describe('CDN 接線: 本庫之啟動出口皆已導向本地副本(R-FC-CDN-02)', function() {
    let browser = null

    before(async function() {
        this.timeout(cdn.hookTimeoutMs)
        await cdn.ensure()
    })

    afterEach(async function() {
        if (browser) await browser.close().catch(() => {})
        browser = null
    })

    it('R-FC-CDN-02 產品之單一啟動出口 launchBrowser() 回傳之 browser 已導向本地副本, 頁面載入之庫來自本地(cdn 之 served 計數增加)', async function() {
        browser = await launchBrowser()
        assert.ok(cdn.isRouted(browser), 'launchBrowser() 之 browser 未經 routeBrowser(漏接)')
        const n0 = cdn.stats().served
        const page = await browser.newPage()
        await page.setContent(`<script src="${cdnUrl('dagre')}"></script>`, { waitUntil: 'load' })
        assert.strictEqual(await page.evaluate(() => typeof window.dagre), 'object', 'dagre 全域未載入')
        assert.ok(cdn.stats().served.browser > n0.browser, '頁面載入之庫應由本地副本回應(served.browser 增加)')
        await browser.close() // 無違規 → 不拋
        browser = null
    })

    it('R-FC-CDN-02 測試端直接啟動(wpw.launchChromium, 如 lib.mjs 之舞台頁與 wflowchart.test 之 XML 解析案)之 browser 亦已導向本地副本', async function() {
        browser = await wpw.launchChromium({ headless: true })
        assert.ok(cdn.isRouted(browser), 'wpw.launchChromium() 之 browser 未經 routeBrowser(漏接)')
        const page = await browser.newPage()
        assert.ok(cdn.isRouted(page), 'browser.newPage() 之頁面亦應已導向本地副本')
        await browser.close()
        browser = null
    })

    it('R-FC-CDN-02 對照表以外之外部網址(含同庫不同版本、非回送位址)被中止, browser.close() 拋 E_CDN_EXTERNAL 且 assertNoViolation 亦失敗', async function() {
        const mark = cdn.violationMark()
        browser = await launchBrowser()
        const page = await browser.newPage()
        const other = 'https://cdn.jsdelivr.net/npm/dagre@0.0.1/dist/dagre.min.js' // 同庫不同版本: 不在表內
        await page.setContent('<script src="https://example.invalid/a.js"></script>', { waitUntil: 'load' })
        const r = await page.evaluate(async (u) => {
            try {
                await fetch(u)
                return 'ok'
            }
            catch (e) {
                return 'blocked'
            }
        }, other)
        assert.strictEqual(r, 'blocked', '表外請求未被中止')
        const bro = browser
        browser = null
        await assert.rejects(() => bro.close(), err => {
            assert.strictEqual(err.code, 'E_CDN_EXTERNAL')
            const urls = err.violations.map(v => v.url)
            assert.ok(urls.includes('https://example.invalid/a.js') && urls.includes(other), '違規清單應含兩筆表外網址: ' + urls)
            return true
        })
        assert.throws(() => cdn.assertNoViolation(mark), err => err.code === 'E_CDN_EXTERNAL', '自標記起之違規應使 assertNoViolation 失敗')
    })

})

describe('CDN 接線: Node 端 fetch 已導向本地副本(R-FC-CDN-03)', function() {

    before(async function() {
        this.timeout(cdn.hookTimeoutMs)
        await cdn.ensure()
    })

    it('R-FC-CDN-03 p8 之 cdnFetchText(src/common/cdn.mjs)取得之內容即本地副本(位元組與清單之 sha256 相同)', async function() {
        // 版本釘死, 內容 sha256 相同本身不足以證明取自本地副本;「確實經補丁供應」由下一案之 served.fetch 增量證明, 本案驗 cdnFetchText 取得之內容正確可用
        const txt = await cdnFetchText('logicflow-css')
        const sha = (await import('crypto')).createHash('sha256').update(Buffer.from(txt, 'utf8')).digest('hex')
        assert.strictEqual(sha, cdn.lookup(cdnUrl('logicflow-css')).sha256)
    })

    it('R-FC-CDN-03 本行程之全域 fetch 已補丁: 對照表以外之外部網址拋 E_CDN_EXTERNAL, 不連網; 本庫設 allowLoopback:false, 回送位址亦視為外部', async function() {
        const mark = cdn.violationMark()
        await assert.rejects(() => fetch('https://example.invalid/not-in-table.css'), err => err.code === 'E_CDN_EXTERNAL')
        await assert.rejects(() => fetch('http://127.0.0.1:9/x'), err => err.code === 'E_CDN_EXTERNAL', '本庫頁面不連本機服務, 回送位址應視為外部')
        assert.throws(() => cdn.assertNoViolation(mark), err => err.code === 'E_CDN_EXTERNAL' && err.violations.length === 2)
    })

    it('R-FC-CDN-03 補丁之 fetch 對清單內網址回本地副本: served.fetch 增加且內容位元組與清單之 sha256 相同', async function() {
        const u = cdnUrl('logicflow-css')
        const n0 = cdn.stats().served.fetch
        const res = await fetch(u)
        assert.strictEqual(res.status, 200)
        const sha = (await import('crypto')).createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex')
        assert.strictEqual(sha, cdn.lookup(u).sha256)
        assert.strictEqual(cdn.stats().served.fetch, n0 + 1, '該次取得應由 patchFetch 供應(served.fetch 增加 1)')
    })

})

// ---- D. 涵蓋盤點 ----
// 對 files(Map 路徑→文字)內之測試檔: 求相對匯入之遞移閉包; 閉包含瀏覽器啟動者(src 之產線入口或 launchChromium( 之檔)為「瀏覽器使用者」;
// 閉包內(橋接檔 cdn.mjs 以外之)檔呼叫 installCdn() 者為「已接縫」
// 註解中之字樣不算(整行註解與行尾「 // 」註解); 字串內之 "//" 前無空白者(如網址)不受影響
const stripComments = (t) => t.replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/\s.*$/gm, '')

function analyze(files, tests, bridgeFp) {
    const BROWSER_SRC = /[\\/]src[\\/](WFlowchart\.mjs|common[\\/]launchBrowser\.mjs|p\d+[\\/]gen\.mjs)$/
    const txt = (f) => stripComments(files.get(f) || '')
    const closureOf = (fp) => {
        const seen = new Set()
        const st = [fp]
        while (st.length) {
            const f = st.pop()
            if (seen.has(f)) continue
            seen.add(f)
            if (!files.has(f)) continue
            for (const s of relImports(txt(f))) st.push(path.resolve(path.dirname(f), s))
        }
        return seen
    }
    const users = []
    const uncovered = [] // 未呼叫 installCdn()
    const noEnsure = [] // 未於 before 取得(cdn.ensure())
    const noTimeout = [] // 取得點未掛 this.timeout(cdn.hookTimeoutMs)(須對齊下載預算, 不沿用 mocha 之 180 秒)
    const noMark = [] // 未取 cdn.violationMark()
    const noCheck = [] // 未以 cdn.assertNoViolation 檢查違規(含 close() 前已被吞掉者)
    for (const t of tests) {
        const cl = closureOf(t)
        const usesBrowser = [...cl].some(f => BROWSER_SRC.test(f) || /\blaunchChromium(Persistent)?\(/.test(txt(f)))
        if (!usesBrowser) continue
        users.push(t)
        const inClosure = (re) => [...cl].some(f => f !== bridgeFp && re.test(txt(f)))
        if (!(cl.has(bridgeFp) && inClosure(/(?<!function )\binstallCdn\(\)/))) uncovered.push(t)
        if (!inClosure(/\bcdn\.ensure\(\)/)) noEnsure.push(t)
        if (!inClosure(/\bthis\.timeout\(cdn\.hookTimeoutMs\b/)) noTimeout.push(t)
        if (!inClosure(/\bcdn\.violationMark\(\)/)) noMark.push(t)
        if (!inClosure(/\bcdn\.assertNoViolation\(/)) noCheck.push(t)
    }
    return { users, uncovered, noEnsure, noTimeout, noMark, noCheck }
}

// 使用 setBrowserTypeForTest 之檔: 每一處 next() 呼叫皆須為 cdn.routeBrowser(await next()) (其 next() 不經下層替身, 故疊放者須逐處包裝)
function unwrappedNextCalls(text) {
    // 先去註解, 再把字串與樣板字串之內容清空(測試標題內之「next()」字樣不是呼叫)
    const t = stripComments(text).replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""')
    const all = (t.match(/\bnext\(/g) || []).length
    const wrapped = (t.match(/\bcdn\.routeBrowser\(await next\(\)\)/g) || []).length
    return { all, wrapped }
}

describe('CDN 接線: 涵蓋盤點與產品不含接縫(R-FC-CDN-04、R-FC-CDN-05)', function() {
    const bridgeFp = path.resolve(__dir, 'tools', 'cdn.mjs')

    const readAll = (dir, filter, out = new Map()) => {
        for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
            const fp = path.join(dir, d.name)
            if (d.isDirectory()) {
                if (d.name === 'pics' || d.name === '_tmp' || d.name === '_cache' || d.name === 'data' || d.name === 'node_modules') continue
                readAll(fp, filter, out)
            }
            else if (filter(d.name)) out.set(fp, fs.readFileSync(fp, 'utf8'))
        }
        return out
    }

    it('R-FC-CDN-04 凡會啟動瀏覽器之測試檔(閉包含產線入口或 launchChromium)皆經 installCdn; 不得空集合', function() {
        const files = readAll(__dir, n => /\.mjs$/.test(n))
        const tests = [...files.keys()].filter(f => /\.test\.mjs$/.test(f) && path.dirname(f) === __dir)
        const { users, uncovered, noEnsure, noTimeout, noMark, noCheck } = analyze(files, tests, bridgeFp)
        const names = (a) => a.map(u => path.basename(u))
        assert.ok(tests.length >= 14, '掃描到之測試檔過少: ' + tests.length)
        assert.ok(users.length >= 12, '瀏覽器使用者過少(偵測壞掉): ' + names(users))
        assert.deepStrictEqual(names(uncovered), [], '這些測試檔會啟動瀏覽器卻未經 installCdn(將連真 CDN)')
        assert.deepStrictEqual(names(noEnsure), [], '這些測試檔未於 before 呼叫 cdn.ensure()')
        assert.deepStrictEqual(names(noTimeout), [], '這些測試檔之取得點未掛 this.timeout(cdn.hookTimeoutMs)(須對齊下載預算, 不沿用 mocha 之 180 秒)')
        assert.deepStrictEqual(names(noMark), [], '這些測試檔未取 cdn.violationMark()')
        assert.deepStrictEqual(names(noCheck), [], '這些測試檔未以 cdn.assertNoViolation 檢查外部請求違規')
    })

    it('R-FC-CDN-04 盤點器自檢: 對合成檔集能區分「已接縫」「未接縫」「非瀏覽器使用者」', function() {
        // 鍵一律經 path.resolve 正規化(與 analyze 內相對匯入之解析方式一致)
        const P = (s) => path.resolve('/x', s)
        const C = P('tools/cdn.mjs')
        const T = P('a.test.mjs')
        const mk = (obj) => new Map(Object.entries(obj))
        const DEF = 'export function installCdn() {}'
        const a = analyze(mk({
            [T]: 'import \'./b.mjs\'',
            [P('b.mjs')]: 'const br = await wpw.launchChromium({})',
        }), [T], C)
        assert.deepStrictEqual(a.uncovered, [T], '未接縫者應被抓到')
        const b = analyze(mk({
            [T]: 'import \'./b.mjs\'',
            [P('b.mjs')]: 'import \'./tools/cdn.mjs\'\ninstallCdn()\nconst br = await wpw.launchChromium({})',
            [C]: DEF
        }), [T], C)
        assert.deepStrictEqual(b.users, [T])
        assert.deepStrictEqual(b.uncovered, [], '經共用層接縫者應判為已接縫')
        assert.deepStrictEqual([b.noEnsure, b.noTimeout, b.noMark, b.noCheck], [[T], [T], [T], [T]], '未呼叫 ensure、未掛 hookTimeoutMs、未取標記、未檢查違規者皆應被抓到')
        const e = analyze(mk({
            [T]: 'import \'./tools/cdn.mjs\'\ninstallCdn()\nthis.timeout(cdn.hookTimeoutMs)\nawait cdn.ensure()\nconst m = cdn.violationMark()\ncdn.assertNoViolation(m)\nawait wpw.launchChromiumPersistent(\'x\', {})',
            [C]: DEF
        }), [T], C)
        assert.deepStrictEqual([e.users, e.uncovered, e.noEnsure, e.noTimeout, e.noMark, e.noCheck], [[T], [], [], [], [], []], '五項齊備者不應被列入; launchChromiumPersistent 亦視為瀏覽器啟動')
        const c = analyze(mk({
            [T]: 'import \'./tools/cdn.mjs\'',
            [C]: DEF + '\nconst x = 1'
        }), [T], C)
        assert.deepStrictEqual(c.users, [], '非瀏覽器使用者不應被列入')
        // 只匯入橋接檔而未呼叫 installCdn() 不算接縫; 註解中之 installCdn() 亦不算
        const d = analyze(mk({
            [T]: 'import \'./tools/cdn.mjs\'\n// installCdn()\nimport \'../src/p1/gen.mjs\'',
            [C]: DEF
        }), [T], C)
        assert.deepStrictEqual(d.uncovered, [T])
    })

    it('R-FC-CDN-04 使用 setBrowserTypeForTest 之檔(橋接檔與疊放替身之 api-wpwWiring.test)其每一處 next() 呼叫皆為 cdn.routeBrowser(await next())', function() {
        const files = readAll(__dir, n => /\.mjs$/.test(n))
        const used = []
        for (const [fp, txt] of files) {
            if (!/\bsetBrowserTypeForTest\(/.test(stripComments(txt))) continue
            used.push(path.basename(fp))
            const c = unwrappedNextCalls(txt)
            assert.ok(c.all >= 1, path.basename(fp) + ' 之 next() 呼叫偵測不到(盤點壞掉)')
            assert.strictEqual(c.wrapped, c.all, `${path.basename(fp)} 有 ${c.all - c.wrapped} 處 next() 呼叫未包成 cdn.routeBrowser(await next())`)
        }
        assert.ok(used.includes('cdn.mjs') && used.includes('api-wpwWiring.test.mjs'), '應至少有橋接檔與 api-wpwWiring.test.mjs: ' + used)
        // 盤點器自檢: 逐處檢查, 不是整檔只要出現過一次包裝就過
        assert.deepStrictEqual(unwrappedNextCalls('return cdn.routeBrowser(await next())\nreturn next()'), { all: 2, wrapped: 1 })
        assert.deepStrictEqual(unwrappedNextCalls('// next() 之說明\nreturn cdn.routeBrowser(await next())'), { all: 1, wrapped: 1 })
    })

    it('R-FC-CDN-05 src 不含測試接縫(產品之預設行為不變): src 內無 createCdnLocal、w-package-tools-e2e、cdn.manifest、W_CDN、setBrowserTypeForTest、installCdn 字樣', function() {
        const files = readAll(srcDir, n => /\.(mjs|html)$/.test(n))
        assert.ok(files.size >= 12, '掃描到之 src 檔過少: ' + files.size)
        for (const [fp, txt] of files) {
            assert.ok(!/createCdnLocal|w-package-tools-e2e|cdn\.manifest|W_CDN|setBrowserTypeForTest|installCdn/.test(txt), path.relative(srcDir, fp) + ' 不得含測試接縫')
        }
    })

})
