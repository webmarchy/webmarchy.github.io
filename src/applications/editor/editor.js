/**
 * Editor app — the text editor of the app shelf: a simple, chromeless
 * text editor with a line-number gutter and a slim statusline, no
 * toolbar, no menus. The window chrome is the app layer's (accent
 * border, gap); everything inside follows the active theme — gutter
 * numbers in the muted color with the cursor line in the accent,
 * accent caret, reverse-video statusline — so it restyles live with
 * theme switches like every other surface.
 *
 * The buffer is the proper HTML element for text editing — a
 * `<textarea>` (native undo history, IME, selection; wrap off with
 * horizontal scroll). Typing just types; Tab inserts a four-space
 * indent instead of moving focus.
 *
 * Opens straight into an editable untitled scratch buffer. Files
 * arrive through Ctrl/Cmd+O (or the statusline's open glyph, or
 * dropping one onto the window — guarded by a confirm when the buffer
 * has unsaved changes); Ctrl/Cmd+S saves, via the File System Access
 * picker where the browser has it and a plain download elsewhere.
 * Another app can also launch it straight onto content —
 * `omarchy:app-launch` with
 * `{id: 'editor', config: {name?, content?}}`.
 *
 * The statusline shows the filename with a `[+]` modified marker on
 * the left and the cursor's `line:column` on the right, live with the
 * cursor. The global `Alt+W` closes the window, as everywhere.
 * @extends {Component}
 */
class Editor extends Component {
    static template = `
        <section class="editor" data-ref="editor">
            <div class="editor-body">
                <div class="editor-gutter" aria-hidden="true">
                    <div class="editor-gutter-lines" data-ref="gutter"></div>
                </div>
                <textarea class="editor-buffer" data-ref="buffer" wrap="off"
                          spellcheck="false" autocomplete="off" autocapitalize="off"
                          aria-label="Buffer"></textarea>
            </div>
            <footer class="editor-statusline">
                <span class="editor-filename" data-ref="filename"></span>
                <span class="editor-position" data-ref="position"></span>
                <button type="button" class="editor-statusline-button" data-ref="open"
                        title="Open a file (Ctrl+O)" aria-label="Open a file"></button>
                <button type="button" class="editor-statusline-button" data-ref="save"
                        title="Save (Ctrl+S)" aria-label="Save"></button>
            </footer>
            <input class="editor-file" data-ref="file" type="file" hidden>
        </section>
    `

    /**
     * @param {Object} [config] - Launch config, for apps opening the
     *   editor on something (the file explorer, eventually).
     * @param {string} [config.name] - Buffer name to show and save as.
     * @param {string} [config.content] - Initial buffer content.
     * @param {AppSession} [config.session]
     */
    constructor(config) {
        super()
        this.launchName = typeof config?.name === 'string' ? config.name : ''
        this.launchContent = typeof config?.content === 'string' ? config.content : ''
        this.session = config?.session ?? null
    }

