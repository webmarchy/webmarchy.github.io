const FONT_BUNDLED = [
    'Adwaita Mono',
    'iA Writer Mono S',
    'JetBrainsMono Nerd Font',
    'JetBrainsMono Nerd Font Mono',
    'JetBrainsMonoNL Nerd Font',
    'JetBrainsMonoNL Nerd Font Mono',
    'Liberation Mono',
    'Noto Sans Mono',
]

const FONT_CANDIDATES = [
    'CaskaydiaMono Nerd Font',
    'Cascadia Mono',
    'JetBrains Mono',
    'Fira Code',
    'Hack',
    'Source Code Pro',
    'IBM Plex Mono',
    'Roboto Mono',
    'Ubuntu Mono',
    'DejaVu Sans Mono',
    'SF Mono',
    'Menlo',
    'Monaco',
    'Consolas',
    'Courier New',
]

const Fonts = {
    /** @type {string[] | null} */
    _available: null,

    available() {
        if (this._available) return this._available
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        /** @type {string[]} */
        let locals = []
        if (ctx) {
            const sample = 'mmmWWWiil10O@#'
            /** @param {string} stack */
            const widthOf = stack => {
                ctx.font = `16px ${stack}`
                return ctx.measureText(sample).width
            }
            const monoBase = widthOf('monospace')
            const serifBase = widthOf('serif')
            locals = FONT_CANDIDATES.filter(name =>
                widthOf(`"${name}", monospace`) !== monoBase
                || widthOf(`"${name}", serif`) !== serifBase)
        }
        this._available = [...new Set([...FONT_BUNDLED, ...locals])]
            .sort((a, b) => a.localeCompare(b))
        return this._available
    },

    current() {
        return String(Settings.get('font.family', '') || '')
    },

    /** @param {string} family */
    apply(family) {
        if (family) {
            document.documentElement.style.setProperty('--font-mono',
                `"${family}", 'Symbols Nerd Font', monospace`)
        } else {
            document.documentElement.style.removeProperty('--font-mono')
        }
    },
}

document.addEventListener('omarchy:font-set', event => {
    const family = String(/** @type {CustomEvent} */ (event).detail || '')
    Settings.set('font.family', family)
    Fonts.apply(family)
})

Fonts.apply(Fonts.current())
