/**
 * Pure device math for the bluetooth panel — a port of upstream
 * `shell/plugins/panels/bluetooth/Model.js`, kept DOM-free and
 * API-free: label fallbacks, junk-name filtering, section grouping,
 * and the pending-action map helpers. Rows are plain objects
 * (`{id, name, deviceName, connected, known}`) so the same math serves
 * upstream's BlueZ shapes and the Web Bluetooth projection alike.
 *
 * Everything lives on the single `BluetoothModel` namespace to keep
 * the shared global scope down to one name.
 */
const BluetoothModel = {
    /**
     * Display name: the alias wins over the remote name, trimmed.
     * @param {*} device
     */
    deviceLabel(device) {
        if (!device) return ''
        const label = String(device.deviceName || device.name || '')
        return label.trim()
    },

    /**
     * UUID-shaped strings are firmware junk, not names: standard UUIDs,
     * 32-digit hex, 0x-prefixed hex, and Bluetooth service UUIDs.
     * @param {*} value
     */
    isUuidLike(value) {
        const text = String(value || '').trim()
        if (!text) return false
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)
            || /^[0-9a-f]{32}$/i.test(text)
            || /^0x[0-9a-f]+$/i.test(text)
    },

    /**
     * MAC-shaped strings (colon or dash separated) are addresses leaked
     * into the name field, not names.
     * @param {*} value
     */
    isAddressLike(value) {
        const text = String(value || '').trim()
        return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(text)
            || /^([0-9a-f]{2}-){5}[0-9a-f]{2}$/i.test(text)
    },

    /**
     * A device worth listing: it has a label that reads as a name
     * rather than a UUID or address.
     * @param {*} device
     */
    hasHumanName(device) {
        const label = this.deviceLabel(device)
        if (!label) return false
        return !this.isUuidLike(label) && !this.isAddressLike(label)
    },

    /**
     * Alphabetical by label, case-insensitive, like upstream.
     * @param {*} devices @returns {any[]}
     */
    sortedByLabel(devices) {
        const values = Array.isArray(devices) ? devices.slice() : []
        return values.sort((a, b) =>
            this.deviceLabel(a).localeCompare(this.deviceLabel(b), undefined, { sensitivity: 'base' }))
    },

    /**
     * Section grouping, upstream's shape: connected first, then known
     * (remembered but idle), then discovered (seen mid-scan only) —
     * each sorted, junk names filtered out.
     * @param {*} devices
     * @returns {{connected: any[], known: any[], discovered: any[]}}
     */
    deviceLists(devices) {
        const values = Array.isArray(devices) ? devices : []
        const connected = []
        const known = []
        const discovered = []
        for (const device of values) {
            if (!this.hasHumanName(device)) continue
            if (device.connected === true) connected.push(device)
            else if (device.known !== false) known.push(device)
            else discovered.push(device)
        }
        return {
            connected: this.sortedByLabel(connected),
            known: this.sortedByLabel(known),
            discovered: this.sortedByLabel(discovered),
        }
    },

    /**
     * The sections that actually render, in order — discovered only
     * mid-scan, like upstream.
     * @param {{connected: any[], known: any[], discovered: any[]}} lists
     * @param {boolean} discovering
     * @returns {string[]}
     */
    visibleSections(lists, discovering) {
        const sections = []
        if (lists.connected.length > 0) sections.push('connected')
        if (lists.known.length > 0) sections.push('known')
        if (discovering && lists.discovered.length > 0) sections.push('discovered')
        return sections
    },

    /**
     * @param {{connected: any[], known: any[], discovered: any[]}} lists
     * @param {string} section
     * @returns {any[]}
     */
    sectionDevices(lists, section) {
        if (section === 'connected') return lists.connected
        if (section === 'known') return lists.known
        if (section === 'discovered') return lists.discovered
        return []
    },

    /** @param {*} map @returns {Record<string, string>} */
    cloneMap(map) {
        const next = {}
        if (map && typeof map === 'object') {
            for (const key of Object.keys(map)) next[key] = map[key]
        }
        return next
    },

    /**
     * The in-flight action shown on a row ("connecting" /
     * "disconnecting" / "forgetting"), keyed by device id.
     * @param {*} actions @param {*} id
     */
    pendingAction(actions, id) {
        if (!actions || typeof actions !== 'object') return ''
        return String(actions[String(id)] || '')
    },

    /**
     * A copy of the pending map with one entry set or (empty action)
     * cleared — state stays immutable so renders diff cleanly.
     * @param {*} actions @param {*} id @param {*} action
     * @returns {Record<string, string>}
     */
    withPendingAction(actions, id, action) {
        const next = this.cloneMap(actions)
        const key = String(id || '')
        if (!key) return next
        if (action) next[key] = String(action)
        else delete next[key]
        return next
    },

    /**
     * The status caption under a row's name for a pending action, in
     * upstream's exact wording.
     * @param {*} action
     */
    pendingStatusText(action) {
        if (action === 'connecting') return 'Connecting…'
        if (action === 'disconnecting') return 'Disconnecting…'
        if (action === 'forgetting') return 'Forgetting…'
        return ''
    },
}
Object.freeze(BluetoothModel)
