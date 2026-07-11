// p5 渲染回歸(mocha) — 與 p10 相同測試輸入之 PNG 快照基準(共用邏輯見 snapshot.mjs)
//   D2 WASM+dagre 對 18-20 節點圖單張可達 20-40s, 平行執行下再受 CPU 競爭 → 放寬單案逾時
import { definePngSuite } from './snapshot.mjs'
import { genPng } from '../src/p5/gen.mjs'

definePngSuite('p5', genPng, { timeout: 180000 })
