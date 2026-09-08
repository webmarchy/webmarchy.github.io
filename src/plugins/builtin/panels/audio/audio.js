/**
 * Audio plugin — the audio panel, mirroring upstream `omarchy.audio`
 * (`shell/plugins/panels/audio/Panel.qml`, kind `bar-widget`): a speaker
 * glyph in the bar whose panel holds the mixer.
 *
 * What each upstream control maps to in a browser (no PipeWire exists;
 * the shell's own media elements are the audio world):
 * - Master output: a SHELL-owned volume/mute (`audio.volume`,
 *   `audio.muted`), applied to every `<audio>`/`<video>` element in the
 *   page — on change, and to each element the first time it plays. The
 *   media apps keep their own volume keys, so a master change simply
 *   overrides them, the way a real mixer overrides an app slider.
 * - OUTPUT devices: `navigator.mediaDevices.enumerateDevices()`
 *   (`audiooutput`); labels appear once any capture permission was
 *   granted, positional stand-ins ("Speakers", "Output 2") before then.
 *   Picking one persists `audio.outputDeviceId` and best-effort routes
 *   page media via `setSinkId` where the browser allows it.
 * - INPUT: rendered only when microphones enumerate. The slider is the
 *   stored `audio.inputVolume` preference (a page cannot set OS input
 *   gain). The peak meter only runs if microphone permission is ALREADY
 *   granted — this panel never prompts — sampling a muted analyser
 *   while the panel is open and releasing the mic on close.
 * - SOURCES: the per-app streams — the page's live media elements,
 *   labelled by the app window that owns them, each with upstream's
 *   mute toggle and its own volume slider (browsers cap element volume
 *   at 100%, where upstream allows 150%).
 *
 * Cursor model, matching upstream: hover or j/k (arrows) walks header →
 * output slider → output devices → input slider → input devices →
 * streams; h/l (←/→) drags whichever slider holds the cursor, `m`
 * mutes it, Enter/Space activates, Escape closes. The bar button:
 * left-click toggles the panel, right-click toggles mute-everything,
 * wheel nudges the master volume by 0.05.
 *
 * Owns the `audio.*` settings namespace (`audio.volume`, `audio.muted`,
 * `audio.inputVolume`, `audio.inputMuted`, `audio.outputDeviceId`,
 * `audio.inputDeviceId`) and the `omarchy:audio-toggle` action event.
 * Registers as `omarchy.audio` in {@link BAR_WIDGETS}.
 * @extends {Component}
 */
class AudioBarWidget extends Component {
    static template = `
        <div class="audio">
            <button type="button" class="audio-bar-widget bar-icon-button" data-ref="button"
                    title="Audio" aria-haspopup="dialog" aria-expanded="false"></button>
            <div class="audio-panel" hidden data-ref="panel"
                 role="dialog" aria-label="Audio">
                <div class="audio-hero">
                    <span class="audio-hero-glyph" data-ref="heroGlyph"></span>
                    <div class="audio-hero-labels">
                        <span class="audio-hero-title">Audio</span>
                        <span class="audio-hero-status" data-ref="heroStatus"></span>
                    </div>
                    <button type="button" class="audio-switch" data-ref="heroSwitch"
                            role="switch" title="Mute"><span class="audio-switch-knob"></span></button>
                </div>
                <div class="audio-separator"></div>
                <div class="audio-section">
                    <div class="audio-section-header">
                        <span class="audio-section-title">OUTPUT</span>
                        <span class="audio-section-value" data-ref="outputPercent"></span>
                    </div>
                    <div class="audio-slider-row" data-ref="outputSliderRow">
                        <div class="audio-slider" data-ref="outputSlider">
                            <div class="audio-slider-track"><div class="audio-slider-fill" data-ref="outputFill"></div></div>
                        </div>
                    </div>
                    <div class="audio-devices" data-ref="outputDevices"></div>
                </div>
                <div class="audio-separator" hidden data-ref="inputSeparator"></div>
                <div class="audio-section" hidden data-ref="inputSection">
                    <div class="audio-section-header">
                        <span class="audio-section-title">INPUT</span>
                        <span class="audio-section-value" data-ref="inputPercent"></span>
                    </div>
                    <div class="audio-slider-row" data-ref="inputSliderRow">
                        <div class="audio-slider" data-ref="inputSlider">
                            <div class="audio-slider-track"><div class="audio-slider-fill" data-ref="inputFill"></div></div>
                        </div>
                        <div class="audio-peak" hidden data-ref="peak">
                            <div class="audio-peak-fill" data-ref="peakFill"></div>
                        </div>
                    </div>
                    <div class="audio-devices" data-ref="inputDevices"></div>
                </div>
                <div class="audio-separator" hidden data-ref="streamSeparator"></div>
                <div class="audio-section" hidden data-ref="streamSection">
                    <div class="audio-section-header">
                        <span class="audio-section-title">SOURCES</span>
                    </div>
                    <div class="audio-streams" data-ref="streams"></div>
                </div>
            </div>
        </div>
    `

