/**
 * Pure emoji filtering for the emoji picker — a direct port of upstream
 * `shell/plugins/emojis/EmojiSearch.js`, kept DOM-free. Matching is a
 * plain case-insensitive substring test against each entry's keyword
 * text, capped like upstream so an empty query doesn't build the whole
 * catalog's worth of cells.
 *
 * Everything lives on the single `EmojiSearch` namespace to keep the
 * shared global scope down to one name.
 */
const EmojiSearch = {
    /** @param {*} query */
    normalizedQuery(query) {
        return String(query || '').trim().toLowerCase()
    },

    /** @param {*} item */
    keywordText(item) {
        return String((item && item.k) || '').toLowerCase()
    },

    /**
     * @param {*} emojis @param {*} query @param {*} [limit]
     * @returns {{e: string, k: string}[]}
     */
    filterEmojis(emojis, query, limit) {
        const values = Array.isArray(emojis) ? emojis : []
        const needle = this.normalizedQuery(query)
        let max = limit === undefined || limit === null ? 1000 : Number(limit)
        if (isNaN(max)) max = 1000
        max = Math.max(0, max)
        if (max === 0) return []

        const out = []
        for (const item of values) {
            if (!item || !item.e) continue
            if (!needle || this.keywordText(item).indexOf(needle) >= 0) {
                out.push(item)
                if (out.length >= max) break
            }
        }
        return out
    },
}
Object.freeze(EmojiSearch)
