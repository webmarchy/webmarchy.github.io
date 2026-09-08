const ClipboardHistory = {
    /**
     * @param {*} value
     * @returns {{type: string, text?: string, path?: string, mime?: string, capturedAt?: string} | null}
     */
    normalizeEntry(value) {
        if (typeof value === 'string')
            return value.trim().length > 0 ? { type: 'text', text: value } : null

        if (!value || typeof value !== 'object') return null

        const type = String(value.type || value.kind || '')
        if (type === 'text') {
            const text = String(value.text || '')
            return text.trim().length > 0 ? { type: 'text', text } : null
        }

        if (type === 'image') {
            const path = String(value.path || '')
            if (!path) return null
            /** @type {{type: string, path: string, mime: string, capturedAt?: string}} */
            const entry = {
                type: 'image',
                path,
                mime: String(value.mime || 'image/png'),
            }
            if (value.capturedAt !== undefined && value.capturedAt !== null)
                entry.capturedAt = String(value.capturedAt)
            return entry
        }

        return null
    },

    /** @param {*} entry */
    entryKey(entry) {
        if (!entry) return ''
        if (entry.type === 'image') return 'image:' + String(entry.path || '')
        return 'text:' + String(entry.text || '')
    },

    /**
     * @param {*} raw
     * @returns {any[]}
     */
    parseHistory(raw) {
        try {
            const parsed = JSON.parse(String(raw || '[]'))
            const next = []
            if (!Array.isArray(parsed)) return next
            for (const value of parsed) {
                const entry = this.normalizeEntry(value)
                if (entry) next.push(entry)
            }
            return next
        } catch {
            return []
        }
    },

    /**
     * @param {*} history @param {*} entry @param {*} [limit]
     * @returns {any[]}
     */
    addEntry(history, entry, limit) {
        const normalized = this.normalizeEntry(entry)
        let max = limit === undefined || limit === null ? 100 : Number(limit)
        if (isNaN(max)) max = 100
        max = Math.max(0, max)
        if (!normalized) return Array.isArray(history) ? history.slice(0, max) : []
        if (max === 0) return []

        const key = this.entryKey(normalized)
        const next = [normalized]
        const values = Array.isArray(history) ? history : []

        for (let i = 0; i < values.length && next.length < max; i++) {
            const existing = this.normalizeEntry(values[i])
            if (!existing || this.entryKey(existing) === key) continue
            next.push(existing)
        }

        return next
    },

    /** @param {*} history @param {*} index @returns {any[]} */
    removeEntryAt(history, index) {
        const values = Array.isArray(history) ? history : []
        const target = Number(index)
        if (isNaN(target) || target < 0 || target >= values.length) return values.slice()

        const next = values.slice()
        next.splice(target, 1)
        return next
    },

    clearHistory() {
        return []
    },

    /** @param {*} entry */
    searchableText(entry) {
        if (!entry) return ''
        if (entry.type === 'image') return 'image screenshot ' + String(entry.mime || '') + ' ' + String(entry.capturedAt || '')
        return String(entry.text || '') + ' ' + this.fileEntryText(entry)
    },

    /** @param {*} uri */
    decodeFileUri(uri) {
        const value = String(uri || '').trim()
        if (value.indexOf('file://') !== 0) return ''

        let path = value.substring(7)
        if (path.indexOf('localhost/') === 0) path = path.substring(9)
        if (path.charAt(0) !== '/') return ''

        try { return decodeURIComponent(path) } catch { return path }
    },

    /**
     * @param {*} entry @returns {string[]}
     */
    filePaths(entry) {
        if (!entry || entry.type !== 'text') return []

        const lines = String(entry.text || '').split(/\r?\n/)
        const paths = []
        for (const line of lines) {
            const path = this.decodeFileUri(line)
            if (path) paths.push(path)
        }
        return paths
    },

    /** @param {*} path */
    fileName(path) {
        const parts = String(path || '').split('/')
        return parts.length > 0 ? parts[parts.length - 1] : String(path || '')
    },

    /** @param {*} path */
    isImagePath(path) {
        return /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(String(path || ''))
    },

    /** @param {*} entry */
    fileEntryText(entry) {
        const paths = this.filePaths(entry)
        if (paths.length === 0) return ''
        if (paths.length === 1) return this.fileName(paths[0])
        return paths.length + ' files'
    },

    /** @param {*} entry */
    imagePreviewText(entry) {
        const timestamp = String((entry && entry.capturedAt) || '')
        if (!timestamp) return 'Image'

        const label = String((entry && entry.mime) || '') === 'image/png' ? 'Screenshot' : 'Image'
        return label + ' from ' + timestamp
    },

    /** @param {*} entry */
    previewText(entry) {
        if (!entry) return ''
        if (entry.type === 'image') return this.imagePreviewText(entry)
        const fileText = this.fileEntryText(entry)
        if (fileText) return fileText
        return String(entry.text || '').replace(/\s+/g, ' ')
    },

    /** @param {*} entry */
    fullText(entry) {
        if (!entry) return ''
        const paths = this.filePaths(entry)
        if (paths.length > 0) return paths.join('\n')
        return String(entry.text || '')
    },

    displayTextLimit: 8192,

    /** @param {*} entry */
    cappedEntry(entry) {
        if (!entry || entry.type !== 'text' || entry.text.length <= this.displayTextLimit) return entry

        const cut = entry.text.lastIndexOf('\n', this.displayTextLimit)
        return { type: 'text', text: entry.text.slice(0, cut > 0 ? cut : this.displayTextLimit) }
    },

    /**
     * @param {*} history @param {*} query @param {*} [limit]
     * @returns {{entryType: string, fullText: string, previewText: string,
     *   previewImage: string, path: string, mime: string, index: number}[]}
     */
    displayRows(history, query, limit) {
        const values = Array.isArray(history) ? history : []
        const needle = String(query || '').trim().toLowerCase()
        let max = limit === undefined || limit === null ? 50 : Number(limit)
        if (isNaN(max)) max = 50
        max = Math.max(0, max)
        if (max === 0) return []

        const rows = []

        for (let i = 0; i < values.length; i++) {
            const entry = this.cappedEntry(this.normalizeEntry(values[i]))
            if (!entry) continue
            if (needle && this.searchableText(entry).toLowerCase().indexOf(needle) < 0) continue

            const paths = this.filePaths(entry)
            const isFile = paths.length > 0
            const isImage = entry.type === 'image'
            const previewPath = isImage
                ? String(entry.path || '')
                : (isFile && paths.length === 1 && this.isImagePath(paths[0]) ? paths[0] : '')
            rows.push({
                entryType: isFile ? 'file' : entry.type,
                fullText: isImage ? '' : this.fullText(entry),
                previewText: this.previewText(entry),
                previewImage: previewPath,
                path: isImage ? String(entry.path || '') : (isFile && paths.length === 1 ? paths[0] : ''),
                mime: isImage ? String(entry.mime || 'image/png') : 'text/plain',
                index: i,
            })
            if (rows.length >= max) break
        }

        return rows
    },
}
Object.freeze(ClipboardHistory)
