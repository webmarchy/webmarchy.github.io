/**
 * Pure math for the display panel — a port of upstream
 * `shell/plugins/panels/monitor/Model.js` plus the text-size stop
 * helpers its Panel.qml keeps inline. DOM-free, like the clock's model.
 *
 * A browser has no backlight, so brightness is the software analog: a
 * black dim overlay whose strength the widget scroll adjusts (the
 * manual's display-widget brightness scroll), clamped well above dark
 * so the screen never becomes unusable.
 *
 * Everything lives on the single `MonitorModel` namespace to keep the
 * shared global scope down to one name.
 */
const MonitorModel = {
    // The requested scales, upstream's presets; what each one *does* is
    // its cleaned value for the actual mode (see cleanScale), which is
    // also what the pill shows.
    SCALE_PRESETS: ['1', '1.25', '1.6', '2', '3', '4'],

    // Text size slider — curated macOS-style notches (px). The panel
    // snaps to these stops; a hand-edited setting may sit off-notch and
    // is shown as-is until the slider is touched.
    TEXT_SIZE_STOPS: [9, 10, 11, 12, 14, 16, 20],

    /** @param {*} value */
    clampBrightness(value) {
        const n = Number(value)
        if (!isFinite(n)) return 1
        return Math.min(1, Math.max(0.3, Math.round(n * 100) / 100))
    },

    /** @param {*} scale */
    normalizeScale(scale) {
        const n = parseFloat(String(scale || ''))
        if (!isFinite(n)) return ''
        return String(Math.round(n * 100) / 100)
    },

    /** @param {number} a @param {number} b */
    _gcd(a, b) {
        while (b) {
            const remainder = a % b
            a = b
            b = remainder
        }
        return a
    },

    /**
     * The nearest scale at or above the requested one that divides the
     * mode evenly (in 1/120ths, Hyprland's own granularity), so the
     * scaled logical size stays integral. Upstream feeds this every
     * preset before showing it; the label is the cleaned value.
     * @param {*} scale @param {*} width @param {*} height
     */
    cleanScale(scale, width, height) {
        const requested = Number(scale)
        const modeWidth = Number(width)
        const modeHeight = Number(height)
        if (!isFinite(requested) || !isFinite(modeWidth) || !isFinite(modeHeight)
            || requested <= 0 || modeWidth <= 0 || modeHeight <= 0) return ''

        const divisor = this._gcd(Math.round(modeWidth * 120), Math.round(modeHeight * 120))
        let scaleUnits = Math.round(requested * 120)
        if (scaleUnits > divisor) scaleUnits = divisor
        while (divisor % scaleUnits !== 0) scaleUnits++
        return this.normalizeScale(scaleUnits / 120)
    },

    /**
     * Which entry of `scales` is currently applied: the one whose
     * cleaned value matches, preferring the entry closest to the raw
     * current value when several clean to the same thing.
     * @param {string[]} scales @param {*} currentScale
     * @param {*} width @param {*} height
     */
    matchingScaleIndex(scales, currentScale, width, height) {
        const current = Number(currentScale)
        if (!Array.isArray(scales) || !isFinite(current)) return -1

        let bestIndex = -1
        let bestDistance = Infinity
        const normalizedCurrent = this.normalizeScale(current)
        for (let i = 0; i < scales.length; i++) {
            if (this.cleanScale(scales[i], width, height) !== normalizedCurrent) continue

            const distance = Math.abs(Number(scales[i]) - current)
            if (distance < bestDistance) {
                bestIndex = i
                bestDistance = distance
            }
        }
        return bestIndex
    },

    /**
     * The presets deduplicated by what they would actually do on this
     * mode — two requests that clean to the same effective scale keep
     * only the closer one, so the pill row never shows twins.
     * @param {string[]} scales @param {*} width @param {*} height
     * @returns {string[]}
     */
    availableScales(scales, width, height) {
        if (!Array.isArray(scales) || Number(width) <= 0 || Number(height) <= 0) return scales || []

        /** @type {Record<string, {value: string, index: number, distance: number}>} */
        const byEffectiveScale = {}
        for (let i = 0; i < scales.length; i++) {
            const requested = Number(scales[i])
            const effective = Number(this.cleanScale(requested, width, height))

            if (!isFinite(requested) || !isFinite(effective)) continue

            const key = this.normalizeScale(effective)
            const existing = byEffectiveScale[key]
            if (!existing || Math.abs(requested - effective) < existing.distance) {
                byEffectiveScale[key] = {
                    value: String(scales[i]),
                    index: i,
                    distance: Math.abs(requested - effective),
                }
            }
        }

        return Object.keys(byEffectiveScale)
            .map(key => byEffectiveScale[key])
            .sort((a, b) => a.index - b.index)
            .map(candidate => candidate.value)
    },

    /**
     * The stop index closest to a pixel size — how an off-notch value
     * (hand-edited settings) lands on the slider.
     * @param {*} px
     */
    nearestTextStop(px) {
        let best = 0
        let bestDistance = Infinity
        for (let i = 0; i < this.TEXT_SIZE_STOPS.length; i++) {
            const distance = Math.abs(this.TEXT_SIZE_STOPS[i] - Number(px))
            if (distance < bestDistance) {
                bestDistance = distance
                best = i
            }
        }
        return best
    },

    /**
     * A persisted text size, or the fallback for anything unusable.
     * Bounds are looser than the stops on purpose, mirroring upstream's
     * CLI accepting any sane integer.
     * @param {*} value @param {number} fallback
     */
    parseTextSize(value, fallback) {
        const n = Math.round(Number(value))
        return isFinite(n) && n >= 6 && n <= 40 ? n : fallback
    },
}
Object.freeze(MonitorModel)