    /** @param {DocumentFragment} root */
    script(root) {
        const button = /** @type {HTMLButtonElement} */ ($(root, '[data-ref="button"]'))
        const panel = $(root, '[data-ref="panel"]')
        const heroGlyph = $(root, '[data-ref="heroGlyph"]')
        const heroStatus = $(root, '[data-ref="heroStatus"]')
        const heroSwitch = /** @type {HTMLButtonElement} */ ($(root, '[data-ref="heroSwitch"]'))
        const outputPercent = $(root, '[data-ref="outputPercent"]')
        const outputSliderRow = $(root, '[data-ref="outputSliderRow"]')
        const outputSlider = $(root, '[data-ref="outputSlider"]')
        const outputFill = $(root, '[data-ref="outputFill"]')
        const outputDevices = $(root, '[data-ref="outputDevices"]')
        const inputSeparator = $(root, '[data-ref="inputSeparator"]')
        const inputSection = $(root, '[data-ref="inputSection"]')
        const inputPercent = $(root, '[data-ref="inputPercent"]')
        const inputSliderRow = $(root, '[data-ref="inputSliderRow"]')
        const inputSlider = $(root, '[data-ref="inputSlider"]')
        const inputFill = $(root, '[data-ref="inputFill"]')
        const peak = $(root, '[data-ref="peak"]')
        const peakFill = $(root, '[data-ref="peakFill"]')
        const inputDevices = $(root, '[data-ref="inputDevices"]')
        const streamSeparator = $(root, '[data-ref="streamSeparator"]')
        const streamSection = $(root, '[data-ref="streamSection"]')
        const streamsHost = $(root, '[data-ref="streams"]')

        // ---- State. The master mix is the plugin's own; devices and
        //      streams are re-read from the page while the panel is up.
        let volume = AudioModel.snapVolume(Settings.get('audio.volume', 1))
        let muted = Settings.get('audio.muted', false) === true
        let inputVolume = AudioModel.snapVolume(Settings.get('audio.inputVolume', 1))
        let inputMuted = Settings.get('audio.inputMuted', false) === true
        let outputDeviceId = String(Settings.get('audio.outputDeviceId', ''))

        /** @type {MediaDeviceInfo[]} */ let outputs = []
        /** @type {MediaDeviceInfo[]} */ let inputs = []
        /** @type {{element: HTMLMediaElement, label: string}[]} */ let streams = []

        // Cursor shared by keyboard and hover, as upstream: an ordered
        // row list rebuilt with the panel, and an index into it. Not
        // painted until the pointer or a navigation key first moves it.
        /** @type {{kind: string, element: HTMLElement, device?: MediaDeviceInfo, stream?: {element: HTMLMediaElement, label: string}}[]} */
        let rows = []
        let cursorIndex = 0
        let cursorActive = false
        let dragging = false

        let deviceTimer = 0
        let streamTimer = 0

        const opened = () => !panel.hidden

        // ---- Master mix -----------------------------------------------

        function mediaElements() {
            return /** @type {HTMLMediaElement[]} */ ($$(document, 'audio, video'))
        }

        // Elements that already got the master mix once; a master change
        // re-stamps everyone, but a playing element isn't re-stomped on
        // every tick, so the media apps' own volume keys keep working
        // between master changes.
        const stamped = new WeakSet()

        /** @param {HTMLMediaElement} element */
        function stamp(element) {
            element.volume = muted ? 0 : volume
            element.muted = element.muted || muted
            stamped.add(element)
        }

        function applyMaster() {
            for (const element of mediaElements()) {
                element.volume = muted ? 0 : volume
                if (muted) element.muted = true
                stamped.add(element)
            }
        }

        function unmuteAll() {
            for (const element of mediaElements()) element.muted = false
        }

        // New media picked up as it starts, without watching the DOM.
        document.addEventListener('play', event => {
            const target = event.target
            if (target instanceof HTMLMediaElement && !stamped.has(target)) stamp(target)
        }, { capture: true })

        /** @param {*} next */
        function setVolume(next) {
            volume = AudioModel.snapVolume(next)
            Settings.set('audio.volume', volume)
            applyMaster()
            render()
        }

        function toggleOutputMuted() {
            muted = !muted
            Settings.set('audio.muted', muted)
            if (muted) applyMaster()
            else {
                unmuteAll()
                applyMaster()
            }
            render()
        }

        // The hero switch reads "is anything audible": toggling silences
        // the whole mix or brings all of it back, like upstream's
        // toggleAllMuted.
        function toggleAllMuted() {
            const anyAudible = !muted || !inputMuted
            muted = anyAudible
            inputMuted = anyAudible
            Settings.set('audio.muted', muted)
            Settings.set('audio.inputMuted', inputMuted)
            if (muted) applyMaster()
            else {
                unmuteAll()
                applyMaster()
            }
            render()
        }

        function toggleInputMuted() {
            inputMuted = !inputMuted
            Settings.set('audio.inputMuted', inputMuted)
            render()
        }

        // ---- Devices --------------------------------------------------

        function activeOutput() {
            return outputs.find(device => device.deviceId === outputDeviceId)
                || outputs.find(device => device.deviceId === 'default')
                || outputs[0] || null
        }

        function refreshDevices() {
            if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return
            navigator.mediaDevices.enumerateDevices()
                .then(all => {
                    outputs = all.filter(device => device.kind === 'audiooutput')
                    inputs = all.filter(device => device.kind === 'audioinput')
                    if (opened() && !dragging) render()
                })
                .catch(() => { })
        }

        /** @param {MediaDeviceInfo} device */
        function setDefaultOutput(device) {
            outputDeviceId = device.deviceId
            Settings.set('audio.outputDeviceId', outputDeviceId)
            // Routing is best-effort: setSinkId needs browser support
            // and may refuse per element.
            for (const element of mediaElements()) {
                const routable = /** @type {*} */ (element)
                if (typeof routable.setSinkId === 'function') {
                    Promise.resolve(routable.setSinkId(device.deviceId)).catch(() => { })
                }
            }
            render()
        }

        /** @param {MediaDeviceInfo} device */
        function setDefaultInput(device) {
            Settings.set('audio.inputDeviceId', device.deviceId)
            render()
        }

        // ---- Streams (the page's media elements) ----------------------

        /** @param {HTMLMediaElement} element */
        function streamLabelFor(element) {
            const win = element.closest('.app-window')
            if (win) {
                for (const app of AppLibrary.entries()) {
                    if (win.querySelector('.' + app.id)) return app.name
                }
            }
            return 'Stream'
        }

        function collectStreams() {
            streams = mediaElements()
                .filter(element => element.currentSrc || element.srcObject || !element.paused)
                .map(element => ({ element, label: streamLabelFor(element) }))
        }

        // ---- Input peak meter. Never prompts: it only runs when the
        //      microphone permission is already granted, and the mic is
        //      released the moment the panel closes.
        /** @type {MediaStream | null} */ let micStream = null
        /** @type {AudioContext | null} */ let micContext = null
        /** @type {AnalyserNode | null} */ let analyser = null
        let peakFrame = 0

        function startPeakMeter() {
            if (micStream || !navigator.permissions || !navigator.mediaDevices
                || !navigator.mediaDevices.getUserMedia) return
            navigator.permissions.query({ name: /** @type {PermissionName} */ ('microphone') })
                .then(status => {
                    if (status.state !== 'granted' || !opened()) return null
                    return navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
                        if (!opened()) {
                            stream.getTracks().forEach(track => track.stop())
                            return null
                        }
                        micStream = stream
                        micContext = new AudioContext()
                        analyser = micContext.createAnalyser()
                        analyser.fftSize = 256
                        micContext.createMediaStreamSource(stream).connect(analyser)
                        peak.hidden = false
                        const data = new Uint8Array(analyser.fftSize)
                        const tick = () => {
                            if (!analyser) return
                            analyser.getByteTimeDomainData(data)
                            let level = 0
                            for (const sample of data) {
                                level = Math.max(level, Math.abs(sample - 128) / 128)
                            }
                            peakFill.style.width = (Math.min(1, level) * 100).toFixed(1) + '%'
                            peakFrame = requestAnimationFrame(tick)
                        }
                        tick()
                        return null
                    })
                })
                .catch(() => { })
        }

        function stopPeakMeter() {
            cancelAnimationFrame(peakFrame)
            analyser = null
            if (micContext) micContext.close().catch(() => { })
            micContext = null
            if (micStream) micStream.getTracks().forEach(track => track.stop())
            micStream = null
            peak.hidden = true
        }

        // ---- Rendering ------------------------------------------------

        function activeOutputLabel() {
            const device = activeOutput()
            return device ? device.label : ''
        }

        /**
         * A continuous slider row: writes the fill, wires dragging once.
         * @param {HTMLElement} slider @param {(ratio: number) => void} commit
         */
        function wireSlider(slider, commit) {
            slider.addEventListener('pointerdown', event => {
                event.preventDefault()
                dragging = true
                slider.setPointerCapture(event.pointerId)
                commit(ratioFromPointer(slider, event))
            })
            slider.addEventListener('pointermove', event => {
                if (slider.hasPointerCapture(event.pointerId)) {
                    commit(ratioFromPointer(slider, event))
                }
            })
            slider.addEventListener('pointerup', () => { dragging = false })
        }

        /** @param {HTMLElement} slider @param {PointerEvent} event */
        function ratioFromPointer(slider, event) {
            const rect = slider.getBoundingClientRect()
            return rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0
        }

        /**
         * @param {string} glyph @param {string} label @param {boolean} current
         * @param {() => void} activate
         */
        function deviceRow(glyph, label, current, activate) {
            const row = document.createElement('button')
            row.type = 'button'
            row.className = 'audio-row'
            if (current) row.classList.add('audio-row-current')
            const icon = document.createElement('span')
            icon.className = 'audio-row-icon'
            icon.textContent = glyph
            row.appendChild(icon)
            const name = document.createElement('span')
            name.className = 'audio-row-label'
            name.textContent = label
            row.appendChild(name)
            row.addEventListener('click', activate)
            return row
        }

        function render() {
            const heroIcon = AudioModel.outputIcon(volume, muted, activeOutputLabel())
            button.textContent = heroIcon
            heroGlyph.textContent = heroIcon
            heroGlyph.classList.toggle('audio-dimmed', muted)
            heroStatus.textContent = AudioModel.outputVolumeName(volume, muted).toUpperCase()
            const anyAudible = !muted || !inputMuted
            heroSwitch.setAttribute('aria-checked', String(anyAudible))
            heroSwitch.classList.toggle('audio-switch-on', anyAudible)
            heroSwitch.title = anyAudible ? 'Mute' : 'Unmute'

            outputPercent.textContent = AudioModel.percentText(volume)
            outputPercent.classList.toggle('audio-dimmed', muted)
            outputFill.style.width = (volume * 100).toFixed(0) + '%'
            outputSlider.classList.toggle('audio-dimmed', muted)

            inputPercent.textContent = AudioModel.percentText(inputVolume)
            inputPercent.classList.toggle('audio-dimmed', inputMuted)
            inputFill.style.width = (inputVolume * 100).toFixed(0) + '%'
            inputSlider.classList.toggle('audio-dimmed', inputMuted)

            const showInput = inputs.length > 0
            inputSeparator.hidden = !showInput
            inputSection.hidden = !showInput

            collectStreams()
            const showStreams = streams.length > 0
            streamSeparator.hidden = !showStreams
            streamSection.hidden = !showStreams

            // ---- Row list + cursor targets, rebuilt together ----------
            rows = [
                { kind: 'header', element: heroSwitch },
                { kind: 'out-slider', element: outputSliderRow },
            ]

            const active = activeOutput()
            outputDevices.textContent = ''
            outputs.forEach((device, index) => {
                const label = AudioModel.deviceLabel(device.label, index, 'output')
                const row = deviceRow(AudioModel.sinkGlyph(device.label || label), label,
                    active === device, () => setDefaultOutput(device))
                outputDevices.appendChild(row)
                rows.push({ kind: 'out-dev', element: row, device })
            })

            inputDevices.textContent = ''
            if (showInput) {
                rows.push({ kind: 'in-slider', element: inputSliderRow })
                const preferred = String(Settings.get('audio.inputDeviceId', ''))
                inputs.forEach((device, index) => {
                    const label = AudioModel.deviceLabel(device.label, index, 'input')
                    const current = preferred !== ''
                        ? device.deviceId === preferred
                        : device.deviceId === 'default' || index === 0
                    const row = deviceRow(AudioModel.sourceGlyph(device.label || label), label,
                        current, () => setDefaultInput(device))
                    inputDevices.appendChild(row)
                    rows.push({ kind: 'in-dev', element: row, device })
                })
            }

            streamsHost.textContent = ''
            for (const stream of streams) {
                const row = document.createElement('div')
                row.className = 'audio-stream'

                const top = document.createElement('div')
                top.className = 'audio-stream-top'
                const mute = document.createElement('button')
                mute.type = 'button'
                mute.className = 'audio-row-icon audio-stream-mute'
                mute.textContent = AudioModel.streamMuteIcon(stream.element.muted)
                mute.classList.toggle('audio-dimmed', stream.element.muted)
                mute.addEventListener('click', () => {
                    stream.element.muted = !stream.element.muted
                    render()
                })
                top.appendChild(mute)
                const name = document.createElement('span')
                name.className = 'audio-row-label'
                name.textContent = stream.label
                top.appendChild(name)
                const pct = document.createElement('span')
                pct.className = 'audio-section-value'
                pct.textContent = AudioModel.percentText(stream.element.volume)
                pct.classList.toggle('audio-dimmed', stream.element.muted)
                top.appendChild(pct)
                row.appendChild(top)

                const slider = document.createElement('div')
                slider.className = 'audio-slider'
                if (stream.element.muted) slider.classList.add('audio-dimmed')
                const track = document.createElement('div')
                track.className = 'audio-slider-track'
                const fill = document.createElement('div')
                fill.className = 'audio-slider-fill'
                fill.style.width = (stream.element.volume * 100).toFixed(0) + '%'
                track.appendChild(fill)
                slider.appendChild(track)
                wireSlider(slider, ratio => {
                    stream.element.volume = AudioModel.snapVolume(ratio)
                    render()
                })
                slider.addEventListener('contextmenu', event => {
                    event.preventDefault()
                    stream.element.muted = !stream.element.muted
                    render()
                })
                row.appendChild(slider)

                streamsHost.appendChild(row)
                rows.push({ kind: 'stream', element: row, stream })
            }

            if (cursorIndex >= rows.length) cursorIndex = Math.max(0, rows.length - 1)
            rows.forEach((row, index) => {
                row.element.classList.toggle('audio-cursor', cursorActive && index === cursorIndex)
                if (row.kind !== 'header') {
                    row.element.addEventListener('mousemove', () => {
                        if (!cursorActive || cursorIndex !== index) {
                            cursorActive = true
                            cursorIndex = index
                            paintCursor()
                        }
                    })
                }
            })
        }

        /** Selection repaint only — pointer moves shouldn't rebuild rows. */
        function paintCursor() {
            rows.forEach((row, index) => {
                row.element.classList.toggle('audio-cursor', cursorActive && index === cursorIndex)
            })
        }

        // ---- Cursor actions -------------------------------------------

        /** @param {number} delta */
        function moveCursor(delta) {
            if (rows.length === 0) return
            cursorIndex = Math.max(0, Math.min(rows.length - 1, cursorIndex + delta))
            paintCursor()
        }

        /** @param {number} direction */
        function adjustCursor(direction) {
            const row = rows[cursorIndex]
            if (!row) return
            const step = direction * 0.05
            if (row.kind === 'out-slider' || row.kind === 'header') setVolume(volume + step)
            else if (row.kind === 'in-slider') {
                inputVolume = AudioModel.snapVolume(inputVolume + step)
                Settings.set('audio.inputVolume', inputVolume)
                render()
            } else if (row.kind === 'stream' && row.stream) {
                row.stream.element.volume = AudioModel.snapVolume(row.stream.element.volume + step)
                render()
            }
        }

        function muteCursor() {
            const row = rows[cursorIndex]
            if (!row) return
            if (row.kind === 'header') toggleAllMuted()
            else if (row.kind === 'out-slider' || row.kind === 'out-dev') toggleOutputMuted()
            else if (row.kind === 'in-slider' || row.kind === 'in-dev') toggleInputMuted()
            else if (row.kind === 'stream' && row.stream) {
                row.stream.element.muted = !row.stream.element.muted
                render()
            }
        }

        function activateCursor() {
            const row = rows[cursorIndex]
            if (!row) return
            if (row.kind === 'header') toggleAllMuted()
            else if (row.kind === 'out-slider') toggleOutputMuted()
            else if (row.kind === 'in-slider') toggleInputMuted()
            else if (row.kind === 'out-dev' && row.device) setDefaultOutput(row.device)
            else if (row.kind === 'in-dev' && row.device) setDefaultInput(row.device)
            else if (row.kind === 'stream' && row.stream) {
                row.stream.element.muted = !row.stream.element.muted
                render()
            }
        }

        // ---- Panel lifecycle ------------------------------------------

        function open() {
            cursorActive = false
            cursorIndex = 1
            panel.hidden = false
            button.setAttribute('aria-expanded', 'true')
            render()
            refreshDevices()
            applyMaster()
            startPeakMeter()
            deviceTimer = setInterval(refreshDevices, 5000)
            // Streams come and go with the media apps; keep the section
            // current, but never mid-drag.
            streamTimer = setInterval(() => { if (!dragging) render() }, 1500)
        }

        function close() {
            panel.hidden = true
            button.setAttribute('aria-expanded', 'false')
            clearInterval(deviceTimer)
            clearInterval(streamTimer)
            stopPeakMeter()
        }

        function toggle() {
            if (opened()) close()
            else open()
        }

        // ---- Wiring ---------------------------------------------------

        button.addEventListener('click', () => {
            button.blur()
            toggle()
        })
        button.addEventListener('contextmenu', event => {
            event.preventDefault()
            toggleAllMuted()
        })
        button.addEventListener('wheel', event => {
            event.preventDefault()
            setVolume(volume + (event.deltaY < 0 ? 0.05 : -0.05))
        }, { passive: false })

        heroSwitch.addEventListener('click', () => toggleAllMuted())

        wireSlider(outputSlider, ratio => setVolume(ratio))
        outputSliderRow.addEventListener('contextmenu', event => {
            event.preventDefault()
            toggleOutputMuted()
        })
        wireSlider(inputSlider, ratio => {
            inputVolume = AudioModel.snapVolume(ratio)
            Settings.set('audio.inputVolume', inputVolume)
            render()
        })
        inputSliderRow.addEventListener('contextmenu', event => {
            event.preventDefault()
            toggleInputMuted()
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
            else if (key === 'ArrowDown' || key === 'j') activateOr(() => moveCursor(1))
            else if (key === 'ArrowUp' || key === 'k') activateOr(() => moveCursor(-1))
            else if (key === 'ArrowRight' || key === 'l') activateOr(() => adjustCursor(1))
            else if (key === 'ArrowLeft' || key === 'h') activateOr(() => adjustCursor(-1))
            else if (key === 'm' || key === 'M') { if (cursorActive) muteCursor() }
            else if (key === 'Enter' || key === ' ') { if (cursorActive) activateCursor() }
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
                paintCursor()
                return
            }
            action()
        }

        document.addEventListener('omarchy:audio-toggle', () => toggle())

        applyMaster()
        render()
    }
}

BAR_WIDGETS['omarchy.audio'] = AudioBarWidget
