/** @extends {Component} */
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
     * @param {Object} [config]
     * @param {{src: string, label?: string, file?: File}[]} [config.documents]
     * @param {number} [config.index]
     * @param {AppSession} [config.session]
     */
    constructor(config) {
        super()
        this.launchDocuments = Array.isArray(config?.documents) ? config.documents : []
        this.launchIndex = Number.isInteger(config?.index) ? Number(config?.index) : 0
        this.session = config?.session ?? null
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

        const session = this.session
        const saved = session && typeof session.state === 'object' && session.state !== null
            && Array.isArray(session.state.items) ? session.state : null
        let nextSlot = 0

        /** @type {{src: string, label: string, store: {slot?: number, src?: string} | null}[]} */
        let documents = []
        let index = 0
        let toolbar = false
        /** @type {string[]} */
        const objectUrls = []

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
                items: documents.filter(item => item.store)
                    .map(item => ({ ...item.store, label: item.label })),
                index, toolbar,
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
                if (!viewer.isConnected) {
                    for (const url of objectUrls) URL.revokeObjectURL(url)
                    objectUrls.length = 0
                    return
                }
                documents = list.filter(item => item !== null)
                index = Math.max(0, Math.min(Number(saved.index) || 0, documents.length - 1))
                toolbar = Boolean(saved.toolbar)
                load()
                render()
            })
        }

        function render() {
            const hasDocuments = documents.length > 0
            empty.hidden = hasDocuments
            frame.hidden = !hasDocuments
            overlay.hidden = !hasDocuments || overlay.dataset.off === 'true'
            if (!hasDocuments) return

            nameLabel.textContent = documents[index].label
            metaLabel.textContent = `[${index + 1}/${documents.length}]`
        }

        function load() {
            if (!documents.length) return
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
            persist()
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
                documents.push({ src: url, label: file.name, store: adopt({ src: url, file }) })
            }
            index = first - 1
            show(1)
        }

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
                persist()
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

        if (saved) {
            restore()
        } else {
            documents = this.launchDocuments
                .filter(item => item && typeof item.src === 'string' && item.src !== '')
                .map(item => ({
                    src: item.src,
                    label: item.label || basename(item.src),
                    store: adopt(item),
                }))
            index = Math.max(0, Math.min(this.launchIndex, documents.length - 1))
            if (documents.length) persist()
        }
        load()
        render()
    }
}

AppLibrary.register('document-viewer', {
    name: 'Document Viewer',
    icon: '\u{f0219}',
    component: DocumentViewer,
})
