// 測試不連 CDN 之橋接檔(規則帳本規則 3): 以共用庫 w-package-tools-e2e 之 createCdnLocal 建立本行程唯一之實例 cdn, 測試檔一律自此檔取用
//   cdn.ensure()                          取得點(各測試檔之 before; 掛 this.timeout(cdn.hookTimeoutMs))
//   cdn.violationMark() / cdn.assertNoViolation(mark)   自標記起無清單外之外部請求
//   cdn.routeBrowser(browser) / cdn.isRouted(target)    把頁面之外部網址導到本地副本 / 斷言沒有漏接
//   installCdn()                          本行程只裝一次: ①w-playwright 之 setBrowserTypeForTest 於 launch 回傳之 browser 呼叫 routeBrowser(本套件之單一啟動出口 src/common/launchBrowser.mjs 與測試端之直接啟動皆經此);
//                                         ②cdn.patchFetch()(Node 端 p8 之 cdnFetchText)
//   清單 test/tools/cdn.manifest.json 由 test/tools/cdn.roots.mjs(即 src/common/cdn.mjs 之 PKG 表)經共用庫之 tools/genCdnManifest.mjs 產生; 快取 test/_cache/cdn(不入版控、不入包)
//   離線: 環境變數 W_CDN_OFFLINE=1(快取缺檔不連網, 直接 E_CDN_OFFLINE_MISSING)
import path from 'path'
import { fileURLToPath } from 'url'
import wpw from 'w-playwright'
import createCdnLocal from 'w-package-tools-e2e/src/createCdnLocal.mjs'

const __dir = path.dirname(fileURLToPath(import.meta.url))

export const MANIFEST_PATH = path.resolve(__dir, 'cdn.manifest.json')
export const CACHE_DIR = path.resolve(__dir, '..', '_cache', 'cdn') // 以檔案位置定位(不隨 process.cwd()), 使各 mocha worker 與子行程共用同一資料夾

// allowLoopback: false —— 本套件之頁面皆為 setContent、不連本機伺服器, 回送位址之請求亦視為外部請求(預設拒絕, 不放行)
export const cdn = createCdnLocal({ manifest: MANIFEST_PATH, cacheDir: CACHE_DIR, allowLoopback: false })

let installed = false
export function installCdn() {
    if (installed) return
    wpw.setBrowserTypeForTest({ launch: async (o, next) => await cdn.routeBrowser(await next()) })
    cdn.patchFetch()
    installed = true // 兩者皆成功才算裝好(任一拋錯則旗標不設, 同 worker 之後續檔再呼叫時重試, 不靜默略過)
}
