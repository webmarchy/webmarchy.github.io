/**
 * Media player app — stands in for mpv, Omarchy's default media player:
 * keyboard-driven and chromeless, one surface for both video and audio.
 * The window chrome is the app layer's (accent border, gap); everything
 * inside follows the active theme — the OSD strip, progress fill, and
 * the audio-only face are all `--color-*` consumers, so they restyle
 * live with theme switches like every other surface.
 *
 * One `<video>` element plays both kinds; a track with no video frames
 * (detected from `videoWidth` at loadedmetadata) gets a themed
 * music-note face with the track title instead of a black void.
 *
 * Opens empty: files arrive through the Open button (or `o`, or
 * dropping them onto the window), staying in memory as object URLs that
 * are revoked when the player closes. Another app can also launch it
 * straight onto tracks — `omarchy:app-launch` with
 * `{id: 'media-player', config: {tracks: [{src, label?}], index?}}` —
 * the same contract shape as the image viewer's.
 *
 * Keys, mpv-shaped: Space toggles play/pause, arrows seek ±5s and step
 * the volume, `m` mutes, `n`/`p` walk the playlist (wrapping), `[`/`]`
 * scale the speed by 0.9/1.1 with Backspace resetting it, `l` toggles
 * loop-one, `i` toggles the OSD, `o` opens files, `q` closes the window
 * (`Alt+W` still works, as everywhere). The mouse matches: click the
 * stage to play/pause, click the progress rail to seek. The OSD behaves
 * like mpv's: always up while paused, fading out after a still moment
 * during playback, back on pointer motion.
 * @extends {Component}
 */
class MediaPlayer extends Component {
    static template = `
        <section class="media-player" data-ref="player">
            <div class="media-player-stage" data-ref="stage">
                <video class="media-player-video" data-ref="video"
                       preload="metadata" playsinline></video>
                <div class="media-player-audio" hidden data-ref="audioFace">
                    <p class="media-player-audio-icon" data-ref="audioIcon"></p>
                    <p class="media-player-audio-title" data-ref="audioTitle"></p>
                </div>
            </div>
            <div class="media-player-empty" hidden data-ref="empty">
                <p class="media-player-empty-icon" data-ref="emptyIcon"></p>
                <p class="media-player-empty-text">No media open</p>
                <button type="button" class="media-player-open" data-ref="openButton">
                    Open media…</button>
                <p class="media-player-empty-hint">or drop files anywhere in this window</p>
            </div>
            <div class="media-player-osd" data-ref="osd">
                <div class="media-player-rail" data-ref="rail">
                    <div class="media-player-rail-fill" data-ref="fill"></div>
                </div>
                <div class="media-player-osd-row">
                    <button type="button" class="media-player-toggle" data-ref="toggle"
                            title="Play/pause (Space)" aria-label="Play/pause"></button>
                    <span class="media-player-name" data-ref="name"></span>
                    <span class="media-player-meta" data-ref="meta"></span>
                    <button type="button" class="media-player-osd-open" data-ref="overlayOpen"
                            title="Open media (O)" aria-label="Open media"></button>
                </div>
            </div>
            <input class="media-player-file" data-ref="file" type="file"
                   accept="video/*,audio/*" multiple hidden>
        </section>
    `

    /**
     * @param {Object} [config] - Launch config, for apps opening the
     *   player on something (the file explorer, eventually).
     * @param {{src: string, label?: string, file?: File}[]} [config.tracks]
     * @param {number} [config.index] - Which of them to play first.
     * @param {AppSession} [config.session]
     */
    constructor(config) {
        super()
        this.launchTracks = Array.isArray(config?.tracks) ? config.tracks : []
        this.launchIndex = Number.isInteger(config?.index) ? Number(config?.index) : 0
        this.session = config?.session ?? null
    }

