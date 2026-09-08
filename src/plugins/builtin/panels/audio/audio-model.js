const AudioModel = {
    /**
     * @param {*} volume @param {*} muted
     */
    outputVolumeName(volume, muted) {
        if (muted) return 'Muted'
        const p = Math.round((Number(volume) || 0) * 100)
        if (p === 0) return 'Silenced'
        if (p >= 100) return 'Concert hall'
        if (p >= 85) return 'Party mode'
        if (p >= 70) return 'Cranked up'
        if (p >= 50) return 'Steady groove'
        if (p >= 30) return 'Easy listening'
        if (p >= 15) return 'Murmur'
        return 'Whisper'
    },

    /** @param {*} text */
    isHeadphonesText(text) {
        const blob = String(text || '').toLowerCase()
        return blob.indexOf('headphone') !== -1
            || blob.indexOf('headset') !== -1
            || blob.indexOf('earbud') !== -1
            || blob.indexOf('earphone') !== -1
            || blob.indexOf('airpod') !== -1
    },

    /**
     * @param {*} volume @param {*} muted @param {*} deviceText
     */
    outputIcon(volume, muted, deviceText) {
        if (this.isHeadphonesText(deviceText)) return '\u{F02CB}'
        if (muted) return ''
        const v = Number(volume) || 0
        if (v >= 0.67) return ''
        if (v >= 0.34) return ''
        return ''
    },

    /** @param {*} muted @param {*} hasDevice */
    inputIcon(muted, hasDevice) {
        if (!hasDevice) return '\u{F036D}'
        return muted ? '\u{F036D}' : '\u{F036C}'
    },

    /**
     * @param {*} deviceText
     */
    sinkGlyph(deviceText) {
        const blob = String(deviceText || '').toLowerCase()
        if (this.isHeadphonesText(blob)) return '\u{F02CB}'
        if (blob.indexOf('bluetooth') !== -1) return '\u{F00AF}'
        if (blob.indexOf('hdmi') !== -1 || blob.indexOf('display') !== -1) return '\u{F0379}'
        return '\u{F04C3}'
    },

    /**
     * @param {*} deviceText
     */
    sourceGlyph(deviceText) {
        const blob = String(deviceText || '').toLowerCase()
        if (blob.indexOf('headset') !== -1) return '\u{F02CB}'
        if (blob.indexOf('bluetooth') !== -1) return '\u{F00AF}'
        if (blob.indexOf('webcam') !== -1 || blob.indexOf('camera') !== -1) return '\u{F0100}'
        return '\u{F036C}'
    },

    /** @param {*} muted */
    streamMuteIcon(muted) {
        return muted ? '\u{F075F}' : '\u{F057E}'
    },

    /**
     * @param {*} text
     */
    friendlyDeviceLabel(text) {
        let label = String(text || '')
        label = label.replace(/^sof-soundwire\s+/i, '')
        label = label.replace(/^built-in audio\s+/i, '')
        label = label.replace(/\s+Output$/i, '')
        label = label.replace(/\s+Input$/i, '')
        label = label.replace(/Microphones/g, 'Microphone')
        return label
    },

    /**
     * @param {*} label @param {number} index @param {'output' | 'input'} kind
     */
    deviceLabel(label, index, kind) {
        const cleaned = this.friendlyDeviceLabel(label).trim()
        if (cleaned !== '') return cleaned
        if (kind === 'output') return index === 0 ? 'Speakers' : 'Output ' + (index + 1)
        return index === 0 ? 'Microphone' : 'Input ' + (index + 1)
    },

    /** @param {*} volume */
    percentText(volume) {
        return Math.round((Number(volume) || 0) * 100) + '%'
    },

    /**
     * @param {*} value @param {number} [max]
     */
    snapVolume(value, max = 1) {
        const v = Math.max(0, Math.min(max, Number(value) || 0))
        return Math.round(v * 20) / 20
    },
}
Object.freeze(AudioModel)
