/**
 * Image viewer app — stands in for imv, Omarchy's default image viewer:
 * keyboard-driven and chromeless, just the picture on a themed ground
 * with a small info overlay. The window chrome is the app layer's
 * (accent border, gap); everything inside follows the active theme.
 *
 * Opens empty: the user's images arrive through the Open button (or
 * `o`, or dropping files onto the window), staying in memory as object
 * URLs that are revoked when the viewer closes. Another app can also
 * launch it straight onto images — `omarchy:app-launch` with
 * `{id: 'image-viewer', config: {images: [{src, label?}], index?}}` —
 * which is how the future file explorer will open one.
 *
 * Keys, imv-shaped: `n`/`p`, arrows, or Space walk the gallery
 * (wrapping); `+`/`-` zoom, `a` actual size, `s` back to fit, `r`
 * rotates, `i` toggles the info overlay, `o` opens files, `q` closes
 * the window (`Alt+W` still works, as everywhere). The mouse matches:
 * wheel zooms, dragging pans a zoomed image, double-click flips
 * between fit and actual size.
 * @extends {Component}
 */
class ImageViewer extends Component {
    static template = `
        <section class="image-viewer" data-ref="viewer">
            <div class="image-viewer-stage" data-ref="stage">
                <img class="image-viewer-image" data-ref="image" alt="" draggable="false">
            </div>
            <div class="image-viewer-empty" hidden data-ref="empty">
                <p class="image-viewer-empty-icon" data-ref="emptyIcon"></p>
                <p class="image-viewer-empty-text">No image open</p>
                <button type="button" class="image-viewer-open" data-ref="openButton">
                    Open images…</button>
                <p class="image-viewer-empty-hint">or drop files anywhere in this window</p>
            </div>
            <div class="image-viewer-overlay" data-ref="overlay">
                <span class="image-viewer-name" data-ref="name"></span>
                <span class="image-viewer-meta" data-ref="meta"></span>
                <button type="button" class="image-viewer-overlay-open" data-ref="overlayOpen"
                        title="Open images (O)" aria-label="Open images"></button>
            </div>
            <input class="image-viewer-file" data-ref="file" type="file"
                   accept="image/*" multiple hidden>
        </section>
    `

    /**
     * @param {Object} [config] - Launch config, for apps opening the
     *   viewer on something (the file explorer, eventually).
     * @param {{src: string, label?: string}[]} [config.images]
     * @param {number} [config.index] - Which of them to show first.
     */
    constructor(config) {
        super()
        this.launchImages = Array.isArray(config?.images) ? config.images : []
        this.launchIndex = Number.isInteger(config?.index) ? Number(config?.index) : 0
    }

