import path from 'path'
import rollupFiles from 'w-package-tools/src/rollupFiles.mjs'
import rollupWorker from 'w-package-tools/src/rollupWorker.mjs'


let fdSrc = './src'
let fdTar = './dist'

async function core() {

    await rollupFiles({ //rollupFiles預設會clean folder
        fns: 'WFlowchart.mjs',
        fdSrc,
        fdTar,
        nameDistType: 'kebabCase',
        globals: {
            '@terrastruct/d2': '@terrastruct/d2',
            'playwright': 'playwright',
            'sharp': 'sharp',
        },
        external: [ //繪圖庫多為 fs 直讀內聯注入頁面(非 import), 仍列 external 保險, 避免任何路徑被打包進 dist
            '@terrastruct/d2',
            'playwright',
            'sharp',
            'mermaid10',
            'mermaid11',
            '@mermaid-js/layout-elk',
            'nomnoml',
            'graphre',
            'cytoscape',
            'cytoscape-dagre',
            'dagre',
            '@antv/g6',
            '@antv/g-lite',
            '@antv/g-svg',
            'cytoscape-svg',
            '@joint/core',
            '@logicflow/core',
            'react',
            'react-dom',
            '@xyflow/react',
            '@dagrejs/dagre',
            'elkjs',
        ],
    })
        .catch((err) => {
            console.log(err)
        })

}
core()
    .catch((err) => {
        console.log(err)
    })
