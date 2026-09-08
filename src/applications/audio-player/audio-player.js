/** @extends {Component} */
class AudioPlayer extends Component {
    static template = `
        <section class="audio-player" data-ref="player">
            <ul class="audio-player-list" data-ref="list" role="listbox"
                aria-label="Tracks"></ul>
            <div class="audio-player-empty" hidden data-ref="empty">
                <p class="audio-player-empty-icon" data-ref="emptyIcon"></p>
                <p class="audio-player-empty-text">No tracks queued</p>
                <button type="button" class="audio-player-open" data-ref="openButton">
                    Open audio…</button>
                <p class="audio-player-empty-hint">or drop files anywhere in this window</p>
            </div>
            <footer class="audio-player-status" data-ref="status">
                <div class="audio-player-rail" data-ref="rail">
                    <div class="audio-player-rail-fill" data-ref="fill"></div>
                </div>
                <div class="audio-player-status-row">
                    <button type="button" class="audio-player-toggle" data-ref="toggle"
                            title="Play/pause (Space)" aria-label="Play/pause"></button>
                    <span class="audio-player-name" data-ref="name"></span>
                    <span class="audio-player-meta" data-ref="meta"></span>
                    <button type="button" class="audio-player-status-open" data-ref="overlayOpen"
                            title="Open audio (O)" aria-label="Open audio"></button>
                </div>
            </footer>
            <audio data-ref="audio" preload="metadata"></audio>
            <input class="audio-player-file" data-ref="file" type="file"
                   accept="audio/*" multiple hidden>
        </section>
    `

    /**
     * @param {Object} [config]
     * @param {{src: string, label?: string}[]} [config.tracks]
     * @param {number} [config.index]
     */
    constructor(config) {
        super()
        this.launchTracks = Array.isArray(config?.tracks) ? config.tracks : []
        this.launchIndex = Number.isInteger(config?.index) ? Number(config?.index) : 0
    }

