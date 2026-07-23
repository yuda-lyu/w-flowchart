import path from 'path'
import rollupFiles from 'w-package-tools/src/rollupFiles.mjs'
import rollupWorker from 'w-package-tools/src/rollupWorker.mjs'


let fdSrc = './src'
let fdTar = './dist'

rollupFiles({ //rollupFiles預設會clean folder
    fns: 'WFlowchart.mjs',
    fdSrc,
    fdTar,
    nameDistType: 'kebabCase',
    globals: {
        '@terrastruct/d2': '@terrastruct/d2',
        'playwright': 'playwright',
        'sharp': 'sharp',
    },
    external: [ //Node 端執行期依賴(原生/重, 不打包進 dist); 繪圖庫已改由 CDN 於頁面內載入, 非 import, 無須列此
        '@terrastruct/d2',
        'playwright',
        'sharp',
    ],
})
