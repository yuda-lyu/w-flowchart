// 測試不連 CDN 之本庫專屬接線測試(規則帳本規則 3; R-FC-CDN-01~05)
//   共用庫 w-package-tools-e2e 之 createCdnLocal(取得、校驗、鎖、路由、fetch 補丁之各情境)由該庫之測試涵蓋,本檔只驗「本庫之接線」:
//   A. 清單與產品之 CDN 網址表一致、ESM 相對匯入閉包完整(R-FC-CDN-01)
//   B. 經本庫之啟動出口(src/common/launchBrowser.mjs 與測試端直接啟動)之 browser 皆已導向本地副本,表外請求使測試失敗(R-FC-CDN-02)
//   C. Node 端 fetch(p8 之 cdnFetchText)已導向本地副本(R-FC-CDN-03)
//   D. 涵蓋盤點: 凡會啟動瀏覽器之測試檔皆經 installCdn; installCdn 以 w-playwright 之啟動後鉤子 wpw.onBrowserCreated 掛路由(鉤子已掛、啟動出口 isRouted),
//      鉤子之註冊集中於橋接檔一處, 其餘測試檔不自行註冊、不於 setBrowserTypeForTest 之替身內自包 cdn.routeBrowser(R-FC-CDN-04)
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

    it('R-FC-CDN-02 使用端自設 setBrowserTypeForTest 之替身且直呼 next() 者, 回傳之 browser 與其頁面亦已導向本地副本(啟動後鉤子與替換正交, 替身內不必自包路由)', async function() {
        const restore = wpw.setBrowserTypeForTest({ launch: async (o, next) => await next() }) // 替身內不自包 cdn.routeBrowser
        try {
            browser = await wpw.launchChromium({ headless: true })
        }
        finally {
            restore()
        }
        assert.ok(cdn.isRouted(browser), '替身直呼 next() 之 browser 未經 routeBrowser(啟動後鉤子未掛或未作用)')
        const page = await browser.newPage()
        assert.ok(cdn.isRouted(page), '該 browser 之頁面亦應已導向本地副本')
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

// 啟動後鉤子之接線盤點: 橋接檔恰一處 wpw.onBrowserCreated((t) => cdn.routeBrowser(t)) 且不再用 setBrowserTypeForTest;
//   其餘檔不自行註冊鉤子、不呼叫 routeBrowser(尤其是 setBrowserTypeForTest 之替身內自包 cdn.routeBrowser(await next()))
// 先去註解, 再把字串與樣板字串之內容清空(測試標題內之字樣不是呼叫); 傳入之 files 不含本檔(本檔含合成檔集與正則字面值, 其引號會使清空錯配)
const stripCode = (t) => stripComments(t).replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""')
function analyzeHookWiring(files, bridgeFp) {
    const bridge = stripCode(files.get(bridgeFp) || '')
    const bridgeHooks = (bridge.match(/\bwpw\.onBrowserCreated\(/g) || []).length
    const bridgeRoutes = /\bwpw\.onBrowserCreated\(\s*(?:async\s*)?\(?\s*(\w+)\s*\)?\s*=>\s*(?:await\s+)?cdn\.routeBrowser\(\s*\1\s*\)/.test(bridge)
    const bridgeStubs = (bridge.match(/\bsetBrowserTypeForTest\(/g) || []).length
    const otherHooks = [] // 橋接檔以外自行註冊鉤子者
    const otherRoutes = [] // 橋接檔以外呼叫 routeBrowser( 者(含替身內自包)
    const stubUsers = [] // 橋接檔以外使用 setBrowserTypeForTest 者(供盤點器自證有掃到)
    for (const [fp, txt] of files) {
        if (fp === bridgeFp) continue
        const t = stripCode(txt)
        if (/\bonBrowserCreated\(/.test(t)) otherHooks.push(path.basename(fp))
        if (/\brouteBrowser\(/.test(t)) otherRoutes.push(path.basename(fp))
        if (/\bsetBrowserTypeForTest\(/.test(t)) stubUsers.push(path.basename(fp))
    }
    return { bridgeHooks, bridgeRoutes, bridgeStubs, otherHooks, otherRoutes, stubUsers }
}

// 不啟動瀏覽器之假 browser: 具 routeBrowser 所需介面(newContext、newPage、contexts、close), 供驗「鉤子已掛」而不起 Chrome
const makeFakeBrowser = () => ({
    newContext: async () => {
        throw new Error('fake: no context')
    },
    newPage: async () => {
        throw new Error('fake: no page')
    },
    contexts: () => [],
    close: async () => {},
})
// 以 setBrowserTypeForTest 之替身(不呼叫 next)啟動, 回傳 w-playwright 交給呼叫端之物件(已套鉤子者); 替身必還原
async function launchViaStub(make) {
    const restore = wpw.setBrowserTypeForTest({ launch: async () => make() })
    try {
        return await wpw.launchChromium({ headless: true })
    }
    finally {
        restore()
    }
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

    it('R-FC-CDN-04 鉤子已掛: 啟動後鉤子之註冊集中於橋接檔恰一處(wpw.onBrowserCreated((t) => cdn.routeBrowser(t))), 橋接檔不用 setBrowserTypeForTest, 其餘測試檔不自行註冊鉤子亦不呼叫 routeBrowser(不於替身內自包)', function() {
        const files = readAll(__dir, n => /\.mjs$/.test(n))
        assert.ok(files.delete(path.resolve(__dir, 'unit-cdnWiring.test.mjs')), '應有本檔(自身不掃, 見 stripCode 之說明)')
        assert.ok(files.has(bridgeFp), '掃描集合應含橋接檔')
        assert.ok(files.size >= 14, '掃描到之 mjs 檔過少(偵測壞掉): ' + files.size)
        const r = analyzeHookWiring(files, bridgeFp)
        assert.strictEqual(r.bridgeHooks, 1, '橋接檔應恰一處 wpw.onBrowserCreated 呼叫(installCdn 未以它掛鉤子或掛了多處)')
        assert.ok(r.bridgeRoutes, '橋接檔之鉤子應為 (t) => cdn.routeBrowser(t)(對最終回傳之 browser 掛路由)')
        assert.strictEqual(r.bridgeStubs, 0, '橋接檔不應再以 setBrowserTypeForTest 之替身接線(替換非疊放, 會被其他替身繞過)')
        assert.deepStrictEqual(r.otherHooks, [], '這些檔自行註冊了 onBrowserCreated 鉤子(鉤子之註冊集中於橋接檔)')
        assert.deepStrictEqual(r.otherRoutes, [], '這些檔自行呼叫 routeBrowser(鉤子已套在最終回傳者上, 替身內不必自包 cdn.routeBrowser(await next()))')
        assert.ok(r.stubUsers.includes('api-wpwWiring.test.mjs'), '應掃到 api-wpwWiring.test.mjs 使用 setBrowserTypeForTest(偵測壞掉): ' + r.stubUsers)
    })

    it('R-FC-CDN-04 鉤子盤點器自檢: 對合成檔集能區分「已掛」「未掛」「鉤子不掛路由」「橋接檔仍用替身」「他檔自註冊/自包」「多處註冊」, 註解與字串中之字樣不算', function() {
        const P = (s) => path.resolve('/x', s)
        const B = P('tools/cdn.mjs')
        const A = P('a.test.mjs')
        const mk = (obj) => new Map(Object.entries(obj))
        const GOOD = 'import wpw from \'w-playwright\'\nexport function installCdn() {\n    wpw.onBrowserCreated((t) => cdn.routeBrowser(t))\n}'
        const STUB = 'wpw.setBrowserTypeForTest({ launch: async (o, next) => await next() })'
        const ok = analyzeHookWiring(mk({ [B]: GOOD, [A]: STUB }), B)
        assert.deepStrictEqual(ok, { bridgeHooks: 1, bridgeRoutes: true, bridgeStubs: 0, otherHooks: [], otherRoutes: [], stubUsers: ['a.test.mjs'] }, '已掛且無他檔自接線者不應被列入')
        const none = analyzeHookWiring(mk({ [B]: 'export function installCdn() {}', [A]: STUB }), B)
        assert.strictEqual(none.bridgeHooks, 0, '未掛鉤子者應被抓到')
        const empty = analyzeHookWiring(mk({ [B]: 'wpw.onBrowserCreated((t) => {})', [A]: STUB }), B)
        assert.deepStrictEqual([empty.bridgeHooks, empty.bridgeRoutes], [1, false], '鉤子不對 target 呼叫 cdn.routeBrowser 者應被抓到')
        const other = analyzeHookWiring(mk({ [B]: 'wpw.onBrowserCreated((t) => cdn.routeBrowser(t))\nwpw.onBrowserCreated(x)' }), B)
        assert.strictEqual(other.bridgeHooks, 2, '橋接檔多處註冊者應被抓到')
        const stubBridge = analyzeHookWiring(mk({ [B]: GOOD + '\n' + STUB }), B)
        assert.strictEqual(stubBridge.bridgeStubs, 1, '橋接檔仍以 setBrowserTypeForTest 接線者應被抓到')
        const wrap = analyzeHookWiring(mk({ [B]: GOOD, [A]: 'launch: async (o, next) => await cdn.routeBrowser(await next())' }), B)
        assert.deepStrictEqual(wrap.otherRoutes, ['a.test.mjs'], '替身內自包 cdn.routeBrowser(await next()) 者應被抓到')
        const own = analyzeHookWiring(mk({ [B]: GOOD, [A]: 'const r = wpw.onBrowserCreated((t) => x(t))' }), B)
        assert.deepStrictEqual(own.otherHooks, ['a.test.mjs'], '他檔自行註冊鉤子者應被抓到')
        const quiet = analyzeHookWiring(mk({ [B]: GOOD, [A]: '// wpw.onBrowserCreated(x) cdn.routeBrowser(await next())\nconst s = "cdn.routeBrowser(await next())"\nit(\'wpw.onBrowserCreated(\')' }), B)
        assert.deepStrictEqual([quiet.otherHooks, quiet.otherRoutes], [[], []], '註解與字串中之字樣不算')
    })

    it('R-FC-CDN-04 鉤子已掛(不起 Chrome): 替身(不呼叫 next, 回傳具 routeBrowser 介面之假 browser)啟動之結果亦已 isRouted', async function() {
        const fake = makeFakeBrowser()
        const b = await launchViaStub(() => fake)
        assert.strictEqual(b, fake, 'w-playwright 應原樣回傳替身之物件(鉤子就地對它動作)')
        assert.ok(cdn.isRouted(b), '經 w-playwright 啟動之 browser 未經 routeBrowser(installCdn 未掛啟動後鉤子)')
    })

    it('R-FC-CDN-04 鉤子之失敗語意: 替身回傳非 Playwright 物件(假物件缺 routeBrowser 所需介面)者啟動 reject E_LAUNCH_HOOK(以假物件驗接線之測試須先還原鉤子)', async function() {
        await assert.rejects(() => launchViaStub(() => ({})), err => err && err.code === 'E_LAUNCH_HOOK', '鉤子已掛時, 假物件應使啟動 reject E_LAUNCH_HOOK')
    })

    it('R-FC-CDN-04 installCdn() 回傳還原函數且只裝一次: 還原後啟動之 browser 不再掛路由、全域 fetch 還原; 再呼叫 installCdn() 重新掛上', async function() {
        const restore = installCdn()
        assert.strictEqual(typeof restore, 'function', 'installCdn() 應回傳還原函數')
        assert.strictEqual(installCdn(), restore, '已裝好時重複呼叫應回傳同一還原函數(只裝一次)')
        const patchedFetch = globalThis.fetch
        let restoredFetch = null
        restore()
        try {
            restoredFetch = globalThis.fetch
            assert.notStrictEqual(restoredFetch, patchedFetch, '還原後全域 fetch 應不再是補丁版')
            const plain = {}
            const b = await launchViaStub(() => plain) // 鉤子已還原: 假物件不再使啟動 reject
            assert.strictEqual(b, plain)
            assert.ok(!cdn.isRouted(b), '還原後啟動之物件不應被掛路由')
        }
        finally {
            installCdn() // 無論成敗皆重新掛上(其後各案依賴之)
        }
        assert.notStrictEqual(globalThis.fetch, restoredFetch, '重新安裝後全域 fetch 應為補丁版')
        const fake = makeFakeBrowser()
        assert.ok(cdn.isRouted(await launchViaStub(() => fake)), '重新安裝後啟動之 browser 應已掛路由')
    })

    it('R-FC-CDN-04 installCdn() 之回滾與身分守衛: patchFetch 失敗時撤回已掛之鉤子並原樣拋錯(重試可成功); 舊還原函數於重裝後呼叫不影響新安裝', async function() {
        const restore0 = installCdn()
        restore0() // 先還原, 使下一次 installCdn() 真的重裝
        const realPatch = cdn.patchFetch
        try {
            cdn.patchFetch = () => {
                throw new Error('fake: patchFetch failed')
            }
            assert.throws(() => installCdn(), /fake: patchFetch failed/, 'patchFetch 失敗應原樣往外拋(不靜默略過)')
            const plain = {}
            const b = await launchViaStub(() => plain) // 回滾後鉤子已撤回: 假物件不使啟動 reject
            assert.strictEqual(b, plain)
            assert.ok(!cdn.isRouted(b), '安裝失敗後不應殘留已掛之鉤子')
            cdn.patchFetch = realPatch
            const restore1 = installCdn() // 旗標未設, 重試成功
            assert.notStrictEqual(restore1, restore0, '重裝應得新的還原函數')
            restore0() // 舊還原函數於重裝後呼叫: 不得使旗標歸零或撤掉新安裝
            assert.strictEqual(installCdn(), restore1, '舊還原函數不得使旗標歸零(否則下次 installCdn() 會重複掛一份鉤子)')
            assert.ok(cdn.isRouted(await launchViaStub(() => makeFakeBrowser())), '舊還原函數不得撤掉新安裝之鉤子')
        }
        finally {
            cdn.patchFetch = realPatch
            installCdn() // 無論成敗皆確保已安裝(其後各案依賴之)
        }
    })

    it('R-FC-CDN-05 src 不含測試接縫(產品之預設行為不變): src 內無 createCdnLocal、w-package-tools-e2e、cdn.manifest、W_CDN、setBrowserTypeForTest、installCdn 字樣', function() {
        const files = readAll(srcDir, n => /\.(mjs|html)$/.test(n))
        assert.ok(files.size >= 12, '掃描到之 src 檔過少: ' + files.size)
        for (const [fp, txt] of files) {
            assert.ok(!/createCdnLocal|w-package-tools-e2e|cdn\.manifest|W_CDN|setBrowserTypeForTest|installCdn/.test(txt), path.relative(srcDir, fp) + ' 不得含測試接縫')
        }
    })

})