    /** @param {DocumentFragment} root */
    script(root) {
        const viewer = $(root, '[data-ref="viewer"]')
        const stage = $(root, '[data-ref="stage"]')
        const image = /** @type {HTMLImageElement} */ ($(root, '[data-ref="image"]'))
        const empty = $(root, '[data-ref="empty"]')
        const overlay = $(root, '[data-ref="overlay"]')
        const nameLabel = $(root, '[data-ref="name"]')
        const metaLabel = $(root, '[data-ref="meta"]')
        const fileInput = /** @type {HTMLInputElement} */ ($(root, '[data-ref="file"]'))
        const openButton = $(root, '[data-ref="openButton"]')
        const overlayOpen = $(root, '[data-ref="overlayOpen"]')

        $(root, '[data-ref="emptyIcon"]').textContent = '\u{f02e9}'
        overlayOpen.textContent = '\u{f0770}'

        /** @param {string} src */
        const basename = src => decodeURIComponent(src.split('/').pop() || src)

        /** @type {{src: string, label: string}[]} */
        let images = this.launchImages
            .filter(item => item && typeof item.src === 'string' && item.src !== '')
            .map(item => ({ src: item.src, label: item.label || basename(item.src) }))
        let index = Math.max(0, Math.min(this.launchIndex, images.length - 1))
        /** 'fit' recomputes on every render; 'manual' holds `zoom`. */
        let mode = 'fit'
        let zoom = 1
        let rotation = 0
        let panX = 0
        let panY = 0
        /** @type {string[]} Object URLs owned by this instance. */
        const objectUrls = []

        // Rotated by a quarter turn, the image's box swaps sides.
        function fitScale() {
            const swapped = rotation % 180 !== 0
            const w = swapped ? image.naturalHeight : image.naturalWidth
            const h = swapped ? image.naturalWidth : image.naturalHeight
            if (!w || !h || !stage.clientWidth) return 1
            // imv's shrink mode: never upscale just to fill the window.
            return Math.min(stage.clientWidth / w, stage.clientHeight / h, 1)
        }

        function displayScale() {
            return mode === 'fit' ? fitScale() : zoom
        }

        function render() {
            const hasImages = images.length > 0
            empty.hidden = hasImages
            image.hidden = !hasImages
            overlay.hidden = !hasImages || overlay.dataset.off === 'true'
            if (!hasImages) return

            image.style.transform =
                `translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px))`
                + ` rotate(${rotation}deg) scale(${displayScale()})`
            viewer.classList.toggle('image-viewer-pannable', mode === 'manual')

            nameLabel.textContent = images[index].label
            const size = image.naturalWidth
                ? `${image.naturalWidth}×${image.naturalHeight}  ` : ''
            metaLabel.textContent =
                `[${index + 1}/${images.length}]  ${size}${Math.round(displayScale() * 100)}%`
        }

        /** @param {number} delta */
        function show(delta) {
            if (!images.length) return
            index = (index + delta + images.length) % images.length
            mode = 'fit'
            rotation = 0
            panX = 0
            panY = 0
            image.src = images[index].src
            render()
        }

        /** @param {number} factor */
        function zoomBy(factor) {
            zoom = Math.min(20, Math.max(0.05, displayScale() * factor))
            mode = 'manual'
            render()
        }

        function actualSize() {
            zoom = 1
            mode = 'manual'
            render()
        }

        function fit() {
            mode = 'fit'
            panX = 0
            panY = 0
            render()
        }

        function rotate() {
            rotation = (rotation + 90) % 360
            panX = 0
            panY = 0
            render()
        }

        /** @param {FileList | null} files */
        function addFiles(files) {
            const added = [...(files || [])].filter(file => file.type.startsWith('image/'))
            if (!added.length) return
            const first = images.length
            for (const file of added) {
                const url = URL.createObjectURL(file)
                objectUrls.push(url)
                images.push({ src: url, label: file.name })
            }
            index = first - 1
            show(1)
        }

        /** Cleans up everything the closed viewer left on the document. */
        function disconnected() {
            if (viewer.isConnected) return false
            document.removeEventListener('keydown', onKey)
            window.removeEventListener('resize', onResize)
            for (const url of objectUrls) URL.revokeObjectURL(url)
            objectUrls.length = 0
            return true
        }

        function onResize() {
            if (!disconnected()) render()
        }

        /** @param {KeyboardEvent} event */
        function onKey(event) {
            if (disconnected()) return
            if (!AppLibrary.focusedContains(viewer)) return
            // A shell surface that handled the key marks it; anything
            // fullscreen above the window layer owns the keyboard.
            if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return
            for (const selector of ['.menu', '.image-picker', '.keybindings',
                '.lock', '.screensaver', '.system-login']) {
                const el = /** @type {HTMLElement | null} */ (document.querySelector(selector))
                if (el && !el.hidden) return
            }

            const key = event.key
            if (key === 'ArrowRight' || key === 'n' || key === ' ') show(1)
            else if (key === 'ArrowLeft' || key === 'p') show(-1)
            else if (key === '+' || key === '=') zoomBy(1.25)
            else if (key === '-' || key === '_') zoomBy(1 / 1.25)
            else if (key === 'a') actualSize()
            else if (key === 's') fit()
            else if (key === 'r') rotate()
            else if (key === 'i') {
                overlay.dataset.off = overlay.dataset.off === 'true' ? 'false' : 'true'
                render()
            }
            else if (key === 'o') fileInput.click()
            else if (key === 'q') document.dispatchEvent(new CustomEvent('omarchy:app-close'))
            else return
            event.preventDefault()
        }

        document.addEventListener('keydown', onKey)
        window.addEventListener('resize', onResize)

        image.addEventListener('load', () => render())

        // ---- Mouse: wheel zooms, drag pans a zoomed image, and a
        //      double-click flips between fit and actual size.
        stage.addEventListener('wheel', event => {
            event.preventDefault()
            if (event.deltaY === 0) return
            zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1)
        }, { passive: false })

        stage.addEventListener('dblclick', () => {
            if (mode === 'fit') actualSize()
            else fit()
        })

        stage.addEventListener('pointerdown', event => {
            if (mode !== 'manual') return
            event.preventDefault()
            stage.setPointerCapture(event.pointerId)
            let lastX = event.clientX
            let lastY = event.clientY
            /** @param {PointerEvent} move */
            const onMove = move => {
                panX += move.clientX - lastX
                panY += move.clientY - lastY
                lastX = move.clientX
                lastY = move.clientY
                render()
            }
            const onUp = () => {
                stage.removeEventListener('pointermove', onMove)
                stage.removeEventListener('pointerup', onUp)
            }
            stage.addEventListener('pointermove', onMove)
            stage.addEventListener('pointerup', onUp)
        })

        // ---- Opening images: drag-drop onto the window, or the picker.
        viewer.addEventListener('dragover', event => event.preventDefault())
        viewer.addEventListener('drop', event => {
            event.preventDefault()
            addFiles(event.dataTransfer ? event.dataTransfer.files : null)
        })
        fileInput.addEventListener('change', () => {
            addFiles(fileInput.files)
            fileInput.value = ''
        })
        openButton.addEventListener('click', () => fileInput.click())
        overlayOpen.addEventListener('click', () => fileInput.click())

        if (images.length) {
            image.src = images[index].src
        }
        render()
    }
}

AppLibrary.register('image-viewer', {
    name: 'Image Viewer',
    icon: '\u{f02e9}',
    component: ImageViewer,
    // A quick-look float, like imv under a float rule; Alt+T tiles it.
    floating: true,
})
