const Settings = {
    _KEY: 'omarchy',

    /** @returns {Record<string, any>} */
    _read() {
        try {
            const raw = localStorage.getItem(this._KEY)
            const parsed = raw ? JSON.parse(raw) : null
            return typeof parsed === 'object' && parsed !== null ? parsed : {}
        } catch {
            return {}
        }
    },

    /**
     * @param {string} path
     * @param {*} [fallback]
     */
    get(path, fallback) {
        let node = this._read()
        for (const part of path.split('.')) {
            if (typeof node !== 'object' || node === null || !(part in node)) {
                return fallback
            }
            node = node[part]
        }
        return node ?? fallback
    },

    /**
     * @param {string} path
     * @param {*} value
     */
    set(path, value) {
        try {
            const blob = this._read()
            const parts = path.split('.')
            let node = blob
            for (const part of parts.slice(0, -1)) {
                if (typeof node[part] !== 'object' || node[part] === null) {
                    node[part] = {}
                }
                node = node[part]
            }
            node[parts[parts.length - 1]] = value
            localStorage.setItem(this._KEY, JSON.stringify(blob))
        } catch {
        }
    },
}
