/**
 * Monitor defaults — the plugin's own shipped config (persisted user
 * overrides live in the `monitor.*` Settings namespace). `textSize`
 * matches `--font-size-base`'s stylesheet default, so a fresh install
 * changes nothing until the slider moves.
 */
const MONITOR_CONFIG = Object.freeze({
    textSize: 12,
    scale: '1',
})

/**
 * Monitor plugin — the display panel, mirroring upstream
 * `omarchy.monitor` (`shell/plugins/panels/monitor/Panel.qml`, kind
 * `bar-widget`): a monitor icon in the bar whose panel holds the
 * display controls.
 *
 * What each upstream control maps to in a browser:
 * - Brightness: no backlight exists, which is upstream's own
 *   `brightnessAvailable: false` state — the hero status reads
 *   "FIXED BRIGHTNESS" and the slider section never renders.
 * - Text size: upstream scales the shell's base font via
 *   `omarchy-display-text-size`; here the notched slider writes
 *   `--font-size-base` on `<html>` — same stops, same live reflow.
 * - Scale: upstream applies monitor scaling via Hyprland; here the
 *   pills set CSS `zoom` on `<html>`. The preset labels are cleaned
 *   against the real screen mode exactly like upstream (so a mode that
 *   can't do 1.25 evenly shows what it can do), and presets that
 *   collapse to the same effective scale are deduplicated.
 * - The multi-display list needs real outputs and is not ported
 *   (upstream hides it on single-display machines anyway).
 *
 * Cursor model, matching upstream: hover or ↑/↓ (j/k) picks a section
 * — the text-size slider, then the scale row — ←/→ (h/l) drags the
 * slider or walks the pills, Enter applies the picked scale, Escape
 * closes. The bar icon click (or `omarchy:monitor-toggle`, the analog
 * of `omarchy-shell shell toggle omarchy.monitor`) toggles the panel.
 *
 * Owns the `monitor.*` settings namespace (`monitor.textSize`,
 * `monitor.scale`), applied at mount so both survive a reload.
 * Registers as `omarchy.monitor` in {@link BAR_WIDGETS}.
 * @extends {Component}
 */
class MonitorBarWidget extends Component {
    static template = `
        <div class="monitor">
            <button type="button" class="monitor-bar-widget bar-icon-button" data-ref="button"
                    title="Display" aria-haspopup="dialog" aria-expanded="false"></button>
            <div class="monitor-panel" hidden data-ref="panel"
                 role="dialog" aria-label="Display">
                <div class="monitor-hero">
                    <span class="monitor-hero-glyph" data-ref="heroGlyph"></span>
                    <div class="monitor-hero-labels">
                        <span class="monitor-hero-title">Display</span>
                        <span class="monitor-hero-status">FIXED BRIGHTNESS</span>
                    </div>
                </div>
                <div class="monitor-separator"></div>
                <div class="monitor-section">
                    <div class="monitor-section-header">
                        <span class="monitor-section-title">TEXT SIZE</span>
                        <span class="monitor-section-value" data-ref="textValue"></span>
                    </div>
                    <div class="monitor-slider-row" data-ref="sliderRow">
                        <div class="monitor-slider" data-ref="slider" role="slider" aria-label="Text size"
                             aria-valuemin="0" aria-orientation="horizontal">
                            <div class="monitor-slider-track" data-ref="track"></div>
                            <div class="monitor-slider-knob" data-ref="knob"></div>
                        </div>
                    </div>
                </div>
                <div class="monitor-separator"></div>
                <div class="monitor-section">
                    <div class="monitor-section-header">
                        <span class="monitor-section-title">SCALE</span>
                    </div>
                    <div class="monitor-scale-row" data-ref="scaleRow"></div>
                </div>
            </div>
        </div>
    `

