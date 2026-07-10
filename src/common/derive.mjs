// rich 節點(title+items)→ 自動衍生 label「標題(item1/item2)」給 p1~p9 當回退(p10 用 title+items 分層渲染)。純 label 節點不受影響。
//   括號/分隔符用半形, 英文數據亦通用。
export function deriveLabels(d) {
    d.nodes.forEach(n => {
        if (n.title && n.label == null) n.label = n.title + (n.items && n.items.length ? ' (' + n.items.join('/') + ')' : '')
    }); return d
}
