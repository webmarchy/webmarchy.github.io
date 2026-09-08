/**
 * Bluetooth defaults — the plugin's own shipped config (persisted user
 * overrides live in the `bluetooth.*` Settings namespace). `enabled`
 * is a shell-side switch: a browser cannot power the radio itself, so
 * the toggle gates this panel's scanning and UI the way upstream's
 * rfkill soft block gates the adapter — the FIXED BRIGHTNESS precedent.
 */
const BLUETOOTH_CONFIG = Object.freeze({
    enabled: true,
})

/**
 * Bluetooth plugin — the device panel, mirroring upstream
 * `omarchy.bluetooth` (`shell/plugins/panels/bluetooth/Panel.qml`, kind
 * `bar-widget`): a bluetooth glyph in the bar whose panel lists devices
 * with connect / disconnect / forget controls.
 *
 * What each upstream piece maps to in a browser (Web Bluetooth):
 * - The PAIRED list is `navigator.bluetooth.getDevices()` — the
 *   browser's own remembered (permission-granted) devices, refreshed
 *   every 5s while the panel is open; `gatt.connected` marks the
 *   CONNECTED section.
 * - Connect / disconnect are REAL: `device.gatt.connect()` /
 *   `.disconnect()`, with upstream's "Connecting…" / "Disconnecting…"
 *   pending captions and its 20s stuck-action timeout; the
 *   `gattserverdisconnected` event keeps rows current.
 * - Forget is REAL where the browser offers `device.forget()`.
 * - A page cannot passively scan, so upstream's AVAILABLE-while-
 *   discovering section becomes the "Scan for devices…" row: it opens
 *   the browser's own device chooser (`requestDevice`), and the choice
 *   joins the paired list.
 * - The power toggle is the shell-side `bluetooth.enabled` setting
 *   (see BLUETOOTH_CONFIG); upstream's rotating hero phrases, section
 *   titles, and empty-state wording are kept verbatim.
 *
 * Cursor model, matching upstream: hover or j/k (arrows) walks
 * header → rows → the scan row, ←/→ move between a row's name and its
 * forget action, Enter activates (header toggles power, rows
 * connect/disconnect, action forgets), `x` forgets the focused row,
 * `b` toggles power, Escape closes. The bar button: left-click toggles
 * the panel (or `omarchy:bluetooth-toggle`, the analog of
 * `omarchy-shell shell toggle omarchy.bluetooth`), right-click flips
 * the power toggle.
 *
 * Owns the `bluetooth.*` settings namespace (`bluetooth.enabled`) and
 * the `omarchy:bluetooth-toggle` action event. Registers as
 * `omarchy.bluetooth` in {@link BAR_WIDGETS}.
 * @extends {Component}
 */
class BluetoothBarWidget extends Component {
    static template = `
        <div class="bluetooth">
            <button type="button" class="bluetooth-bar-widget bar-icon-button" data-ref="button"
                    title="Bluetooth" aria-haspopup="dialog" aria-expanded="false"></button>
            <div class="bluetooth-panel" hidden data-ref="panel"
                 role="dialog" aria-label="Bluetooth">
                <div class="bluetooth-hero" data-ref="hero">
                    <span class="bluetooth-hero-icon" data-ref="heroIcon"></span>
                    <div class="bluetooth-hero-labels">
                        <span class="bluetooth-hero-title">Bluetooth</span>
                        <span class="bluetooth-hero-status" data-ref="heroStatus"></span>
                    </div>
                    <button type="button" class="bluetooth-switch" data-ref="powerSwitch"
                            role="switch"><span class="bluetooth-switch-knob"></span></button>
                </div>
                <div class="bluetooth-separator"></div>
                <div class="bluetooth-sections" data-ref="sections"></div>
                <div class="bluetooth-empty" hidden data-ref="empty"></div>
            </div>
        </div>
    `