    /** @param {DocumentFragment} root */
    script(root) {
        const button = /** @type {HTMLButtonElement} */ ($(root, '[data-ref="button"]'))
        const panel = $(root, '[data-ref="panel"]')
        const textValue = $(root, '[data-ref="textValue"]')
        const sliderRow = $(root, '[data-ref="sliderRow"]')
        const slider = $(root, '[data-ref="slider"]')
        const track = $(root, '[data-ref="track"]')
        const knob = $(root, '[data-ref="knob"]')
        const scaleRow = $(root, '[data-ref="scaleRow"]')

        // Nerd Font monitor glyph (upstream shows the multi-monitor
        // variant only with several outputs; a browser has one).
        button.textContent = '\u{F0379}'
        $(root, '[data-ref="heroGlyph"]').textContent = '\u{F0379}'

        const stops = MonitorModel.TEXT_SIZE_STOPS
        slider.setAttribute('aria-valuemax', String(stops.length - 1))

        // The mode the scale presets are cleaned against — the real
        // screen, like upstream's focused output.
        const modeWidth = screen.width
        const modeHeight = screen.height
        const scaleValues = MonitorModel.availableScales(
            MonitorModel.SCALE_PRESETS, modeWidth, modeHeight)

        // ---- State. Both settings are this plugin's own and are
        //      applied at mount, so a reload keeps the chosen look.
        let textSize = MonitorModel.parseTextSize(
            Settings.get('monitor.textSize', MONITOR_CONFIG.textSize), MONITOR_CONFIG.textSize)
        let currentScale = MonitorModel.normalizeScale(
            Settings.get('monitor.scale', MONITOR_CONFIG.scale)) || MONITOR_CONFIG.scale

        // Cursor shared by keyboard and hover, as upstream: a section
        // ("textsize" | "scale") and an index into the scale pills (the
        // slider uses the -1 sentinel). Not painted until the pointer or
        // a navigation key first moves it.
        const SECTIONS = ['textsize', 'scale']
        let focusSection = 'scale'
        let selectedIndex = 0
        let cursorActive = false

        const opened = () => !panel.hidden

        function applyTextSize() {
            document.documentElement.style.setProperty('--font-size-base', textSize + 'px')
        }

        function applyScale() {
            document.documentElement.style.setProperty('zoom', currentScale)
            // Mirrored for stylesheets and scripts that must undo the
            // zoom in viewport math — see --viewport-w/h in styles.css.
            document.documentElement.style.setProperty('--shell-zoom', currentScale)
        }

        /** @param {*} value */
        function effectiveScale(value) {
            return MonitorModel.cleanScale(value, modeWidth, modeHeight)
                || MonitorModel.normalizeScale(value)
        }

        // ---- Scale pills, built once (the screen mode doesn't move
        //      under a session); render() only repaints their state.
        /** @type {HTMLButtonElement[]} */
        const pills = scaleValues.map((value, index) => {
            const pill = document.createElement('button')
            pill.type = 'button'
            pill.className = 'monitor-pill'
            pill.textContent = effectiveScale(value) + 'x'
            pill.addEventListener('click', () => setScale(value))
            pill.addEventListener('mouseenter', () => {
                cursorActive = true
                focusSection = 'scale'
                selectedIndex = index
                render()
            })
            scaleRow.appendChild(pill)
            return pill
        })

        function render() {
            textValue.textContent = textSize + 'px'
            const stopIndex = MonitorModel.nearestTextStop(textSize)
            slider.setAttribute('aria-valuenow', String(stopIndex))
            slider.setAttribute('aria-valuetext', textSize + 'px')
            knob.style.left = (stopIndex / (stops.length - 1)) * 100 + '%'
            const segments = /** @type {HTMLElement[]} */ ([...track.children])
            segments.forEach((segment, index) => {
                segment.classList.toggle('monitor-seg-filled', index < stopIndex)
            })
            sliderRow.classList.toggle('monitor-cursor',
                cursorActive && focusSection === 'textsize')

            const activeIndex = MonitorModel.matchingScaleIndex(
                scaleValues, currentScale, modeWidth, modeHeight)
            pills.forEach((pill, index) => {
                pill.classList.toggle('monitor-pill-active', index === activeIndex)
                pill.classList.toggle('monitor-cursor',
                    cursorActive && focusSection === 'scale' && selectedIndex === index)
            })
        }

        // Track segments: one fewer than there are stops, so the ticks
        // (the gaps between segments) sit exactly on the stops.
        for (let i = 0; i < stops.length - 1; i++) {
            const segment = document.createElement('span')
            segment.className = 'monitor-slider-seg'
            track.appendChild(segment)
        }

        /** @param {number} index */
        function setTextIndex(index) {
            const clamped = Math.max(0, Math.min(stops.length - 1, index))
            if (stops[clamped] === textSize) return
            textSize = stops[clamped]
            Settings.set('monitor.textSize', textSize)
            // Applied live — a CSS variable has none of the file
            // round-trip upstream debounces around.
            applyTextSize()
            render()
        }

        /** @param {*} value */
        function setScale(value) {
            const next = effectiveScale(value)
            if (next === '' || next === currentScale) return
            currentScale = next
            Settings.set('monitor.scale', currentScale)
            applyScale()
            render()
        }

        function open() {
            // Upstream lands on brightness when there is one; without a
            // backlight the scale row is the first actionable section.
            focusSection = 'scale'
            selectedIndex = Math.max(0, MonitorModel.matchingScaleIndex(
                scaleValues, currentScale, modeWidth, modeHeight))
            cursorActive = false
            render()
            panel.hidden = false
            button.setAttribute('aria-expanded', 'true')
        }

        function close() {
            panel.hidden = true
            button.setAttribute('aria-expanded', 'false')
        }

        function toggle() {
            if (opened()) close()
            else open()
        }

        /** @param {number} delta */
        function moveCursor(delta) {
            const sectionIndex = SECTIONS.indexOf(focusSection)
            const next = sectionIndex + delta
            if (next < 0 || next >= SECTIONS.length) return
            focusSection = SECTIONS[next]
            selectedIndex = focusSection === 'scale'
                ? Math.max(0, MonitorModel.matchingScaleIndex(
                    scaleValues, currentScale, modeWidth, modeHeight))
                : -1
            render()
        }

        /** @param {number} delta */
        function moveCursorH(delta) {
            if (focusSection === 'textsize') {
                setTextIndex(MonitorModel.nearestTextStop(textSize) + delta)
            } else {
                selectedIndex = Math.max(0, Math.min(pills.length - 1, selectedIndex + delta))
                render()
            }
        }

        // ---- Slider dragging: snap to the nearest stop under the
        //      pointer, applying live.
        /** @param {PointerEvent} event */
        function stopFromPointer(event) {
            const rect = slider.getBoundingClientRect()
            const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0
            return Math.round(Math.max(0, Math.min(1, ratio)) * (stops.length - 1))
        }

        slider.addEventListener('pointerdown', event => {
            event.preventDefault()
            slider.setPointerCapture(event.pointerId)
            setTextIndex(stopFromPointer(event))
        })
        slider.addEventListener('pointermove', event => {
            if (slider.hasPointerCapture(event.pointerId)) {
                setTextIndex(stopFromPointer(event))
            }
        })
        sliderRow.addEventListener('mouseenter', () => {
            cursorActive = true
            focusSection = 'textsize'
            selectedIndex = -1
            render()
        })

        // ---- Wiring ---------------------------------------------------

        button.addEventListener('click', () => {
            button.blur()
            toggle()
        })

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
            if (key === 'Escape') close()
            else if (key === 'ArrowUp' || key === 'k') activateOr(() => moveCursor(-1))
            else if (key === 'ArrowDown' || key === 'j') activateOr(() => moveCursor(1))
            else if (key === 'ArrowLeft' || key === 'h') activateOr(() => moveCursorH(-1))
            else if (key === 'ArrowRight' || key === 'l') activateOr(() => moveCursorH(1))
            else if (key === 'Enter') {
                if (cursorActive && focusSection === 'scale'
                    && selectedIndex >= 0 && selectedIndex < scaleValues.length) {
                    setScale(scaleValues[selectedIndex])
                }
            }
            else return
            event.preventDefault()
            event.stopPropagation()
        })

        /**
         * The first navigation key only reveals the cursor, as upstream:
         * a summoned panel shouldn't look pre-picked before any intent.
         * @param {() => void} action
         */
        function activateOr(action) {
            if (!cursorActive) {
                cursorActive = true
                render()
                return
            }
            action()
        }

        document.addEventListener('omarchy:monitor-toggle', () => toggle())

        applyTextSize()
        applyScale()
        render()
    }
}

BAR_WIDGETS['omarchy.monitor'] = MonitorBarWidget
