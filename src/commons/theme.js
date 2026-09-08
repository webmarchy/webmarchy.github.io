/** @type {readonly string[]} */
const THEME_COLOR_KEYS = Object.freeze([
    'accent', 'selection', 'muted',
    'background', 'dark_background', 'darker_background', 'lighter_background',
    'foreground', 'dark_foreground', 'light_foreground', 'bright_foreground',
    'red', 'yellow', 'orange', 'green', 'cyan', 'blue', 'magenta', 'brown',
    'bright_red', 'bright_yellow', 'bright_green', 'bright_cyan',
    'bright_blue', 'bright_magenta',
])

/** @type {Readonly<Record<string, string>>} */
const THEME_OPTIONAL_COLOR_FALLBACKS = Object.freeze({
    orange: 'yellow',
    brown: 'muted',
})

/**
 * @typedef {Object} ThemeDefinition
 * @property {'dark' | 'light'} mode
 * @property {Record<string, string>} colors
 * @property {string[]} [backgrounds]
 */

const THEME_DEFAULT = 'tokyo-night'

const Theme = {
    /** @type {Map<string, ThemeDefinition>} */
    _registry: new Map(),

    current: '',

    /**
     * @param {string} name
     * @param {ThemeDefinition} definition
     * @returns {void}
     */
    register(name, definition) {
        if (this._registry.has(name)) {
            throw new Error(`Theme.register: "${name}" is already registered`)
        }
        if (definition.mode !== 'dark' && definition.mode !== 'light') {
            throw new Error(`Theme.register: "${name}" mode must be "dark" or "light", got "${definition.mode}"`)
        }
        for (const key of THEME_COLOR_KEYS) {
            const value = definition.colors[key]
            if (key in THEME_OPTIONAL_COLOR_FALLBACKS && value === undefined) {
                continue
            }
            if (typeof value !== 'string' || value === '') {
                throw new Error(`Theme.register: "${name}" is missing color "${key}"`)
            }
        }
        if (definition.backgrounds !== undefined) {
            const ok = Array.isArray(definition.backgrounds)
                && definition.backgrounds.every(b => typeof b === 'string' && b !== '')
            if (!ok) {
                throw new Error(`Theme.register: "${name}" backgrounds must be an array of non-empty URL strings`)
            }
        }
        this._registry.set(name, definition)
    },

    /**
     * @returns {string[]}
     */
    backgrounds() {
        const definition = this._registry.get(this.current)
        return definition?.backgrounds ? [...definition.backgrounds] : []
    },

    /**
     * @returns {string[]}
     */
    names() {
        return [...this._registry.keys()]
    },

    /**
     * @param {string} name
     * @returns {void}
     */
    apply(name) {
        const definition = this._registry.get(name)
        if (!definition) {
            const known = this.names().join(', ') || '(none)'
            throw new Error(`Theme.apply: unknown theme "${name}" — registered: ${known}`)
        }
        const root = document.documentElement
        for (const [key, value] of Object.entries(definition.colors)) {
            root.style.setProperty(`--color-${key.replaceAll('_', '-')}`, value)
        }
        for (const [key, fallback] of Object.entries(THEME_OPTIONAL_COLOR_FALLBACKS)) {
            if (definition.colors[key] === undefined) {
                root.style.setProperty(
                    `--color-${key.replaceAll('_', '-')}`,
                    definition.colors[fallback])
            }
        }
        root.dataset.themeMode = definition.mode
        root.style.colorScheme = definition.mode
        this.current = name
        Settings.set('theme.current', name)
        document.dispatchEvent(new CustomEvent('omarchy:theme-changed', { detail: name }))
    },
}

document.addEventListener('omarchy:theme-set', event => {
    Theme.apply(String(/** @type {CustomEvent} */ (event).detail))
})
document.addEventListener('omarchy:theme-next', () => {
    const names = Theme.names()
    if (!names.length) return
    const next = names[(names.indexOf(Theme.current) + 1) % names.length]
    Theme.apply(next)
})
