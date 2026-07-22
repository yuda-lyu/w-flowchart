// 繪圖庫 CDN 定位: 各瀏覽器產線(p1~p4, p6~p10)之繪圖庫改由 jsDelivr CDN 載入(免安裝)。
//   本套件定位為背景產圖服務, 繪圖庫僅在 headless 瀏覽器頁面內執行, 故不再列為 npm 依賴,
//   而於渲染頁以 <script src> / <link> / ESM import 直接向 CDN 取用。
//   版本一律「精確鎖定」對齊原 package.json 安裝版本, 確保渲染結果與 pixel baseline 一致。
//   註: p5(@terrastruct/d2 + sharp)在 Node 端執行, 無瀏覽器 CDN 路徑, 仍為 npm 依賴, 不在此表。
const BASE = 'https://cdn.jsdelivr.net/npm/'

// 各繪圖庫之 CDN 相對路徑(含精確版本): key 為產線內使用之語意名
const PKG = {
    // p1 — mermaid@10 UMD
    'mermaid10': 'mermaid@10.9.6/dist/mermaid.min.js',
    // p2 — mermaid@11 + layout-elk(ESM, 供 import() 動態載入)
    'mermaid11-esm': 'mermaid@11.16.0/dist/mermaid.esm.min.mjs',
    'layout-elk-esm': '@mermaid-js/layout-elk@0.2.2/dist/mermaid-layout-elk.esm.min.mjs',
    // p3 — nomnoml(依賴全域 graphre, 須先載 graphre)
    'graphre': 'graphre@0.1.3/dist/graphre.js',
    'nomnoml': 'nomnoml@1.7.0/dist/nomnoml.js',
    // p4 — cytoscape + dagre + 外掛
    'cytoscape': 'cytoscape@3.34.0/dist/cytoscape.min.js',
    'cytoscape-dagre': 'cytoscape-dagre@4.0.0/dist/cytoscape-dagre.js',
    'cytoscape-svg': 'cytoscape-svg@0.4.0/cytoscape-svg.js',
    // p6 — AntV G6 v5(+ genSvg 專用 g-lite/g-svg UMD renderer)
    'g6': '@antv/g6@5.1.1/dist/g6.min.js',
    'g-lite': '@antv/g-lite@2.7.0/dist/index.umd.min.js',
    'g-svg': '@antv/g-svg@2.1.1/dist/index.umd.min.js',
    // p7 — JointJS
    'joint': '@joint/core@4.3.0/dist/joint.min.js',
    // p8 — LogicFlow(js + css)
    'logicflow': '@logicflow/core@2.2.4/dist/index.min.js',
    'logicflow-css': '@logicflow/core@2.2.4/dist/index.css',
    // p9 — React Flow(react/react-dom/@xyflow/react UMD + css)
    'react': 'react@18.3.1/umd/react.production.min.js',
    'react-dom': 'react-dom@18.3.1/umd/react-dom.production.min.js',
    'xyflow': '@xyflow/react@12.11.2/dist/umd/index.js',
    'xyflow-css': '@xyflow/react@12.11.2/dist/style.css',
    // p9 layout — @dagrejs/dagre(新版 dagre, 與 p4/p7/p8 用之 dagre@0.8 為不同套件)
    'dagrejs-dagre': '@dagrejs/dagre@1.1.8/dist/dagre.min.js',
    // p4/p7/p8 layout — dagre@0.8 UMD
    'dagre': 'dagre@0.8.5/dist/dagre.min.js',
    // p10 — elkjs UMD
    'elkjs': 'elkjs@0.11.1/lib/elk.bundled.js',
}

// key → 完整 CDN 網址(供 ESM import 或 CSS <link> 使用)
export function cdnUrl(key) {
    const rel = PKG[key]
    if (!rel) throw new Error('未知 CDN 套件鍵: ' + key)
    return BASE + rel
}

// key → <script src="..."></script> 標籤(供 UMD 繪圖庫以外部腳本載入; 非 async, 保留文件順序執行)
export function cdnScript(key) {
    return `<script src="${cdnUrl(key)}"></script>`
}

// key → <link rel="stylesheet" href="..."> 標籤(供繪圖庫附帶 CSS 載入)
export function cdnStyle(key) {
    return `<link rel="stylesheet" href="${cdnUrl(key)}">`
}

// key → 該 CDN 資源之文字內容(Node 端 fetch 取回並快取)。
//   供需「內嵌內容」而非「外部連結」之場景: 如 p8 genSvg 須把 LogicFlow CSS 併入 standalone SVG 才能脫離頁面忠實呈現。
const _textCache = {}
export async function cdnFetchText(key) {
    if (_textCache[key] === undefined) {
        const url = cdnUrl(key)
        const res = await fetch(url)
        if (!res.ok) throw new Error(`CDN 取檔失敗 ${res.status}: ${url}`)
        _textCache[key] = await res.text()
    }
    return _textCache[key]
}
