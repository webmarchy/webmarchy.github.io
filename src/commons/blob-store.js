const BlobStore = {
    _NAME: 'omarchy-blobs',
    _STORE: 'blobs',
    /** @type {Promise<IDBDatabase | null> | null} */
    _db: null,

    /** @returns {Promise<IDBDatabase | null>} */
    _open() {
        if (this._db) return this._db
        this._db = new Promise(resolve => {
            try {
                const request = indexedDB.open(this._NAME, 1)
                request.onupgradeneeded = () => {
                    request.result.createObjectStore(this._STORE)
                }
                request.onsuccess = () => resolve(request.result)
                request.onerror = () => resolve(null)
                request.onblocked = () => resolve(null)
            } catch {
                resolve(null)
            }
        })
        return this._db
    },

    /**
     * @param {IDBTransactionMode} mode
     * @param {(store: IDBObjectStore) => IDBRequest} run
     * @returns {Promise<*>}
     */
    async _transact(mode, run) {
        const db = await this._open()
        if (!db) return null
        return new Promise(resolve => {
            try {
                const tx = db.transaction(this._STORE, mode)
                const request = run(tx.objectStore(this._STORE))
                tx.oncomplete = () => resolve(request.result)
                tx.onerror = () => resolve(null)
                tx.onabort = () => resolve(null)
            } catch {
                resolve(null)
            }
        })
    },

    /**
     * @param {string} key
     * @param {Blob} blob
     * @returns {Promise<*>}
     */
    put(key, blob) {
        return this._transact('readwrite', store => store.put(blob, key))
    },

    /**
     * @param {string} key
     * @returns {Promise<Blob | null>}
     */
    async get(key) {
        const value = await this._transact('readonly', store => store.get(key))
        return value instanceof Blob ? value : null
    },

    /**
     * @param {string} key
     * @returns {Promise<*>}
     */
    remove(key) {
        return this._transact('readwrite', store => store.delete(key))
    },

    /**
     * @param {string} prefix
     * @returns {Promise<*>}
     */
    clearPrefix(prefix) {
        return this._transact('readwrite', store =>
            store.delete(IDBKeyRange.bound(prefix, `${prefix}\uffff`)))
    },

    /**
     * @param {Set<string>} liveIds
     * @returns {Promise<void>}
     */
    async sweep(liveIds) {
        const keys = await this._transact('readonly', store => store.getAllKeys())
        if (!Array.isArray(keys)) return
        for (const key of keys) {
            if (!liveIds.has(String(key).split('/')[0])) {
                await this.remove(String(key))
            }
        }
    },

    /** @returns {Promise<*>} */
    clearAll() {
        return this._transact('readwrite', store => store.clear())
    },
}
