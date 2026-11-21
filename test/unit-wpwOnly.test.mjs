// 啟動一律經 w-playwright 之盤點測試(規則帳本 R-FC-WPW-03; w-playwright 之 R-PW-ONLY), 不啟動瀏覽器
//   src、test、toolg 之 .mjs/.js 不得以靜態匯入、動態 import()、require 引用 playwright / playwright-core;
//   package.json 之 dependencies/devDependencies/peerDependencies/optionalDependencies 不得宣告兩者, 且須宣告 w-playwright
import assert from 'assert'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve, join } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dir, '..')
const SELF = fileURLToPath(import.meta.url)

// 正則以字串拼接, 使本檔自身不命中(同時另以 SELF 排除)
const NAME = 'playwright'
const RE = new RegExp('(from\\s+|import\\(\\s*|require\\(\\s*)[\'"`]' + NAME + '(-core)?[\'"`/]')

// 版本比較(x.y.z 逐段數值比較); 不以字面正則判範圍, 免上游每升一版即失效(2026-11-21 w-playwright 1.0.1 → 1.0.2 時之殷鑑)
function cmpVer(a, b) {
    const pa = String(a).split('.').map(Number)
    const pb = String(b).split('.').map(Number)
    for (let i = 0; i < 3; i++) {
        if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
    }
    return 0
}

// 實裝之 playwright-core 版本(提升至根或巢狀於 w-playwright 之下)
function installedPwCore() {
    for (const p of [join(root, 'node_modules', NAME + '-core', 'package.json'), join(root, 'node_modules', 'w-playwright', 'node_modules', NAME + '-core', 'package.json')]) {
        if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')).version
    }
    return null
}

function walk(dir, out) {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        if (d.name === 'node_modules' || d.name === 'dist' || d.name === '_tmp' || d.name === 'pics') continue
        const p = join(dir, d.name)
        if (d.isDirectory()) walk(p, out)
        else if (/\.(mjs|js)$/.test(d.name)) out.push(p)
    }
    return out
}

describe('啟動一律經 w-playwright(R-PW-ONLY 於本套件)', function() {

    it('src、test、toolg 之 .mjs/.js 無任何 playwright / playwright-core 之匯入(防空集合: 掃描檔數 > 0 且正則可命中範例)', function() {
        const files = ['src', 'test', 'toolg'].flatMap(d => walk(join(root, d), []))
        assert.ok(files.length > 30, '掃描檔數過少: ' + files.length)
        // 正則自檢: 可命中四種寫法, 否則掃描為空轉
        for (const s of [`from '${NAME}'`, `from "${NAME}-core"`, `import('${NAME}')`, `require('${NAME}/lib/x')`]) {
            assert.ok(RE.test(s), '正則未命中範例: ' + s)
        }
        const hits = []
        for (const f of files) {
            if (f === SELF) continue
            const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/)
            lines.forEach((ln, i) => {
                if (RE.test(ln)) hits.push(f.slice(root.length + 1) + ':' + (i + 1))
            })
        }
        assert.deepStrictEqual(hits, [])
    })

    it('package.json 不宣告 playwright / playwright-core, 且 dependencies 含 w-playwright(^1.0.1 以上)', function() {
        const pkg = JSON.parse(fs.readFileSync(join(root, 'package.json'), 'utf8'))
        for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
            const o = pkg[k] || {}
            assert.ok(!(NAME in o), k + ' 不應宣告 ' + NAME)
            assert.ok(!(NAME + '-core' in o), k + ' 不應宣告 ' + NAME + '-core')
        }
        const m = /^\^(\d+\.\d+\.\d+)$/.exec(pkg.dependencies['w-playwright'] || '')
        assert.ok(m && cmpVer(m[1], '1.0.1') >= 0, 'w-playwright 版本範圍須為 ^x.y.z 且 >= 1.0.1: ' + pkg.dependencies['w-playwright'])
    })

    it('toolg/gDistRollup.mjs 之 external 與 globals 以 w-playwright 取代 playwright', function() {
        const txt = fs.readFileSync(join(root, 'toolg', 'gDistRollup.mjs'), 'utf8')
        assert.ok(/'w-playwright': 'w-playwright'/.test(txt), 'globals 應含 w-playwright')
        assert.ok(/^\s*'w-playwright',\s*$/m.test(txt), 'external 應含 w-playwright')
        assert.ok(!new RegExp('[\'"]' + NAME + '(-core)?[\'"]').test(txt), 'toolg/gDistRollup.mjs 不應再列 ' + NAME)
    })

    it('已安裝之 w-playwright 為 1.0.1 以上, 其 playwright-core 以精確版號釘選且與實裝一致(版本所有權在 w-playwright, 本庫不寫死哪一版)', function() {
        const p = JSON.parse(fs.readFileSync(join(root, 'node_modules', 'w-playwright', 'package.json'), 'utf8'))
        assert.ok(cmpVer(p.version, '1.0.1') >= 0, 'w-playwright 版本: ' + p.version)
        const pin = p.dependencies['playwright-core']
        assert.ok(/^\d+\.\d+\.\d+$/.test(pin), 'w-playwright 須以精確版號釘 playwright-core: ' + pin)
        assert.strictEqual(installedPwCore(), pin)
    })

})
