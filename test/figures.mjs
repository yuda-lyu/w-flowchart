// 9 張真圖正規化數據索引(供回歸測試): 讀 test/data/*.json, 衍生 rich 節點 label
import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { deriveLabels } from '../src/common/derive.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const KEYS = ['系統架構圖', '系統關聯圖', '作業流程圖', '線上畫面關聯圖', '程式分層架構圖', '程式元件組成圖', '後端服務組成圖', '批次上傳處理流程圖', '前端架構與資料流圖']

export const FIGURES = KEYS.map(key => ({ key, data: deriveLabels(JSON.parse(fs.readFileSync(resolve(__dir, 'data', key + '.json'), 'utf8'))) }))