    /** @param {DocumentFragment} root */
    script(root) {
        const player = $(root, '[data-ref="player"]')
        const list = $(root, '[data-ref="list"]')
        const empty = $(root, '[data-ref="empty"]')
        const rail = $(root, '[data-ref="rail"]')
        const fill = /** @type {HTMLElement} */ ($(root, '[data-ref="fill"]'))
        const toggleButton = $(root, '[data-ref="toggle"]')
        const nameLabel = $(root, '[data-ref="name"]')
        const metaLabel = $(root, '[data-ref="meta"]')
        const audio = /** @type {HTMLAudioElement} */ ($(root, '[data-ref="audio"]'))
        const fileInput = /** @type {HTMLInputElement} */ ($(root, '[data-ref="file"]'))
        const openButton = $(root, '[data-ref="openButton"]')
        const overlayOpen = $(root, '[data-ref="overlayOpen"]')

        $(root, '[data-ref="emptyIcon"]').textContent = '\u{f075a}'
        overlayOpen.textContent = '\u{f0770}'

        /** @param {string} src */
        const basename = src => decodeURIComponent(src.split('/').pop() || src)

        /** @type {{src: string, label: string, duration: number}[]} */
        let tracks = this.launchTracks
            .filter(item => item && typeof item.src === 'string' && item.src !== '')
            .map(item => ({ src: item.src, label: item.label || basename(item.src), duration: NaN }))
        let playing = tracks.length ? Math.max(0, Math.min(this.launchIndex, tracks.length - 1)) : -1
        let cursor = Math.max(0, playing)
        let shuffle = false
        /** @type {'off' | 'all' | 'one'} */
        let repeat = 'off'
        /** @type {string[]} */
        const objectUrls = []

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

        /** @param {{src: string, duration: number}} track */
        function probeDuration(track) {
            const probe = new Audio()
            probe.preload = 'metadata'
            probe.addEventListener('loadedmetadata', () => {
                track.duration = probe.duration
                probe.removeAttribute('src')
                renderList()
            })
            probe.src = track.src
        }

        function renderList() {
            const hasTracks = tracks.length > 0
            empty.hidden = hasTracks
            list.textContent = ''
            tracks.forEach((track, index) => {
                const li = document.createElement('li')
                li.className = 'audio-player-row'
                li.setAttribute('role', 'option')
                li.setAttribute('aria-selected', String(index === cursor))
                li.classList.toggle('audio-player-row-cursor', index === cursor)
                li.classList.toggle('audio-player-row-playing', index === playing)

                const num = document.createElement('span')
                num.className = 'audio-player-row-num'
                num.textContent = index === playing
                    ? (audio.paused ? '\u{f03e4}' : '\u{f040a}')
                    : String(index + 1).padStart(2, '0')

                const title = document.createElement('span')
                title.className = 'audio-player-row-title'
                title.textContent = track.label

                const time = document.createElement('span')
                time.className = 'audio-player-row-time'
                time.textContent = formatTime(track.duration)

                li.append(num, title, time)
                li.addEventListener('click', () => {
                    cursor = index
                    renderList()
                })
                li.addEventListener('dblclick', () => play(index))
                list.appendChild(li)
            })
            const cursorRow = list.children[cursor]
            if (cursorRow) cursorRow.scrollIntoView({ block: 'nearest' })
        }

        function renderStatus() {
            toggleButton.textContent = playing >= 0 && !audio.paused ? '\u{f03e4}' : '\u{f040a}'
            nameLabel.textContent = playing >= 0 ? tracks[playing].label : ''

            const parts = []
            if (playing >= 0) {
                parts.push(`[${playing + 1}/${tracks.length}]`,
                    `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`)
            } else if (tracks.length) {
                parts.push(`[${tracks.length} queued]`)
            }
            if (shuffle) parts.push('\u{f049d}')
            if (repeat !== 'off') parts.push(repeat === 'one' ? '\u{f0458}' : '\u{f0456}')
            parts.push(audio.muted ? '\u{f0581}' : `\u{f057e} ${Math.round(audio.volume * 100)}%`)
            metaLabel.textContent = parts.join('  ')

            const progress = audio.duration ? audio.currentTime / audio.duration : 0
            fill.style.width = `${(progress * 100).toFixed(2)}%`
        }

        /** @param {number} index */
        function play(index) {
            if (!tracks.length) return
            playing = (index + tracks.length) % tracks.length
            cursor = playing
            audio.src = tracks[playing].src
            audio.play().catch(() => {})
            renderList()
            renderStatus()
        }

        function togglePlay() {
            if (playing < 0) { play(cursor); return }
            if (audio.paused) audio.play().catch(() => {})
            else audio.pause()
        }

        function nextIndex() {
            if (shuffle && tracks.length > 1) {
                let pick = playing
                while (pick === playing) pick = Math.floor(Math.random() * tracks.length)
                return pick
            }
            return playing + 1
        }

        /** @param {number} delta */
        function step(delta) {
            if (playing < 0) { play(cursor); return }
            play(delta > 0 ? nextIndex() : playing - 1)
        }

        /** @param {number} seconds */
        function seekBy(seconds) {
            if (!audio.duration) return
            audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + seconds))
            renderStatus()
        }

        /** @param {number} delta */
        function volumeBy(delta) {
            audio.muted = false
            audio.volume = Math.max(0, Math.min(1, audio.volume + delta))
        }

        /** @param {number} delta */
        function moveCursor(delta) {
            if (!tracks.length) return
            cursor = Math.max(0, Math.min(tracks.length - 1, cursor + delta))
            renderList()
        }

        /** @param {FileList | null} files */
        function addFiles(files) {
            const added = [...(files || [])].filter(file => file.type.startsWith('audio/'))
            if (!added.length) return
            const first = tracks.length
            for (const file of added) {
                const url = URL.createObjectURL(file)
                objectUrls.push(url)
                const track = { src: url, label: file.name, duration: NaN }
                tracks.push(track)
                probeDuration(track)
            }
            if (playing < 0) play(first)
            else { renderList(); renderStatus() }
        }

        function disconnected() {
            if (player.isConnected) return false
            document.removeEventListener('keydown', onKey)
            audio.pause()
            audio.removeAttribute('src')
            for (const url of objectUrls) URL.revokeObjectURL(url)
            objectUrls.length = 0
            return true
        }

        /** @param {KeyboardEvent} event */
        function onKey(event) {
            if (disconnected()) return
            if (!AppLibrary.focusedContains(player)) return
            if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return
            for (const selector of ['.menu', '.image-picker', '.keybindings',
                '.lock', '.screensaver', '.system-login']) {
                const el = /** @type {HTMLElement | null} */ (document.querySelector(selector))
                if (el && !el.hidden) return
            }

            const key = event.key
            if (key === 'ArrowDown' || key === 'j') moveCursor(1)
            else if (key === 'ArrowUp' || key === 'k') moveCursor(-1)
            else if (key === 'Enter') play(cursor)
            else if (key === ' ') togglePlay()
            else if (key === 'n') step(1)
            else if (key === 'p') step(-1)
            else if (key === 'ArrowRight') seekBy(5)
            else if (key === 'ArrowLeft') seekBy(-5)
            else if (key === '+' || key === '=') volumeBy(0.05)
            else if (key === '-' || key === '_') volumeBy(-0.05)
            else if (key === 'm') audio.muted = !audio.muted
            else if (key === 's') { shuffle = !shuffle; renderStatus() }
            else if (key === 'r') {
                repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off'
                renderStatus()
            }
            else if (key === 'o') fileInput.click()
            else if (key === 'q') document.dispatchEvent(new CustomEvent('omarchy:app-close'))
            else return
            event.preventDefault()
        }

        document.addEventListener('keydown', onKey)

        audio.addEventListener('timeupdate', renderStatus)
        audio.addEventListener('loadedmetadata', () => {
            if (playing >= 0 && !Number.isFinite(tracks[playing].duration)) {
                tracks[playing].duration = audio.duration
                renderList()
            }
            renderStatus()
        })
        audio.addEventListener('play', () => { renderList(); renderStatus() })
        audio.addEventListener('pause', () => { renderList(); renderStatus() })
        audio.addEventListener('volumechange', renderStatus)
        audio.addEventListener('ended', () => {
            if (repeat === 'one') { play(playing); return }
            const next = nextIndex()
            if (next < tracks.length || repeat === 'all') play(next)
            else renderStatus()
        })

        rail.addEventListener('click', event => {
            if (!audio.duration) return
            const bounds = rail.getBoundingClientRect()
            audio.currentTime = audio.duration
                * Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))
            renderStatus()
        })
        toggleButton.addEventListener('click', () => togglePlay())

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
        overlayOpen.addEventListener('click', () => fileInput.click())

        if (playing >= 0) {
            for (const track of tracks) probeDuration(track)
            audio.src = tracks[playing].src
            audio.play().catch(() => {})
        }
        renderList()
        renderStatus()
    }
}

AppLibrary.register('audio-player', {
    name: 'Music',
    icon: '\u{f075a}',
    component: AudioPlayer,
})
