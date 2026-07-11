// 12 張範例圖正規化數據索引(供回歸測試): 讀 test/data/*.json, 衍生 rich 節點 label
//   數據皆為泛用虛構情境(架構類/流程類/關聯組成類), 結構覆蓋: 巢狀容器/富節點/菱形循環/LR與TB/群組邊/A4折排/align
import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { deriveLabels } from '../src/common/derive.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const KEYS = ['電商平台架構圖', '微服務叢集架構圖', '物聯網平台架構圖', '系統分層架構圖', '訂單處理流程圖', '會員註冊流程圖', '資料清洗流程圖', '工單處理流程圖', '模組組成圖', '頁面導覽關聯圖', '資料流向圖', '權限角色關聯圖']

export const FIGURES = KEYS.map(key => ({ key, data: deriveLabels(JSON.parse(fs.readFileSync(resolve(__dir, 'data', key + '.json'), 'utf8'))) }))