    /** @param {DocumentFragment} root */
    script(root) {
        const editor = $(root, '[data-ref="editor"]')
        const gutter = $(root, '[data-ref="gutter"]')
        const buffer = /** @type {HTMLTextAreaElement} */ ($(root, '[data-ref="buffer"]'))
        const filenameLabel = $(root, '[data-ref="filename"]')
        const positionLabel = $(root, '[data-ref="position"]')
        const openGlyph = $(root, '[data-ref="open"]')
        const saveGlyph = $(root, '[data-ref="save"]')
        const fileInput = /** @type {HTMLInputElement} */ ($(root, '[data-ref="file"]'))

        openGlyph.textContent = '\u{f0770}'
        saveGlyph.textContent = '\u{f0193}'

        const session = this.session
        const saved = session && typeof session.state === 'object' && session.state !== null
            ? session.state : null

        /** '' = an unnamed buffer — shown as Untitled. */
        let name = saved && typeof saved.name === 'string' ? saved.name : this.launchName
        let dirty = saved ? Boolean(saved.dirty) : false
        let lineCount = 0
        let bufferInBlob = Boolean(saved && saved.blob)
        let persistTimer = 0
        const PERSIST_INLINE_LIMIT = 200000

        buffer.value = saved && typeof saved.content === 'string'
            ? saved.content : this.launchContent

        function persistNow() {
            if (!session) return
            clearTimeout(persistTimer)
            persistTimer = 0
            const content = buffer.value
            const base = {
                name, dirty,
                caret: buffer.selectionStart,
                scroll: buffer.scrollTop,
            }
            if (content.length > PERSIST_INLINE_LIMIT) {
                bufferInBlob = true
                session.putFile('buffer', new Blob([content], { type: 'text/plain' }))
                session.save({ ...base, blob: true })
            } else {
                if (bufferInBlob) {
                    bufferInBlob = false
                    session.removeFile('buffer')
                }
                session.save({ ...base, content })
            }
        }

        function persistSoon() {
            if (!session || persistTimer) return
            persistTimer = setTimeout(persistNow, 300)
        }

        function restoreView() {
            const caret = Math.min(
                Number.isInteger(saved?.caret) && saved.caret >= 0 ? saved.caret : 0,
                buffer.value.length)
            buffer.setSelectionRange(caret, caret)
            buffer.scrollTop = Number(saved?.scroll) || 0
            renderStatus()
        }

        function renderStatus() {
            filenameLabel.textContent = `${name || 'Untitled'}${dirty ? ' [+]' : ''}`

            const before = buffer.value.slice(0, buffer.selectionStart).split('\n')
            const line = before.length
            const col = before[before.length - 1].length + 1
            positionLabel.textContent = `${line}:${col}`

            const rows = gutter.children
            for (let i = 0; i < rows.length; i++) {
                rows[i].classList.toggle('editor-gutter-current', i === line - 1)
            }
        }

        /** Rebuilds the gutter's line numbers when the count changes. */
        function renderGutter() {
            const count = buffer.value.split('\n').length
            if (count === lineCount) return
            lineCount = count
            gutter.textContent = ''
            for (let i = 1; i <= count; i++) {
                const row = document.createElement('span')
                row.className = 'editor-gutter-line'
                row.textContent = String(i)
                gutter.appendChild(row)
            }
        }

        /**
         * @param {string} nextName
         * @param {string} content
         */
        function openBuffer(nextName, content) {
            name = nextName
            buffer.value = content
            dirty = false
            buffer.setSelectionRange(0, 0)
            buffer.scrollTop = 0
            renderGutter()
            renderStatus()
            buffer.focus()
            persistNow()
        }

        /** @param {FileList | null} files */
        function openFiles(files) {
            const file = files && files[0]
            if (!file) return
            if (dirty && !confirm(`Discard unsaved changes to ${name || 'Untitled'}?`)) return
            file.text().then(text => openBuffer(file.name, text))
        }

        async function save() {
            const picker = /** @type {*} */ (window).showSaveFilePicker
            if (picker) {
                try {
                    const handle = await picker.call(window, { suggestedName: name || 'untitled.txt' })
                    const writable = await handle.createWritable()
                    await writable.write(buffer.value)
                    await writable.close()
                    name = handle.name
                } catch {
                    return // picker cancelled (or blocked) — buffer stays dirty
                }
            } else {
                const url = URL.createObjectURL(
                    new Blob([buffer.value], { type: 'text/plain' }))
                const link = document.createElement('a')
                link.href = url
                link.download = name || 'untitled.txt'
                link.click()
                URL.revokeObjectURL(url)
            }
            dirty = false
            renderStatus()
            persistNow()
        }

        /** Cleans up everything the closed editor left on the document. */
        function disconnected() {
            if (editor.isConnected) return false
            document.removeEventListener('keydown', onKey)
            document.removeEventListener('selectionchange', onSelect)
            document.removeEventListener('omarchy:session-flush', onFlush)
            clearTimeout(persistTimer)
            return true
        }

        function onFlush() {
            if (disconnected()) return
            if (persistTimer) persistNow()
        }

        function onSelect() {
            if (disconnected()) return
            if (document.activeElement === buffer) renderStatus()
        }

        /** @param {KeyboardEvent} event */
        function onKey(event) {
            if (disconnected()) return
            if (!AppLibrary.focusedContains(editor)) return
            if (event.defaultPrevented) return
            const mod = event.ctrlKey || event.metaKey
            if (mod && !event.altKey && !event.shiftKey && event.key === 'o') {
                event.preventDefault()
                fileInput.click()
            } else if (mod && !event.altKey && !event.shiftKey && event.key === 's') {
                event.preventDefault()
                save()
            } else if (!mod && !event.altKey && event.key.length === 1
                && document.activeElement !== buffer) {
                // Focus arrived via Alt+Arrow: a printable key grabs
                // the buffer so typing just works.
                buffer.focus()
            }
        }

        document.addEventListener('keydown', onKey)
        document.addEventListener('selectionchange', onSelect)
        document.addEventListener('omarchy:session-flush', onFlush)

        buffer.addEventListener('input', () => {
            dirty = true
            renderGutter()
            renderStatus()
            persistSoon()
        })
        buffer.addEventListener('scroll', () => {
            gutter.style.transform = `translateY(${-buffer.scrollTop}px)`
        })
        buffer.addEventListener('keydown', event => {
            if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
                event.preventDefault()
                document.execCommand('insertText', false, '    ')
            }
        })

        // ---- Opening files: drag-drop onto the window, or the picker.
        editor.addEventListener('dragover', event => event.preventDefault())
        editor.addEventListener('drop', event => {
            event.preventDefault()
            openFiles(event.dataTransfer ? event.dataTransfer.files : null)
        })
        fileInput.addEventListener('change', () => {
            openFiles(fileInput.files)
            fileInput.value = ''
        })
        openGlyph.addEventListener('click', () => fileInput.click())
        saveGlyph.addEventListener('click', () => save())

        renderGutter()
        renderStatus()
        if (saved) {
            if (typeof saved.content === 'string') {
                restoreView()
            } else if (saved.blob && session) {
                session.getFile('buffer').then(blob => {
                    if (!blob || !editor.isConnected) return
                    blob.text().then(text => {
                        if (!editor.isConnected) return
                        buffer.value = text
                        renderGutter()
                        restoreView()
                    })
                })
            }
        } else if (session && (this.launchName || this.launchContent)) {
            persistNow()
        }
        // The window layer mounts synchronously from the launch event,
        // so the buffer is in the document and focusable by now.
        buffer.focus()
    }
}

AppLibrary.register('editor', {
    name: 'Editor',
    icon: '\u{f03eb}',
    component: Editor,
})