    /** @param {DocumentFragment} root */
    script(root) {
        const button = /** @type {HTMLButtonElement} */ ($(root, '[data-ref="button"]'))
        const panel = $(root, '[data-ref="panel"]')
        const hero = $(root, '[data-ref="hero"]')
        const heroIcon = $(root, '[data-ref="heroIcon"]')
        const heroStatus = $(root, '[data-ref="heroStatus"]')
        const powerSwitch = /** @type {HTMLButtonElement} */ ($(root, '[data-ref="powerSwitch"]'))
        const sectionsHost = $(root, '[data-ref="sections"]')
        const empty = $(root, '[data-ref="empty"]')

        // Upstream's three adapter glyphs, as escapes so the file
        // survives any non-UTF-8 round trip.
        const GLYPH_CONNECTED = '\u{F0B1}'
        const GLYPH_IDLE = '\u{F0AF}'
        const GLYPH_DISABLED = '\u{F0B2}'
        const GLYPH_FORGET = '\u{F049}'

        // Upstream's rotating hero phrases, verbatim.
        const PHRASES = [
            'Untangling wires',
            'Streaming vikings',
            'Pairing mysteries',
            'Herding headsets',
            'Taming radios',
            'Summoning speakers',
            'Wrangling codecs',
            'Polishing packets',
        ]

        // Web Bluetooth is absent outside Chromium; typed loosely since
        // the TS DOM lib may not carry it.
        const bluetoothApi = /** @type {any} */ (navigator).bluetooth
        const available = !!bluetoothApi

        // ---- State ----------------------------------------------------
        let enabled = Settings.get('bluetooth.enabled', BLUETOOTH_CONFIG.enabled) === true
        /** Rows: {id, name, connected, device} — device is the live
         * BluetoothDevice the row's actions run against. */
        /** @type {any[]} */
        let devices = []
        /** @type {Record<string, string>} */
        let pending = {}
        /** @type {ReturnType<typeof setTimeout> | undefined} */
        let pendingTimer
        /** Device ids that already carry a gattserverdisconnected hook. */
        const hooked = new Set()
        let phraseIndex = 0
        /** @type {ReturnType<typeof setInterval> | undefined} */
        let phraseTimer
        /** @type {ReturnType<typeof setInterval> | undefined} */
        let refreshTimer

        // Cursor: a flat walk over header → device rows → the scan row.
        // Each nav target is {kind: 'header' | 'device' | 'scan', row?}.
        /** @type {{kind: string, row?: any}[]} */
        let navTargets = []
        let selectedIndex = 0
        let cursorActive = false
        let actionFocused = false

        const opened = () => !panel.hidden

        function barGlyph() {
            if (!available || !enabled) return GLYPH_DISABLED
            return devices.some(row => row.connected) ? GLYPH_CONNECTED : GLYPH_IDLE
        }

        function statusText() {
            if (!available) return 'No adapter'
            if (!enabled) return 'Turned Off'
            return PHRASES[phraseIndex % PHRASES.length]
        }

        // ---- Devices via Web Bluetooth --------------------------------

        function refresh() {
            if (!available || !enabled) {
                devices = []
                render()
                return
            }
            if (typeof bluetoothApi.getDevices !== 'function') {
                render()
                return
            }
            bluetoothApi.getDevices().then((/** @type {any[]} */ found) => {
                devices = (found || []).map(device => ({
                    id: String(device.id || ''),
                    name: String(device.name || ''),
                    connected: !!(device.gatt && device.gatt.connected),
                    device,
                }))
                for (const row of devices) {
                    // Settled actions clear their pending mark: a
                    // connect that landed shows Connected, a forget that
                    // landed has no row at all.
                    const action = BluetoothModel.pendingAction(pending, row.id)
                    if ((action === 'connecting' && row.connected)
                        || (action === 'disconnecting' && !row.connected)) {
                        pending = BluetoothModel.withPendingAction(pending, row.id, '')
                    }
                    if (!hooked.has(row.id) && row.device.addEventListener) {
                        hooked.add(row.id)
                        row.device.addEventListener('gattserverdisconnected', () => refresh())
                    }
                }
                for (const id of Object.keys(pending)) {
                    if (pending[id] === 'forgetting' && !devices.some(row => row.id === id)) {
                        pending = BluetoothModel.withPendingAction(pending, id, '')
                    }
                }
                render()
            }).catch(() => render())
        }

        /**
         * Marks a row busy and arms upstream's 20s stuck-action clear.
         * @param {string} id @param {string} action
         */
        function markPending(id, action) {
            pending = BluetoothModel.withPendingAction(pending, id, action)
            clearTimeout(pendingTimer)
            pendingTimer = setTimeout(() => {
                pending = {}
                render()
            }, 20000)
            render()
        }

        /** @param {any} row */
        function connectDevice(row) {
            if (!row.device.gatt) return
            markPending(row.id, 'connecting')
            row.device.gatt.connect().then(() => refresh()).catch(() => {
                pending = BluetoothModel.withPendingAction(pending, row.id, '')
                refresh()
            })
        }

        /** @param {any} row */
        function disconnectDevice(row) {
            if (!row.device.gatt) return
            markPending(row.id, 'disconnecting')
            try {
                row.device.gatt.disconnect()
            } catch {
            }
            setTimeout(refresh, 300)
        }

        /** @param {any} row */
        function forgetDevice(row) {
            if (typeof row.device.forget !== 'function') return
            markPending(row.id, 'forgetting')
            row.device.forget().then(() => refresh()).catch(() => {
                pending = BluetoothModel.withPendingAction(pending, row.id, '')
                refresh()
            })
        }

        /** @param {any} row */
        function activateDevice(row) {
            if (row.connected) disconnectDevice(row)
            else connectDevice(row)
        }

        // The browser's own chooser is the closest thing a page has to
        // discovery: the pick lands in getDevices() afterwards.
        function scanForDevices() {
            if (!available || !enabled) return
            bluetoothApi.requestDevice({ acceptAllDevices: true })
                .then(() => refresh())
                .catch(() => { })
        }

        function toggleEnabled() {
            if (!available) return
            enabled = !enabled
            Settings.set('bluetooth.enabled', enabled)
            phraseIndex = 0
            if (enabled) refresh()
            else {
                devices = []
                render()
            }
        }

        // ---- Rendering ------------------------------------------------

        function render() {
            button.textContent = barGlyph()

            heroIcon.textContent = barGlyph()
            heroIcon.classList.toggle('bluetooth-hero-icon-off', !available || !enabled)
            heroStatus.textContent = statusText().toUpperCase()
            powerSwitch.hidden = !available
            powerSwitch.setAttribute('aria-checked', String(enabled))
            powerSwitch.classList.toggle('bluetooth-switch-on', enabled)
            powerSwitch.title = enabled ? 'Turn Bluetooth off' : 'Turn Bluetooth on'

            const lists = BluetoothModel.deviceLists(
                devices.map(row => ({ ...row, known: true })))
            const sections = BluetoothModel.visibleSections(lists, false)

            navTargets = [{ kind: 'header' }]
            sectionsHost.textContent = ''
            for (const section of sections) {
                const title = document.createElement('div')
                title.className = 'bluetooth-section-title'
                title.textContent = section === 'connected' ? 'CONNECTED' : 'PAIRED'
                sectionsHost.appendChild(title)
                for (const row of BluetoothModel.sectionDevices(lists, section)) {
                    sectionsHost.appendChild(deviceRow(row))
                    navTargets.push({ kind: 'device', row })
                }
            }
            if (available && enabled) {
                sectionsHost.appendChild(scanRow())
                navTargets.push({ kind: 'scan' })
            }

            const noRows = sections.length === 0
            empty.hidden = !noRows
            if (!available) empty.textContent = 'No Bluetooth adapter'
            else if (!enabled) empty.textContent = 'Turn Bluetooth on to scan'
            else empty.textContent = 'Scanning for devices…'

            if (selectedIndex >= navTargets.length) selectedIndex = navTargets.length - 1
            if (selectedIndex < 0) selectedIndex = 0
            updateCursor()
        }

        /** @param {any} row */
        function deviceRow(row) {
            const cell = document.createElement('div')
            cell.className = 'bluetooth-row'
            cell.dataset.deviceId = row.id

            const icon = document.createElement('span')
            icon.className = 'bluetooth-row-icon'
            icon.textContent = row.connected ? GLYPH_CONNECTED : GLYPH_IDLE
            cell.appendChild(icon)

            const labels = document.createElement('div')
            labels.className = 'bluetooth-row-labels'
            const name = document.createElement('span')
            name.className = 'bluetooth-row-name'
            name.textContent = BluetoothModel.deviceLabel(row)
            labels.appendChild(name)

            const action = BluetoothModel.pendingAction(pending, row.id)
            const status = action
                ? BluetoothModel.pendingStatusText(action)
                : (row.connected ? 'Connected' : '')
            if (status) {
                const caption = document.createElement('span')
                caption.className = 'bluetooth-row-status'
                if (!action && !row.connected) caption.classList.add('bluetooth-row-status-dim')
                caption.textContent = status
                labels.appendChild(caption)
            }
            cell.appendChild(labels)

            const forget = document.createElement('button')
            forget.type = 'button'
            forget.className = 'bluetooth-row-forget'
            forget.textContent = GLYPH_FORGET
            forget.title = 'Forget'
            forget.addEventListener('click', event => {
                event.stopPropagation()
                forgetDevice(row)
            })
            cell.appendChild(forget)

            cell.title = row.connected ? 'Disconnect' : 'Connect'
            cell.addEventListener('click', () => activateDevice(row))
            cell.addEventListener('mousemove', () => {
                const index = navTargets.findIndex(
                    target => target.kind === 'device' && target.row.id === row.id)
                if (index >= 0 && (!cursorActive || selectedIndex !== index)) {
                    cursorActive = true
                    selectedIndex = index
                    actionFocused = false
                    updateCursor()
                }
            })
            return cell
        }

        function scanRow() {
            const cell = document.createElement('div')
            cell.className = 'bluetooth-row bluetooth-row-scan'
            const icon = document.createElement('span')
            icon.className = 'bluetooth-row-icon'
            icon.textContent = GLYPH_IDLE
            cell.appendChild(icon)
            const name = document.createElement('span')
            name.className = 'bluetooth-row-name'
            name.textContent = 'Scan for devices…'
            cell.appendChild(name)
            cell.title = 'Open the browser device chooser'
            cell.addEventListener('click', () => scanForDevices())
            cell.addEventListener('mousemove', () => {
                const index = navTargets.findIndex(target => target.kind === 'scan')
                if (index >= 0 && (!cursorActive || selectedIndex !== index)) {
                    cursorActive = true
                    selectedIndex = index
                    actionFocused = false
                    updateCursor()
                }
            })
            return cell
        }

        /** Repaints cursor classes only — rows themselves are rebuilt by
         * render() when the data moves. */
        function updateCursor() {
            hero.classList.toggle('bluetooth-cursor',
                cursorActive && navTargets[selectedIndex]?.kind === 'header')
            const rows = $$(sectionsHost, '.bluetooth-row')
            let rowIndex = 0
            navTargets.forEach((target, index) => {
                if (target.kind === 'header') return
                const cell = rows[rowIndex++]
                if (!cell) return
                const hasCursor = cursorActive && index === selectedIndex
                cell.classList.toggle('bluetooth-cursor', hasCursor && !actionFocused)
                const forget = cell.querySelector('.bluetooth-row-forget')
                if (forget) {
                    forget.classList.toggle('bluetooth-row-forget-cursor', hasCursor && actionFocused)
                    forget.classList.toggle('bluetooth-row-forget-shown', hasCursor)
                }
                if (hasCursor) cell.scrollIntoView({ block: 'nearest' })
            })
        }

        // ---- Panel ----------------------------------------------------

        function open() {
            selectedIndex = 0
            cursorActive = false
            actionFocused = false
            panel.hidden = false
            button.setAttribute('aria-expanded', 'true')
            refresh()
            refreshTimer = setInterval(refresh, 5000)
            phraseTimer = setInterval(() => {
                if (!enabled || !available) return
                // Fade out, swap, fade back — upstream's phrase swap.
                heroStatus.classList.add('bluetooth-hero-status-fading')
                setTimeout(() => {
                    phraseIndex = (phraseIndex + 1) % PHRASES.length
                    heroStatus.textContent = statusText().toUpperCase()
                    heroStatus.classList.remove('bluetooth-hero-status-fading')
                }, 180)
            }, 2800)
        }

        function close() {
            panel.hidden = true
            button.setAttribute('aria-expanded', 'false')
            clearInterval(refreshTimer)
            clearInterval(phraseTimer)
        }

        function toggle() {
            if (opened()) close()
            else open()
        }

        /** @param {number} delta */
        function moveCursor(delta) {
            if (!cursorActive) {
                cursorActive = true
                updateCursor()
                return
            }
            actionFocused = false
            selectedIndex = Math.max(0, Math.min(navTargets.length - 1, selectedIndex + delta))
            updateCursor()
        }

        function activateCursor() {
            const target = navTargets[selectedIndex]
            if (!target) return
            if (target.kind === 'header') toggleEnabled()
            else if (target.kind === 'scan') scanForDevices()
            else if (actionFocused) forgetDevice(target.row)
            else activateDevice(target.row)
        }

        // ---- Wiring ---------------------------------------------------

        button.addEventListener('click', () => {
            button.blur()
            toggle()
        })
        button.addEventListener('contextmenu', event => {
            event.preventDefault()
            toggleEnabled()
        })
        powerSwitch.addEventListener('click', event => {
            event.stopPropagation()
            toggleEnabled()
        })
        hero.addEventListener('mousemove', () => {
            if (!cursorActive || selectedIndex !== 0) {
                cursorActive = true
                selectedIndex = 0
                actionFocused = false
                updateCursor()
            }
        })
        empty.addEventListener('click', () => scanForDevices())

        dismissOnOutsideClick(opened, close,
            target => panel.contains(target) || button.contains(target))

        document.addEventListener('keydown', event => {
            if (!opened()) return
            // A fullscreen surface above the panel owns the keyboard.
            for (const selector of ['.menu', '.image-picker', '.keybindings',
                '.lock', '.screensaver', '.system-login']) {
                const el = /** @type {HTMLElement | null} */ (document.querySelector(selector))
                if (el && !el.hidden) return
            }

            const key = event.key
            const target = navTargets[selectedIndex]
            if (key === 'Escape') close()
            else if (key === 'ArrowDown' || key === 'j') moveCursor(1)
            else if (key === 'ArrowUp' || key === 'k') moveCursor(-1)
            else if (key === 'ArrowRight') {
                if (cursorActive && target?.kind === 'device') {
                    actionFocused = true
                    updateCursor()
                }
            } else if (key === 'ArrowLeft') {
                if (cursorActive && actionFocused) {
                    actionFocused = false
                    updateCursor()
                }
            } else if (key === 'Enter') {
                if (cursorActive) activateCursor()
                else {
                    cursorActive = true
                    updateCursor()
                }
            } else if (key === 'x') {
                if (cursorActive && target?.kind === 'device') forgetDevice(target.row)
            } else if (key === 'b' || key === 'B') toggleEnabled()
            else return
            event.preventDefault()
            event.stopPropagation()
        })

        document.addEventListener('omarchy:bluetooth-toggle', () => toggle())

        render()
        // A closed panel still wants a truthful bar glyph at startup.
        refresh()
    }
}

BAR_WIDGETS['omarchy.bluetooth'] = BluetoothBarWidget
