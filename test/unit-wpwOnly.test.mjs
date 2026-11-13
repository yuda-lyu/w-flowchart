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
        assert.ok(/^\^1\.0\.1$|^\^1\.[1-9]|^\^[2-9]/.test(pkg.dependencies['w-playwright']), 'w-playwright 版本範圍: ' + pkg.dependencies['w-playwright'])
    })

    it('toolg/gDistRollup.mjs 之 external 與 globals 以 w-playwright 取代 playwright', function() {
        const txt = fs.readFileSync(join(root, 'toolg', 'gDistRollup.mjs'), 'utf8')
        assert.ok(/'w-playwright': 'w-playwright'/.test(txt), 'globals 應含 w-playwright')
        assert.ok(/^\s*'w-playwright',\s*$/m.test(txt), 'external 應含 w-playwright')
        assert.ok(!new RegExp('[\'"]' + NAME + '(-core)?[\'"]').test(txt), 'toolg/gDistRollup.mjs 不應再列 ' + NAME)
    })

    it('已安裝之 w-playwright 為 1.0.1 以上, 其 playwright-core 為精確 1.64.1(版本所有權在 w-playwright)', function() {
        const p = JSON.parse(fs.readFileSync(join(root, 'node_modules', 'w-playwright', 'package.json'), 'utf8'))
        const [a, b, c] = p.version.split('.').map(Number)
        assert.ok(a > 1 || (a === 1 && (b > 0 || c >= 1)), 'w-playwright 版本: ' + p.version)
        assert.strictEqual(p.dependencies['playwright-core'], '1.64.1')
    })

})