    /** @param {DocumentFragment} root */
    script(root) {
        const player = $(root, '[data-ref="player"]')
        const stage = $(root, '[data-ref="stage"]')
        const video = /** @type {HTMLVideoElement} */ ($(root, '[data-ref="video"]'))
        const audioFace = $(root, '[data-ref="audioFace"]')
        const audioTitle = $(root, '[data-ref="audioTitle"]')
        const empty = $(root, '[data-ref="empty"]')
        const osd = $(root, '[data-ref="osd"]')
        const rail = $(root, '[data-ref="rail"]')
        const fill = /** @type {HTMLElement} */ ($(root, '[data-ref="fill"]'))
        const toggleButton = $(root, '[data-ref="toggle"]')
        const nameLabel = $(root, '[data-ref="name"]')
        const metaLabel = $(root, '[data-ref="meta"]')
        const fileInput = /** @type {HTMLInputElement} */ ($(root, '[data-ref="file"]'))
        const openButton = $(root, '[data-ref="openButton"]')
        const overlayOpen = $(root, '[data-ref="overlayOpen"]')

        $(root, '[data-ref="emptyIcon"]').textContent = '\u{f040b}'
        $(root, '[data-ref="audioIcon"]').textContent = '\u{f0387}'
        overlayOpen.textContent = '\u{f0770}'

        /** @param {string} src */
        const basename = src => decodeURIComponent(src.split('/').pop() || src)

        const session = this.session
        const saved = session && typeof session.state === 'object' && session.state !== null
            && Array.isArray(session.state.items) ? session.state : null
        let nextSlot = 0

        /** @type {{src: string, label: string, store: {slot?: number, src?: string} | null}[]} */
        let tracks = []
        let index = 0
        let loop = false
        let pendingTime = 0
        let lastSavedTime = 0
        /** @type {string[]} Object URLs owned by this instance. */
        const objectUrls = []
        /** @type {number} Pending OSD fade timer, 0 when none. */
        let hideTimer = 0

        /**
         * @param {{src: string, file?: File}} item
         * @returns {{slot?: number, src?: string} | null}
         */
        function adopt(item) {
            if (!session) return null
            if (item.file instanceof File) {
                const slot = nextSlot++
                session.putFile(String(slot), item.file)
                return { slot }
            }
            return item.src.startsWith('blob:') ? null : { src: item.src }
        }

        function persist() {
            if (!session) return
            session.save({
                items: tracks.filter(track => track.store)
                    .map(track => ({ ...track.store, label: track.label })),
                index, loop,
                time: video.currentTime || 0,
            })
        }

        function restore() {
            const items = /** @type {*[]} */ (saved.items)
            for (const item of items) {
                if (Number.isInteger(item?.slot)) nextSlot = Math.max(nextSlot, item.slot + 1)
            }
            Promise.all(items.map(async (/** @type {*} */ item) => {
                const label = typeof item?.label === 'string' ? item.label : ''
                if (typeof item?.src === 'string') {
                    return {
                        src: item.src,
                        label: label || basename(item.src),
                        store: { src: item.src },
                    }
                }
                if (!Number.isInteger(item?.slot) || !session) return null
                const blob = await session.getFile(String(item.slot))
                if (!blob) return null
                const url = URL.createObjectURL(blob)
                objectUrls.push(url)
                return { src: url, label, store: { slot: item.slot } }
            })).then(list => {
                if (!player.isConnected) {
                    for (const url of objectUrls) URL.revokeObjectURL(url)
                    objectUrls.length = 0
                    return
                }
                tracks = list.filter(item => item !== null)
                index = Math.max(0, Math.min(Number(saved.index) || 0, tracks.length - 1))
                loop = Boolean(saved.loop)
                video.loop = loop
                pendingTime = Number(saved.time) || 0
                if (tracks.length) video.src = tracks[index].src
                renderMeta()
            })
        }

        /** @param {number} seconds */
        function formatTime(seconds) {
            if (!Number.isFinite(seconds)) return '--:--'
            const total = Math.floor(seconds)
            const h = Math.floor(total / 3600)
            const m = Math.floor((total % 3600) / 60)
            const s = total % 60
            const ms = `${String(m).padStart(h ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`
            return h ? `${h}:${ms}` : ms
        }

        function renderMeta() {
            const hasTracks = tracks.length > 0
            empty.hidden = hasTracks
            osd.hidden = !hasTracks || osd.dataset.off === 'true'
            if (!hasTracks) return

            toggleButton.textContent = video.paused ? '\u{f040a}' : '\u{f03e4}'
            nameLabel.textContent = tracks[index].label

            const parts = [`[${index + 1}/${tracks.length}]`,
                `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`]
            if (video.playbackRate !== 1) parts.push(`${video.playbackRate.toFixed(2).replace(/0$/, '')}×`)
            if (loop) parts.push('\u{f0456}')
            parts.push(video.muted ? '\u{f0581}' : `\u{f057e} ${Math.round(video.volume * 100)}%`)
            metaLabel.textContent = parts.join('  ')

            const progress = video.duration ? video.currentTime / video.duration : 0
            fill.style.width = `${(progress * 100).toFixed(2)}%`
        }

        /** mpv's OSD: solid while paused, transient while playing. */
        function wakeOsd() {
            clearTimeout(hideTimer)
            player.classList.remove('media-player-idle')
            if (!video.paused) {
                hideTimer = setTimeout(() => {
                    if (!video.paused) player.classList.add('media-player-idle')
                }, 2500)
            }
        }

        /** @param {number} delta */
        function show(delta) {
            if (!tracks.length) return
            index = (index + delta + tracks.length) % tracks.length
            audioFace.hidden = true
            video.src = tracks[index].src
            video.play().catch(() => {})
            renderMeta()
            wakeOsd()
            persist()
        }

        function togglePlay() {
            if (!tracks.length) return
            if (video.paused) video.play().catch(() => {})
            else video.pause()
        }

        /** @param {number} seconds */
        function seekBy(seconds) {
            if (!video.duration) return
            video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds))
            renderMeta()
            wakeOsd()
        }

        /** @param {number} delta */
        function volumeBy(delta) {
            video.muted = false
            video.volume = Math.max(0, Math.min(1, video.volume + delta))
            renderMeta()
            wakeOsd()
        }

        /** @param {number} factor */
        function speedBy(factor) {
            video.playbackRate = Math.max(0.25, Math.min(4, video.playbackRate * factor))
            renderMeta()
            wakeOsd()
        }

        /** @param {FileList | null} files */
        function addFiles(files) {
            const added = [...(files || [])].filter(file =>
                file.type.startsWith('video/') || file.type.startsWith('audio/'))
            if (!added.length) return
            const first = tracks.length
            for (const file of added) {
                const url = URL.createObjectURL(file)
                objectUrls.push(url)
                tracks.push({ src: url, label: file.name, store: adopt({ src: url, file }) })
            }
            index = first - 1
            show(1)
        }

        /** Cleans up everything the closed player left on the document. */
        function disconnected() {
            if (player.isConnected) return false
            document.removeEventListener('keydown', onKey)
            document.removeEventListener('omarchy:session-flush', onFlush)
            clearTimeout(hideTimer)
            video.pause()
            video.removeAttribute('src')
            for (const url of objectUrls) URL.revokeObjectURL(url)
            objectUrls.length = 0
            return true
        }

        /** @param {KeyboardEvent} event */
        function onKey(event) {
            if (disconnected()) return
            if (!AppLibrary.focusedContains(player)) return
            // A shell surface that handled the key marks it; anything
            // fullscreen above the window layer owns the keyboard.
            if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return
            for (const selector of ['.menu', '.image-picker', '.keybindings',
                '.lock', '.screensaver', '.system-login']) {
                const el = /** @type {HTMLElement | null} */ (document.querySelector(selector))
                if (el && !el.hidden) return
            }

            const key = event.key
            if (key === ' ') togglePlay()
            else if (key === 'ArrowRight') seekBy(5)
            else if (key === 'ArrowLeft') seekBy(-5)
            else if (key === 'ArrowUp') volumeBy(0.05)
            else if (key === 'ArrowDown') volumeBy(-0.05)
            else if (key === 'm') { video.muted = !video.muted; renderMeta(); wakeOsd() }
            else if (key === 'n') show(1)
            else if (key === 'p') show(-1)
            else if (key === ']') speedBy(1.1)
            else if (key === '[') speedBy(1 / 1.1)
            else if (key === 'Backspace') { video.playbackRate = 1; renderMeta(); wakeOsd() }
            else if (key === 'l') { loop = !loop; video.loop = loop; renderMeta(); wakeOsd(); persist() }
            else if (key === 'i') {
                osd.dataset.off = osd.dataset.off === 'true' ? 'false' : 'true'
                renderMeta()
            }
            else if (key === 'o') fileInput.click()
            else if (key === 'q') document.dispatchEvent(new CustomEvent('omarchy:app-close'))
            else return
            event.preventDefault()
        }

        function onFlush() {
            if (disconnected()) return
            persist()
        }

        document.addEventListener('keydown', onKey)
        document.addEventListener('omarchy:session-flush', onFlush)

        // ---- Video element state drives the OSD.
        video.addEventListener('loadedmetadata', () => {
            // No video frames → an audio track: give it a themed face.
            audioFace.hidden = video.videoWidth !== 0
            audioTitle.textContent = tracks[index] ? tracks[index].label : ''
            if (pendingTime) {
                video.currentTime = Math.min(pendingTime, video.duration || pendingTime)
                pendingTime = 0
            }
            renderMeta()
        })
        video.addEventListener('timeupdate', () => {
            renderMeta()
            if (session && Math.abs(video.currentTime - lastSavedTime) > 5) {
                lastSavedTime = video.currentTime
                persist()
            }
        })
        video.addEventListener('play', () => { renderMeta(); wakeOsd() })
        video.addEventListener('pause', () => { renderMeta(); wakeOsd(); persist() })
        video.addEventListener('volumechange', renderMeta)
        video.addEventListener('ended', () => {
            if (!loop && tracks.length > 1) show(1)
            else renderMeta()
        })

        // ---- Mouse: stage click toggles, rail click seeks, motion
        //      wakes the OSD.
        stage.addEventListener('click', () => togglePlay())
        player.addEventListener('pointermove', () => { if (!disconnected()) wakeOsd() })
        rail.addEventListener('click', event => {
            event.stopPropagation()
            if (!video.duration) return
            const bounds = rail.getBoundingClientRect()
            video.currentTime = video.duration
                * Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))
            renderMeta()
        })
        toggleButton.addEventListener('click', event => {
            event.stopPropagation()
            togglePlay()
        })

        // ---- Opening media: drag-drop onto the window, or the picker.
        player.addEventListener('dragover', event => event.preventDefault())
        player.addEventListener('drop', event => {
            event.preventDefault()
            addFiles(event.dataTransfer ? event.dataTransfer.files : null)
        })
        fileInput.addEventListener('change', () => {
            addFiles(fileInput.files)
            fileInput.value = ''
        })
        openButton.addEventListener('click', () => fileInput.click())
        overlayOpen.addEventListener('click', event => {
            event.stopPropagation()
            fileInput.click()
        })

        if (saved) {
            restore()
        } else {
            tracks = this.launchTracks
                .filter(item => item && typeof item.src === 'string' && item.src !== '')
                .map(item => ({
                    src: item.src,
                    label: item.label || basename(item.src),
                    store: adopt(item),
                }))
            index = Math.max(0, Math.min(this.launchIndex, tracks.length - 1))
            if (tracks.length) {
                video.src = tracks[index].src
                video.play().catch(() => {})
                persist()
            }
        }
        renderMeta()
    }
}

AppLibrary.register('media-player', {
    name: 'Media Player',
    icon: '\u{f040b}',
    component: MediaPlayer,
})
