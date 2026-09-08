/**
 * @extends {Component}
 */
class SpeedTestOverlay extends Component {
    static template = `
        <div class="speedtest-overlay" hidden data-ref="overlay"
             role="dialog" aria-modal="true" aria-label="Speed test">
            <div class="speedtest-cluster" data-ref="cluster">
                <div class="speedtest-title" data-ref="title"></div>
                <div class="speedtest-dials" data-ref="dials"></div>
                <button type="button" class="speedtest-run" data-ref="runButton">Run Again</button>
                <div class="speedtest-error" hidden data-ref="error"></div>
            </div>
        </div>
    `

    /**
     * @param {{leftLabel: string, rightLabel: string, unit?: string,
     *   runAgainTooltip?: string, scaleStops?: number[],
     *   onClose: () => void, onRunAgain: () => void}} config
     */
    constructor(config) {
        super()
        this.config = config
    }

    /** @param {DocumentFragment} root */
    script(root) {
        const config = this.config
        const overlay = $(root, '[data-ref="overlay"]')
        const cluster = $(root, '[data-ref="cluster"]')
        const title = $(root, '[data-ref="title"]')
        const dialsHost = $(root, '[data-ref="dials"]')
        const runButton = /** @type {HTMLButtonElement} */ ($(root, '[data-ref="runButton"]'))
        const errorText = $(root, '[data-ref="error"]')

        const scaleStops = (config.scaleStops && config.scaleStops.length > 0)
            ? config.scaleStops.slice()
            : [100, 250, 500, 1000, 2500, 5000, 10000]
        let fullScale = scaleStops[0]
        let running = false

        runButton.title = config.runAgainTooltip || 'Measure again'

        const DIAL_START = 135
        const DIAL_SWEEP = 270
        const TICK_COUNT = 46

        /** @param {string} label */
        function buildDial(label) {
            const dial = document.createElement('div')
            dial.className = 'speedtest-dial'

            const svgNs = 'http://www.w3.org/2000/svg'
            const svg = document.createElementNS(svgNs, 'svg')
            svg.setAttribute('viewBox', '0 0 210 210')
            svg.classList.add('speedtest-dial-arcs')
            /** @param {string} cls @param {number} width */
            const arc = (cls, width) => {
                const circle = document.createElementNS(svgNs, 'circle')
                circle.setAttribute('cx', '105')
                circle.setAttribute('cy', '105')
                circle.setAttribute('r', '101')
                circle.setAttribute('pathLength', '360')
                circle.setAttribute('stroke-width', String(width))
                circle.setAttribute('transform', `rotate(${DIAL_START} 105 105)`)
                circle.classList.add(cls)
                svg.appendChild(circle)
                return circle
            }
            const track = arc('speedtest-arc-track', 4)
            track.setAttribute('stroke-dasharray', `${DIAL_SWEEP} 360`)
            const glow = arc('speedtest-arc-glow', 12)
            const value = arc('speedtest-arc-value', 4)
            dial.appendChild(svg)

            const ticks = document.createElement('div')
            ticks.className = 'speedtest-ticks'
            for (let i = 0; i < TICK_COUNT; i++) {
                const holder = document.createElement('div')
                holder.className = 'speedtest-tick-holder'
                holder.style.transform =
                    `rotate(${DIAL_START + (i / (TICK_COUNT - 1)) * DIAL_SWEEP - 270}deg)`
                const tick = document.createElement('span')
                tick.className = i % 5 === 0 ? 'speedtest-tick-major' : 'speedtest-tick'
                holder.appendChild(tick)
                ticks.appendChild(holder)
            }
            dial.appendChild(ticks)

            const needleHolder = document.createElement('div')
            needleHolder.className = 'speedtest-needle-holder'
            const needle = document.createElement('span')
            needle.className = 'speedtest-needle'
            needleHolder.appendChild(needle)
            dial.appendChild(needleHolder)

            const readout = document.createElement('div')
            readout.className = 'speedtest-readout'
            const number = document.createElement('span')
            number.className = 'speedtest-readout-value'
            number.textContent = '0.0'
            const unit = document.createElement('span')
            unit.className = 'speedtest-readout-unit'
            unit.textContent = config.unit || 'Mbps'
            readout.appendChild(number)
            readout.appendChild(unit)
            dial.appendChild(readout)

            const footer = document.createElement('span')
            footer.className = 'speedtest-dial-label'
            footer.textContent = label
            dial.appendChild(footer)

            return {
                element: dial, glow, value, needleHolder, number,
                shown: 0, reading: 0, live: false,
                /** @param {number} fraction */
                paint(fraction) {
                    const sweep = DIAL_SWEEP * Math.max(0, Math.min(1, fraction))
                    const visible = fraction > 0.004
                    this.value.setAttribute('stroke-dasharray', `${sweep} 360`)
                    this.glow.setAttribute('stroke-dasharray', `${sweep} 360`)
                    this.value.classList.toggle('speedtest-arc-hidden', !visible)
                    this.glow.classList.toggle('speedtest-arc-hidden', !visible)
                    this.needleHolder.style.transform =
                        `rotate(${DIAL_START + fraction * DIAL_SWEEP - 270}deg)`
                },
            }
        }

        const dials = {
            left: buildDial(config.leftLabel),
            right: buildDial(config.rightLabel),
        }
        dialsHost.appendChild(dials.left.element)
        dialsHost.appendChild(dials.right.element)

        /** @param {number} value */
        function formatReading(value) {
            return value < 10
                ? value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
                : Math.round(value).toLocaleString()
        }

        /** @param {number} value */
        function expandScale(value) {
            for (const stop of scaleStops) {
                if (value <= stop * 0.92) {
                    if (stop > fullScale) fullScale = stop
                    repaint()
                    return
                }
            }
            fullScale = scaleStops[scaleStops.length - 1]
            repaint()
        }

        function repaint() {
            for (const side of /** @type {const} */ (['left', 'right'])) {
                const dial = dials[side]
                dial.paint(fullScale > 0 ? dial.shown / fullScale : 0)
                dial.number.textContent = formatReading(dial.reading)
                dial.element.classList.toggle('speedtest-dial-engaged',
                    dial.live || dial.shown > 0)
            }
        }

        let ignitionTimer = 0
        function ignite() {
            clearTimeout(ignitionTimer)
            dials.left.shown = fullScale
            dials.right.shown = fullScale
            repaint()
            ignitionTimer = setTimeout(() => {
                dials.left.shown = 0
                dials.right.shown = 0
                repaint()
            }, 550)
        }

        const opened = () => !overlay.hidden

        this.openOverlay = () => {
            overlay.hidden = false
            fullScale = scaleStops[0]
            ignite()
        }
        this.closeOverlay = () => {
            overlay.hidden = true
            clearTimeout(ignitionTimer)
        }
        this.openedOverlay = opened
        /** @param {string} text */
        this.setTitle = text => {
            title.textContent = String(text || '').toUpperCase()
            title.hidden = !text
        }
        /** @param {boolean} next */
        this.setRunning = next => {
            running = next
            if (next) {
                fullScale = scaleStops[0]
                this.setError('')
            }
            runButton.disabled = next
            runButton.classList.toggle('speedtest-run-hidden', next)
            if (!next) {
                for (const side of /** @type {const} */ (['left', 'right'])) {
                    dials[side].live = false
                }
                repaint()
            }
        }
        /** @param {'left' | 'right'} side @param {number} value */
        this.setValue = (side, value) => {
            const v = isFinite(value) && value > 0 ? value : 0
            dials[side].reading = v
            dials[side].shown = v
            expandScale(v)
        }
        /** @param {'left' | 'right'} side @param {boolean} live */
        this.setLive = (side, live) => {
            dials[side].live = live
            repaint()
        }
        /** @param {string} message */
        this.setError = message => {
            errorText.textContent = message
            errorText.hidden = !message
        }

        overlay.addEventListener('mousedown', event => {
            if (!(event.target instanceof Node) || !cluster.contains(event.target)) {
                config.onClose()
            }
        })
        runButton.addEventListener('click', () => {
            if (!running) config.onRunAgain()
        })

        document.addEventListener('keydown', event => {
            if (!opened()) return
            event.preventDefault()
            event.stopPropagation()
            if (event.key === 'Escape') config.onClose()
            else if (event.key === 'Enter' && !running) config.onRunAgain()
        }, { capture: true })

        repaint()
    }
}
