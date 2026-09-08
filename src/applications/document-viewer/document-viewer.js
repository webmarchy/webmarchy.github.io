/**
 * Document viewer app — the PDF reader of the app shelf, standing in
 * for Omarchy's default document viewer: keyboard-driven and
 * chromeless, just the pages on a themed ground with a small info
 * overlay, like the image viewer. The window chrome is the app
 * layer's (accent border, gap); the surrounding UI follows the active
 * theme — the pages themselves are drawn by the browser's built-in
 * PDF renderer, which is the one surface the theme can't reach.
 *
 * Rendering uses the proper HTML element for embedded documents:
 * `<object type="application/pdf">` with themed fallback content for
 * browsers that can't display PDFs inline. The built-in renderer's own
 * toolbar is hidden by default (Chromium's `#toolbar=0&navpanes=0`
 * open params — other engines ignore them harmlessly) to keep the
 * chromeless look; `t` toggles it for a page list, search, print. Note
 * the toggle re-sets `data`, which reloads the document at page 1.
 *
 * Opens empty: files arrive through the Open button (or `o`, or
 * dropping them onto the window), staying in memory as object URLs
 * that are revoked when the viewer closes. Another app can also launch
 * it straight onto documents — `omarchy:app-launch` with
 * `{id: 'document-viewer', config: {documents: [{src, label?}], index?}}`
 * — the same contract shape as the image viewer's.
 *
 * Keys: `n`/`p` walk the opened documents (wrapping), `t` toggles the
 * renderer's toolbar, `i` toggles the info overlay, `o` opens files,
 * `q` closes the window (`Alt+W` still works, as everywhere). Paging,
 * scrolling, and zoom inside a document belong to the built-in
 * renderer (wheel, PgUp/PgDn, Ctrl+wheel once it has focus).
 * @extends {Component}
 */
class DocumentViewer extends Component {
    static template = `
        <section class="document-viewer" data-ref="viewer">
            <object class="document-viewer-frame" data-ref="frame"
                    type="application/pdf" aria-label="Document">
                <div class="document-viewer-fallback">
                    <p class="document-viewer-fallback-icon">\u{f0219}</p>
                    <p class="document-viewer-fallback-text">This browser can't
                        display PDFs inline.</p>
                    <a class="document-viewer-fallback-link" data-ref="fallbackLink"
                       target="_blank" rel="noopener">Open in a new tab</a>
                </div>
            </object>
            <div class="document-viewer-empty" hidden data-ref="empty">
                <p class="document-viewer-empty-icon" data-ref="emptyIcon"></p>
                <p class="document-viewer-empty-text">No document open</p>
                <button type="button" class="document-viewer-open" data-ref="openButton">
                    Open documents…</button>
                <p class="document-viewer-empty-hint">or drop files anywhere in this window</p>
            </div>
            <div class="document-viewer-overlay" data-ref="overlay">
                <span class="document-viewer-name" data-ref="name"></span>
                <span class="document-viewer-meta" data-ref="meta"></span>
                <button type="button" class="document-viewer-overlay-open" data-ref="overlayOpen"
                        title="Open documents (O)" aria-label="Open documents"></button>
            </div>
            <input class="document-viewer-file" data-ref="file" type="file"
                   accept="application/pdf,.pdf" multiple hidden>
        </section>
    `

    /**
     * @param {Object} [config] - Launch config, for apps opening the
     *   viewer on something (the file explorer, eventually).
     * @param {{src: string, label?: string}[]} [config.documents]
     * @param {number} [config.index] - Which of them to show first.
     */
    constructor(config) {
        super()
        this.launchDocuments = Array.isArray(config?.documents) ? config.documents : []
        this.launchIndex = Number.isInteger(config?.index) ? Number(config?.index) : 0
    }

    /** @param {DocumentFragment} root */
    script(root) {
        const viewer = $(root, '[data-ref="viewer"]')
        const frame = /** @type {HTMLObjectElement} */ ($(root, '[data-ref="frame"]'))
        const fallbackLink = /** @type {HTMLAnchorElement} */ ($(root, '[data-ref="fallbackLink"]'))
        const empty = $(root, '[data-ref="empty"]')
        const overlay = $(root, '[data-ref="overlay"]')
        const nameLabel = $(root, '[data-ref="name"]')
        const metaLabel = $(root, '[data-ref="meta"]')
        const fileInput = /** @type {HTMLInputElement} */ ($(root, '[data-ref="file"]'))
        const openButton = $(root, '[data-ref="openButton"]')
        const overlayOpen = $(root, '[data-ref="overlayOpen"]')

        $(root, '[data-ref="emptyIcon"]').textContent = '\u{f0219}'
        overlayOpen.textContent = '\u{f0770}'

        /** @param {string} src */
        const basename = src => decodeURIComponent(src.split('/').pop() || src)

        /** @type {{src: string, label: string}[]} */
        let documents = this.launchDocuments
            .filter(item => item && typeof item.src === 'string' && item.src !== '')
            .map(item => ({ src: item.src, label: item.label || basename(item.src) }))
        let index = Math.max(0, Math.min(this.launchIndex, documents.length - 1))
        let toolbar = false
        /** @type {string[]} Object URLs owned by this instance. */
        const objectUrls = []

        function render() {
            const hasDocuments = documents.length > 0
            empty.hidden = hasDocuments
            frame.hidden = !hasDocuments
            overlay.hidden = !hasDocuments || overlay.dataset.off === 'true'
            if (!hasDocuments) return

            nameLabel.textContent = documents[index].label
            metaLabel.textContent = `[${index + 1}/${documents.length}]`
        }

        /** Points the renderer at the current document. */
        function load() {
            if (!documents.length) return
            // Chromium PDF open params; other engines ignore the hash.
            frame.data = documents[index].src
                + (toolbar ? '' : '#toolbar=0&navpanes=0')
            fallbackLink.href = documents[index].src
        }

        /** @param {number} delta */
        function show(delta) {
            if (!documents.length) return
            index = (index + delta + documents.length) % documents.length
            load()
            render()
        }

        /** @param {FileList | null} files */
        function addFiles(files) {
            const added = [...(files || [])].filter(file =>
                file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
            if (!added.length) return
            const first = documents.length
            for (const file of added) {
                const url = URL.createObjectURL(file)
                objectUrls.push(url)
                documents.push({ src: url, label: file.name })
            }
            index = first - 1
            show(1)
        }

        /** Cleans up everything the closed viewer left on the document. */
        function disconnected() {
            if (viewer.isConnected) return false
            document.removeEventListener('keydown', onKey)
            for (const url of objectUrls) URL.revokeObjectURL(url)
            objectUrls.length = 0
            return true
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
            if (key === 'n') show(1)
            else if (key === 'p') show(-1)
            else if (key === 't') {
                toolbar = !toolbar
                load()
            }
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

        // ---- Opening documents: drag-drop onto the window, or the picker.
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

        load()
        render()
    }
}

AppLibrary.register('document-viewer', {
    name: 'Document Viewer',
    icon: '\u{f0219}',
    component: DocumentViewer,
})
