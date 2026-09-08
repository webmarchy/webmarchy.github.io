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

/** @type {Record<string, string>} */
const BAR_PANEL_EVENTS = {
    'omarchy.clock': 'omarchy:clock-toggle',
    'omarchy.weather': 'omarchy:weather-toggle',
    'omarchy.bluetooth': 'omarchy:bluetooth-toggle',
    'omarchy.network': 'omarchy:network-toggle',
    'omarchy.audio': 'omarchy:audio-toggle',
    'omarchy.monitor': 'omarchy:monitor-toggle',
    'omarchy.power': 'omarchy:power-toggle',
}

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
        const SECTIONS = /** @type {const} */ (['left', 'center', 'right'])

        let currentPosition = /** @type {string} */ (BAR_CONFIG.position)
        let barHidden = Settings.get('bar.hidden', false) === true

        /** @type {Record<'left' | 'center' | 'right', HTMLElement>} */
        const sectionHosts = {
            left: $(root, '[data-ref="left"]'),
            center: $(root, '[data-ref="center"]'),
            right: $(root, '[data-ref="right"]'),
        }

        function loadLayout() {
            const saved = Settings.get('bar.layout', null)
            /** @type {Record<'left' | 'center' | 'right', string[]>} */
            const result = { left: [], center: [], right: [] }
            const seen = new Set()
            for (const section of SECTIONS) {
                const ids = Array.isArray(saved?.[section])
                    ? saved[section].map(String)
                    : [...BAR_CONFIG.layout[section]]
                result[section] = ids.filter(id => BAR_WIDGETS[id]
                    && !seen.has(id) && Boolean(seen.add(id)))
            }
            for (const section of SECTIONS) {
                for (const id of BAR_CONFIG.layout[section]) {
                    if (BAR_WIDGETS[id] && !seen.has(id)) {
                        seen.add(id)
                        result[section].push(id)
                    }
                }
            }
            return result
        }

        const layout = loadLayout()

        function saveLayout() {
            for (const section of SECTIONS) {
                layout[section] = $$(sectionHosts[section], ':scope > [data-widget-id]')
                    .map(el => /** @type {HTMLElement} */ (el).dataset.widgetId || '')
                    .filter(Boolean)
            }
            Settings.set('bar.layout', {
                left: layout.left, center: layout.center, right: layout.right,
            })
        }

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

        for (const section of SECTIONS) {
            const host = sectionHosts[section]
            for (const id of layout[section]) {
                const Widget = BAR_WIDGETS[id]
                if (!Widget) continue
                const before = host.lastElementChild
                mount(host, new Widget())
                let el = before ? before.nextElementSibling : host.firstElementChild
                for (; el; el = el.nextElementSibling) {
                    const widgetEl = /** @type {HTMLElement} */ (el)
                    widgetEl.setAttribute('draggable', 'true')
                    widgetEl.dataset.widgetId = id
                }
            }
        }

        let draggedWidget = /** @type {HTMLElement | null} */ (null)

        bar.addEventListener('dragstart', event => {
            const target = event.target
            if (!(target instanceof HTMLElement)) return
            if (target.closest('[role="dialog"]')) {
                event.preventDefault()
                return
            }
            const widget = /** @type {HTMLElement | null} */ (target.closest('[data-widget-id]'))
            if (!widget) {
                event.preventDefault()
                return
            }
            draggedWidget = widget
            event.dataTransfer?.setData('text/plain', widget.dataset.widgetId || '')
            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
        })

        bar.addEventListener('dragend', () => {
            if (!draggedWidget) return
            draggedWidget = null
            saveLayout()
        })

        for (const section of SECTIONS) {
            const host = sectionHosts[section]
            host.addEventListener('dragover', event => {
                if (!draggedWidget) return
                event.preventDefault()
                if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
                const vertical = currentPosition === 'left' || currentPosition === 'right'
                const pointer = vertical ? event.clientY : event.clientX
                /** @type {Element | null} */
                let before = null
                for (const el of $$(host, ':scope > [data-widget-id]')) {
                    if (el === draggedWidget) continue
                    const rect = el.getBoundingClientRect()
                    const middle = vertical
                        ? rect.top + rect.height / 2
                        : rect.left + rect.width / 2
                    if (pointer < middle) {
                        before = el
                        break
                    }
                }
                if (before) host.insertBefore(draggedWidget, before)
                else host.appendChild(draggedWidget)
            })
            host.addEventListener('drop', event => event.preventDefault())
        }

        bar.addEventListener('pointerdown', event => {
            const target = /** @type {HTMLElement} */ (event.target)
            if (target !== bar && !target.classList.contains('bar-section')) return
            const startX = event.clientX
            const startY = event.clientY
            let moved = false
            /** @param {PointerEvent} move */
            const onMove = move => {
                if (!moved && Math.hypot(move.clientX - startX, move.clientY - startY) < 16) {
                    return
                }
                moved = true
                const edges = /** @type {[string, number][]} */ ([
                    ['left', move.clientX / window.innerWidth],
                    ['right', 1 - move.clientX / window.innerWidth],
                    ['top', move.clientY / window.innerHeight],
                    ['bottom', 1 - move.clientY / window.innerHeight],
                ])
                edges.sort((a, b) => a[1] - b[1])
                if (edges[0][0] !== currentPosition) {
                    document.dispatchEvent(new CustomEvent('omarchy:bar-position', {
                        detail: edges[0][0],
                    }))
                }
            }
            const onUp = () => {
                window.removeEventListener('pointermove', onMove)
                window.removeEventListener('pointerup', onUp)
            }
            window.addEventListener('pointermove', onMove)
            window.addEventListener('pointerup', onUp)
        })

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

        document.addEventListener('omarchy:bar-panel', event => {
            const n = Number(/** @type {CustomEvent} */ (event).detail)
            const id = layout.right[n - 1]
            const type = id ? BAR_PANEL_EVENTS[id] : ''
            if (type) document.dispatchEvent(new CustomEvent(type))
        })

        bar.addEventListener('dblclick', event => {
            const target = /** @type {HTMLElement} */ (event.target)
            if (target !== bar && !target.classList.contains('bar-section')) return
            document.dispatchEvent(
                new CustomEvent('omarchy:bar-transparency', { detail: 'toggle' }))
        })
    }
}
