const NetworkModel = {
    /**
     * @param {number} strength
     */
    wifiIconFor(strength) {
        const icons = ['\u{F092F}', '\u{F091F}', '\u{F0922}', '\u{F0925}', '\u{F0928}']
        const index = Math.max(0, Math.min(4, Math.ceil(strength / 20) - 1))
        return icons[index]
    },

    /**
     * @param {string} kind
     * @param {number} signalStrength
     * @param {string} connectivity
     */
    connectionIcon(kind, signalStrength, connectivity) {
        const restricted = connectivity === 'portal' || connectivity === 'limited'
        if (kind === 'wifi') return restricted ? '\u{F0929}' : this.wifiIconFor(signalStrength)
        if (kind === 'ethernet') return restricted ? '\u{F0202}' : '\u{F0200}'
        return '\u{F092E}'
    },

    /**
     * @param {*} mbps
     */
    formatHeaderSpeed(mbps) {
        const v = parseInt(String(mbps), 10)
        if (!v || v < 0) return ''
        if (v >= 1000) return (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + 'gbit'
        return v + 'mbit'
    },

    /** @param {*} bytes */
    formatBytes(bytes) {
        let n = Number(bytes)
        if (!isFinite(n) || n < 0) n = 0
        if (n < 1024) return Math.round(n) + ' B'
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
        if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB'
        return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
    },

    /** @param {*} bytesPerSec */
    formatRate(bytesPerSec) {
        return this.formatBytes(bytesPerSec) + '/s'
    },

    /**
     * @param {*} ms @param {boolean} hasSamples
     */
    formatPingLatency(ms, hasSamples) {
        if (hasSamples === false) return '--'

        const value = parseFloat(String(ms))
        if (!isFinite(value) || value < 0) return 'Timeout'
        return value.toFixed(value > 0 && value < 10 ? 1 : 0) + ' ms'
    },

    /** @param {*} percent @param {boolean} hasSamples */
    formatPacketLoss(percent, hasSamples) {
        if (hasSamples === false) return '--'

        const value = parseInt(String(percent), 10)
        if (!value || value < 0) return '0%'
        return value + '%'
    },

    /**
     * @param {*} raw
     * @returns {number | null}
     */
    pingSampleValue(raw) {
        const value = parseFloat(String(raw))
        if (!isFinite(value) || value < 0) return null
        return value
    },

    /**
     * @param {*} samples @param {*} raw @param {number} limit
     * @returns {(number | null)[]}
     */
    appendPingSample(samples, raw, limit) {
        const values = Array.isArray(samples) ? samples.slice() : []

        values.push(this.pingSampleValue(raw))
        while (values.length > limit) values.shift()

        return values
    },

    /**
     * @param {*} samples @param {*} limit
     */
    averagePingLatency(samples, limit) {
        const values = Array.isArray(samples) ? samples : []
        const sampleLimit = Math.max(1, parseInt(String(limit), 10) || values.length || 1)
        let total = 0
        let count = 0

        for (let i = Math.max(0, values.length - sampleLimit); i < values.length; i++) {
            const value = values[i]
            if (typeof value !== 'number' || !isFinite(value) || value < 0) continue
            total += value
            count++
        }

        return count > 0 ? total / count : -1
    },

    /** @param {*} samples */
    pingPacketLossPercent(samples) {
        const values = Array.isArray(samples) ? samples : []
        if (values.length === 0) return 0

        let lost = 0
        for (const value of values) {
            if (value === null) lost++
        }

        return Math.round((lost / values.length) * 100)
    },

    /**
     * @param {*} previous @param {{iface?: string, router_ping_ms?: *, internet_ping_ms?: *}} next
     * @param {number} limit @param {number} averageLimit
     */
    pingLatencyState(previous, next, limit, averageLimit) {
        const prev = previous || {}
        const sample = next || {}
        const iface = sample.iface || ''
        const window = Math.max(1, parseInt(String(limit), 10) || 5)
        const averageWindow = Math.max(1, parseInt(String(averageLimit), 10) || window)
        const reset = iface === '' || iface !== (prev.pingIface || '')
        let routerSamples = reset ? [] : prev.routerPingSamples
        let internetSamples = reset ? [] : prev.internetPingSamples

        routerSamples = sample.router_ping_ms === undefined ? [] : this.appendPingSample(routerSamples, sample.router_ping_ms, window)
        internetSamples = sample.internet_ping_ms === undefined ? [] : this.appendPingSample(internetSamples, sample.internet_ping_ms, window)

        return {
            pingIface: iface,
            routerPingSamples: routerSamples,
            internetPingSamples: internetSamples,
            routerPingLatency: this.averagePingLatency(routerSamples, averageWindow),
            internetPingLatency: this.averagePingLatency(internetSamples, averageWindow),
            internetPingPacketLoss: this.pingPacketLossPercent(internetSamples),
        }
    },

    /**
     * @param {*} previous @param {{iface?: string, rx_bytes?: *, tx_bytes?: *}} next
     * @param {number} now
     */
    throughputState(previous, next, now) {
        const prev = previous || {}
        const sample = next || {}
        const iface = sample.iface || ''
        const rx = parseFloat(String(sample.rx_bytes || '0'))
        const tx = parseFloat(String(sample.tx_bytes || '0'))
        const previousTime = Number(prev.prevSampleTime || 0)

        if (iface !== (prev.prevIface || '') || previousTime === 0) {
            return {
                prevIface: iface,
                prevRxBytes: rx,
                prevTxBytes: tx,
                prevSampleTime: now,
                downloadRate: 0,
                uploadRate: 0,
            }
        }

        let downloadRate = Number(prev.downloadRate || 0)
        let uploadRate = Number(prev.uploadRate || 0)
        const dt = now - previousTime
        if (dt > 0) {
            downloadRate = Math.max(0, (rx - Number(prev.prevRxBytes || 0)) / dt)
            uploadRate = Math.max(0, (tx - Number(prev.prevTxBytes || 0)) / dt)
        }

        return {
            prevIface: iface,
            prevRxBytes: rx,
            prevTxBytes: tx,
            prevSampleTime: now,
            downloadRate,
            uploadRate,
        }
    },
}
Object.freeze(NetworkModel)
