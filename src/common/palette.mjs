// 標準語意色票:類別(cls)→ 顏色/形狀。所有產線(pN)共用同一套色, 確保 10 套出圖視覺一致。
//   一般節點為 box; diamond 為決策菱形; cls 結尾為 G / G2 者為「群組容器」(較淺填色, 標題置頂)。
export const PALETTE = {
    // 一般節點
    blue: { fill: '#eef4fb', stroke: '#3f6fb0', text: '#1c2b36', shape: 'box' },
    green: { fill: '#eaf4ef', stroke: '#348a5c', text: '#1c2b36', shape: 'box' },
    orange: { fill: '#fcf0e2', stroke: '#c46e1a', text: '#1c2b36', shape: 'box' },
    purple: { fill: '#f4f0fa', stroke: '#8163ad', text: '#23303a', shape: 'box' },
    red: { fill: '#fbecea', stroke: '#c0392b', text: '#23303a', shape: 'box' },
    done: { fill: '#eaf4ef', stroke: '#256046', text: '#256046', shape: 'box' },
    // 決策(菱形)
    diamond: { fill: '#fcf0e2', stroke: '#c46e1a', text: '#23303a', shape: 'diamond' },
    // 群組容器(較淺填色, group:true)
    blueG: { fill: '#f5f9fe', stroke: '#3f6fb0', text: '#3f6fb0', group: true },
    blueG2: { fill: '#eef4fb', stroke: '#3f6fb0', text: '#3f6fb0', group: true },
    greenG: { fill: '#f0f7f3', stroke: '#348a5c', text: '#348a5c', group: true },
    greenG2: { fill: '#eaf4ef', stroke: '#348a5c', text: '#348a5c', group: true },
    orangeG: { fill: '#fdf6ec', stroke: '#c46e1a', text: '#c46e1a', group: true },
    purpleG: { fill: '#faf7fd', stroke: '#8163ad', text: '#8163ad', group: true },
}

// 邊樣式
//   textBg 一律「透明」(不可用不透明白底遮線, 否則轉折線會看似中斷);
//   文字清晰度改以「白色光暈/描邊」達成(halo): 各產線以該庫機制實作
//   (SVG paint-order:stroke + stroke:white / canvas strokeText / CSS text-shadow), 全域一致。
export const EDGE = { line: '#44505a', text: '#4a5560', textBg: 'transparent', haloColor: '#ffffff', haloWidth: 3.5 }

// 字型(中文)
export const FONT = '\'Microsoft JhengHei\', sans-serif'

// 工具:判斷 cls 是否為群組容器
export const isGroupCls = cls => /G2?$/.test(cls || '')
// 工具:取某 cls 之色票(查無則回 blue)
export const colorOf = cls => PALETTE[cls] || PALETTE.blue
