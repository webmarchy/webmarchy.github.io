const PowerModel = {
    CHARGING_ICONS: ['\u{F089C}', '\u{F0086}', '\u{F0087}', '\u{F0088}', '\u{F089D}',
        '\u{F0089}', '\u{F089E}', '\u{F008A}', '\u{F008B}', '\u{F0085}'],
    DEFAULT_ICONS: ['\u{F007A}', '\u{F007B}', '\u{F007C}', '\u{F007D}', '\u{F007E}',
        '\u{F007F}', '\u{F0080}', '\u{F0081}', '\u{F0082}', '\u{F0079}'],
    FULL_ICON: '\u{F0085}',

    /** @param {*} value */
    batteryFraction(value) {
        const n = Number(value)
        return isFinite(n) ? Math.max(0, Math.min(1, n)) : 0
    },

    /**
     * @param {*} fraction @param {boolean} charging @param {boolean} full
     */
    batteryIcon(fraction, charging, full) {
        const level = this.batteryFraction(fraction)
        const index = Math.max(0, Math.min(9, Math.floor(level * 10)))
        if (full) return this.FULL_ICON
        if (charging) return this.CHARGING_ICONS[index]
        return this.DEFAULT_ICONS[index]
    },

    /**
     * @param {boolean} charging @param {boolean} full
     */
    modeLabel(charging, full) {
        if (full) return 'Fully charged'
        if (charging) return 'Charging'
        return 'On battery'
    },

    /**
     * @param {*} seconds
     */
    formatDuration(seconds) {
        const total = Number(seconds)
        if (!isFinite(total) || total <= 0) return '—'
        const minutes = Math.round(total / 60)
        if (minutes < 60) return minutes + 'm'
        const hours = Math.floor(minutes / 60)
        const rest = minutes % 60
        return hours + 'h ' + (rest < 10 ? '0' : '') + rest + 'm'
    },
}
Object.freeze(PowerModel)
