// 測試不連 CDN 之橋接檔(規則帳本規則 3): 以共用庫 w-package-tools-e2e 之 createCdnLocal 建立本行程唯一之實例 cdn, 測試檔一律自此檔取用
//   cdn.ensure()                          取得點(各測試檔之 before; 掛 this.timeout(cdn.hookTimeoutMs))
//   cdn.violationMark() / cdn.assertNoViolation(mark)   自標記起無清單外之外部請求
//   cdn.routeBrowser(browser) / cdn.isRouted(target)    把頁面之外部網址導到本地副本 / 斷言沒有漏接
//   installCdn()                          本行程只裝一次(重複呼叫回傳同一還原函數; 呼叫還原函數則撤回兩者, 之後再呼叫即重裝):
//                                         ①w-playwright 之啟動後鉤子 wpw.onBrowserCreated((t) => cdn.routeBrowser(t)): 對每個最終回傳給呼叫端之 browser 掛路由
//                                           (本套件之單一啟動出口 src/common/launchBrowser.mjs 與測試端之直接啟動皆經此; 與 setBrowserTypeForTest 之替換正交, 測試檔之替身內不必自包路由;
//                                            鉤子之註冊只在此處; 替身若回傳非 Playwright 物件則啟動 reject E_LAUNCH_HOOK, 以假物件驗接線者須先還原);
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
let restoreAll = null
export function installCdn() {
    if (installed) return restoreAll
    // 啟動後鉤子: 對每個經 w-playwright 啟動、最終回傳給呼叫端之 browser 掛路由(與 setBrowserTypeForTest 之替換正交, 自設替身內直呼 next() 者亦生效; 全專案之註冊集中於此一處)
    const restoreHook = wpw.onBrowserCreated((t) => cdn.routeBrowser(t))
    let restoreFetch = null
    try {
        restoreFetch = cdn.patchFetch()
    }
    catch (err) {
        restoreHook() // patchFetch 失敗: 撤回已掛之鉤子(重試時不疊兩份)
        throw err
    }
    const restore = () => {
        if (restoreAll !== restore) return // 已還原(或已被較新之安裝取代)者再呼叫無作用
        restoreHook()
        restoreFetch()
        installed = false
        restoreAll = null
    }
    restoreAll = restore
    installed = true // 兩者皆成功才算裝好(任一拋錯則旗標不設, 同 worker 之後續檔再呼叫時重試, 不靜默略過)
    return restore
}
