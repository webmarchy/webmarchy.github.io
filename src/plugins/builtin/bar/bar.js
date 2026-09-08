const BAR_CONFIG = Object.freeze({
    /** @type {'top' | 'bottom' | 'left' | 'right'} */
    position: 'top',
    transparent: false,
    layout: Object.freeze({
        /** @type {readonly string[]} */ left: Object.freeze(['omarchy.menu', 'omarchy.workspaces']),
        /** @type {readonly string[]} */ center: Object.freeze(['omarchy.indicators', 'omarchy.clock', 'omarchy.weather']),
        /** @type {readonly string[]} */ right: Object.freeze(['omarchy.bluetooth', 'omarchy.network', 'omarchy.audio', 'omarchy.monitor', 'omarchy.power']),
    }),
})

/** @type {Record<string, new () => Component>} */
const BAR_WIDGETS = {}

class Bar extends Component {
    static template = `
        <header class="bar" data-ref="bar">
            <div class="bar-section bar-left" data-ref="left"></div>
            <div class="bar-section bar-center" data-ref="center"></div>
            <div class="bar-section bar-right" data-ref="right"></div>
        </header>
    `

    /** @param {DocumentFragment} root */
    script(root) {
        const bar = $(root, '[data-ref="bar"]')
        const POSITIONS = ['top', 'bottom', 'left', 'right']

        let currentPosition = /** @type {string} */ (BAR_CONFIG.position)
        let barHidden = Settings.get('bar.hidden', false) === true

        /**
         * @param {string} position
         */
        function setPosition(position) {
            currentPosition = position
            bar.dataset.position = position
            bar.hidden = barHidden
            if (barHidden) delete document.documentElement.dataset.barPosition
            else document.documentElement.dataset.barPosition = position
        }

        const savedPosition = Settings.get('bar.position', BAR_CONFIG.position)
        setPosition(POSITIONS.includes(savedPosition) ? savedPosition : BAR_CONFIG.position)
        if (Settings.get('bar.transparent', BAR_CONFIG.transparent) === true) {
            bar.classList.add('bar-transparent')
        }
        for (const section of /** @type {const} */ (['left', 'center', 'right'])) {
            const host = $(root, `[data-ref="${section}"]`)
            for (const id of BAR_CONFIG.layout[section]) {
                const Widget = BAR_WIDGETS[id]
                if (Widget) mount(host, new Widget())
            }
        }

        document.addEventListener('omarchy:bar-position', event => {
            const position = String(/** @type {CustomEvent} */ (event).detail)
            if (POSITIONS.includes(position)) {
                setPosition(position)
                Settings.set('bar.position', position)
            }
        })
        document.addEventListener('omarchy:bar-toggle', () => {
            barHidden = !barHidden
            Settings.set('bar.hidden', barHidden)
            setPosition(currentPosition)
            window.dispatchEvent(new Event('resize'))
        })

        document.addEventListener('omarchy:bar-transparency', event => {
            const mode = String(/** @type {CustomEvent} */ (event).detail)
            if (mode === 'toggle') {
                Settings.set('bar.transparent', bar.classList.toggle('bar-transparent'))
            }
        })

        bar.addEventListener('dblclick', event => {
            const target = /** @type {HTMLElement} */ (event.target)
            if (target !== bar && !target.classList.contains('bar-section')) return
            document.dispatchEvent(
                new CustomEvent('omarchy:bar-transparency', { detail: 'toggle' }))
        })
    }
}
