// p7 渲染回歸(mocha) — 與 p10 相同測試輸入之 PNG 快照基準(共用邏輯見 snapshot.mjs)
import { definePngSuite } from './snapshot.mjs'
import { genPng } from '../src/p7/gen.mjs'

definePngSuite('p7', genPng)
