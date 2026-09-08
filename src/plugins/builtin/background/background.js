class Background extends Component {
    static template = `<div class="background" data-ref="layer"></div>`

    /**
     * @param {Object} [config]
     * @param {string} [config.url]
     */
    constructor(config) {
        super()
        this.url = config?.url
    }

    /** @param {DocumentFragment} root */
    script(root) {
        const layer = $(root, '[data-ref="layer"]')
        const saved = Settings.get('background.current', '')
        let current = this.url
            ?? (Theme.backgrounds().includes(saved) ? saved : Theme.backgrounds()[0])
            ?? ''

        function show(url) {
            current = url ?? ''
            layer.style.backgroundImage = current ? `url("${current}")` : ''
            Settings.set('background.current', current)
        }
        show(current)

        document.addEventListener('omarchy:background-set', event => {
            show(String(/** @type {CustomEvent} */ (event).detail))
        })
        document.addEventListener('omarchy:background-next', () => {
            const backgrounds = Theme.backgrounds()
            if (!backgrounds.length) return
            show(backgrounds[(backgrounds.indexOf(current) + 1) % backgrounds.length])
        })
        document.addEventListener('omarchy:theme-changed', () => {
            show(Theme.backgrounds()[0])
        })
    }
}
