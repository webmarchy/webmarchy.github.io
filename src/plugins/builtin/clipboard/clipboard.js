/**
 * Clipboard plugin — the clipboard history manager, mirroring upstream
 * `omarchy.clipboard` (`shell/plugins/clipboard/Clipboard.qml`, kind
 * `overlay`, `keepLoaded`): a wide menu-styled card centered over a
 * scrim — search line on top, the history list down the left half, a
 * full preview of the selected entry filling the right half past a
 * hairline.
 *
 * Capture is where a browser must differ, and the differences are
 * honest ones: upstream runs `wl-paste --watch` and sees every copy on
 * the seat; a page cannot observe the OS clipboard passively. What it
 * can see, it records — `copy` / `cut` on anything selected in the
 * shell, `paste` anywhere in it (the pasted payload IS the clipboard),
 * programmatic copies announced via the `omarchy:clipboard-capture`
 * event (detail: the copied text — the emoji picker and calculator
 * dispatch it), and, on open, a one-shot `navigator.clipboard.readText`
 * snapshot of the real OS clipboard (the analog of upstream's startup
 * capture; silently skipped if permission is refused). Text only —
 * image history would blow through localStorage, and no watcher exists
 * to feed it — though the model carries image entries faithfully.
 *
 * History persists newest-first, deduplicated, capped at 500 under its
 * own localStorage key (the analog of upstream's separate
 * `~/.local/state/omarchy/clipboard-history.json` state file — bulk
 * data stays out of the Settings blob), trimming oldest entries when
 * the quota objects.
 *
 * Interactions, matching upstream: typing filters (50-row display cap,
 * 8K per-row scan cap), Backspace edits, Escape clears the query first
 * and closes second, scrim click closes. Up/Down wrap through the
 * rows, PageUp/PageDown stride by 6, Home/End jump, hover moves the
 * cursor. Enter re-copies the entry to the OS clipboard and closes —
 * upstream also types it into the focused app, which a browser cannot;
 * Shift+Enter is upstream's copy-without-pasting, the same thing here.
 * Alt+Enter (upstream `omarchy-clipboard-open`) opens the entry in the
 * editor app. Delete removes the selected entry; Shift+Delete asks
 * "Delete entire clipboard history?" with Cancel preselected. Copied
 * file lists (file:// URI lines) show as "name" / "N files" rows,
 * dimmed, like upstream.
 *
 * Summons: `Super+Ctrl+V` (Alt standing in for Super, as everywhere in
 * this port — upstream's binding next to its Super+C/V/X universal
 * copy/paste, which need no analog here) and the
 * `omarchy:clipboard-toggle` action event, which this plugin owns.
 * (`ClipboardManager` because `Clipboard` is the DOM's own clipboard
 * interface, and the shared global scope must not shadow it.)
 * @extends {Component}
 */
class ClipboardManager extends Component {
    static template = `
        <div class="clipboard" hidden data-ref="overlay"
             role="dialog" aria-modal="true" aria-label="Clipboard history">
            <div class="clipboard-card">
                <div class="clipboard-header" data-ref="header" aria-hidden="true"></div>
                <div class="clipboard-body">
                    <div class="clipboard-list" data-ref="list"
                         role="listbox" aria-label="Clipboard entries"></div>
                    <div class="clipboard-pane" data-ref="pane">
                        <div class="clipboard-pane-text" data-ref="paneText"></div>
                        <img class="clipboard-pane-image" hidden data-ref="paneImage" alt="">
                    </div>
                    <div class="clipboard-empty" hidden data-ref="empty">
                        <span class="clipboard-empty-glyph" data-ref="emptyGlyph"></span>
                        <span class="clipboard-empty-text" data-ref="emptyText"></span>
                    </div>
                </div>
                <div class="clipboard-confirm" hidden data-ref="confirm">
                    <div class="clipboard-confirm-card">
                        <div class="clipboard-confirm-message">Delete entire clipboard history?</div>
                        <div class="clipboard-confirm-actions">
                            <button type="button" class="clipboard-confirm-button"
                                    data-ref="confirmDelete">Delete</button>
                            <button type="button" class="clipboard-confirm-button"
                                    data-ref="confirmCancel">Cancel</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `

    /** @param {DocumentFragment} root */
    script(root) {
        const overlay = $(root, '[data-ref="overlay"]')
        const card = $(root, '.clipboard-card')
        const header = $(root, '[data-ref="header"]')
        const list = $(root, '[data-ref="list"]')
        const paneText = $(root, '[data-ref="paneText"]')
        const paneImage = /** @type {HTMLImageElement} */ ($(root, '[data-ref="paneImage"]'))
        const empty = $(root, '[data-ref="empty"]')
        const emptyText = $(root, '[data-ref="emptyText"]')
        const confirm = $(root, '[data-ref="confirm"]')
        const confirmDelete = /** @type {HTMLButtonElement} */ ($(root, '[data-ref="confirmDelete"]'))
        const confirmCancel = /** @type {HTMLButtonElement} */ ($(root, '[data-ref="confirmCancel"]'))

        // Upstream's clipboard glyph on the empty state, as an escape so
        // the file survives any non-UTF-8 round trip.
        $(root, '[data-ref="emptyGlyph"]').textContent = '\u{F014C}'

        // The analog of upstream's separate clipboard-history.json state
        // file: bulk history stays out of the Settings blob, under its
        // own key.
        const STORAGE_KEY = 'omarchy-clipboard-history'
        const HISTORY_LIMIT = 500
        const PAGE_STRIDE = 6

        /** @type {any[]} */
        let history = loadStoredHistory()
        let filterText = ''
        let selectedIndex = 0
        let cursorActive = false
        let confirmOpen = false
        let confirmDeleteSelected = false
        /** @type {ReturnType<typeof ClipboardHistory.displayRows>} */
        let rows = []

        const opened = () => !overlay.hidden

        // ---- Storage --------------------------------------------------

        function loadStoredHistory() {
            try {
                return ClipboardHistory.parseHistory(localStorage.getItem(STORAGE_KEY))
            } catch {
                return []
            }
        }

        // Quota failures trim the oldest half away until the write fits —
        // a full localStorage otherwise silently stops recording, the
        // exact failure upstream's watcher-restart timer guards against.
        function saveHistory() {
            let keep = Math.min(history.length, HISTORY_LIMIT)
            for (; ;) {
                try {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, keep)))
                    return
                } catch {
                    if (keep === 0) return
                    keep = Math.floor(keep / 2)
                }
            }
        }

        // ---- Capture --------------------------------------------------

        /** @param {*} text */
        function captureText(text) {
            const entry = ClipboardHistory.normalizeEntry(String(text ?? ''))
            if (!entry) return
            history = ClipboardHistory.addEntry(history, entry, HISTORY_LIMIT)
            saveHistory()
            if (opened()) rebuild()
        }

        /** The selection a copy/cut just put on the clipboard. */
        function selectedText() {
            const active = document.activeElement
            if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
                const start = active.selectionStart ?? 0
                const end = active.selectionEnd ?? 0
                if (end > start) return active.value.slice(start, end)
            }
            return String(window.getSelection() || '')
        }

        document.addEventListener('copy', () => captureText(selectedText()))
        document.addEventListener('cut', () => captureText(selectedText()))
        document.addEventListener('paste', event => {
            captureText(event.clipboardData ? event.clipboardData.getData('text/plain') : '')
        })
        // Programmatic copies (clipboard API calls fire no copy event) —
        // the emoji picker and calculator announce theirs here, the way
        // every wl-copy reaches upstream's watcher.
        document.addEventListener('omarchy:clipboard-capture', event => {
            captureText(/** @type {CustomEvent} */(event).detail)
        })

        // ---- Actions --------------------------------------------------

        /** @param {string} text */
        function copyText(text) {
            const legacyCopy = () => {
                const holder = document.createElement('textarea')
                holder.value = text
                holder.style.position = 'fixed'
                holder.style.opacity = '0'
                document.body.appendChild(holder)
                holder.select()
                try {
                    document.execCommand('copy')
                } finally {
                    holder.remove()
                }
            }
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).catch(legacyCopy)
            } else legacyCopy()
        }

        /**
         * Enter and Shift+Enter both land here: upstream pastes into the
         * focused app after copying (Shift+Enter copies only) — a
         * browser can only do the copy half of either. Re-copying also
         * moves the entry back to the top, as the watcher would.
         * @param {number} index
         */
        function copyIndex(index) {
            const row = rows[index]
            if (!row) return
            const entry = ClipboardHistory.normalizeEntry(history[row.index])
            const text = ClipboardHistory.fullText(entry)
            if (!text) return
            close()
            copyText(text)
            captureText(text)
        }

        /**
         * Alt+Enter, upstream's `omarchy-clipboard-open`: the editor app
         * is where a copied text opens here.
         * @param {number} index
         */
        function openIndex(index) {
            const row = rows[index]
            if (!row) return
            const entry = ClipboardHistory.normalizeEntry(history[row.index])
            const text = ClipboardHistory.fullText(entry)
            if (!text) return
            close()
            AppLibrary.launch('editor', { name: 'clipboard.txt', content: text })
        }

        /** @param {number} index */
        function removeDisplayIndex(index) {
            const row = rows[index]
            if (!row) return
            history = ClipboardHistory.removeEntryAt(history, row.index)
            saveHistory()

            if (rows.length <= 1) {
                selectedIndex = 0
                cursorActive = false
            } else if (selectedIndex >= rows.length - 1) {
                selectedIndex = rows.length - 2
            }
            rebuild()
        }

        function requestClearHistory() {
            if (history.length === 0) return
            confirmDeleteSelected = false
            confirmOpen = true
            renderConfirm()
        }

        function cancelClearHistory() {
            confirmOpen = false
            renderConfirm()
        }

        function confirmClearHistory() {
            history = ClipboardHistory.clearHistory()
            saveHistory()
            selectedIndex = 0
            cursorActive = false
            confirmOpen = false
            renderConfirm()
            rebuild()
        }

        // ---- Rendering ------------------------------------------------

        function renderHeader() {
            if (filterText) {
                header.textContent = filterText
                header.classList.remove('clipboard-header-placeholder')
            } else {
                header.textContent = 'Search clipboard…'
                header.classList.add('clipboard-header-placeholder')
            }
        }

        function renderConfirm() {
            confirm.hidden = !confirmOpen
            confirmDelete.classList.toggle('clipboard-confirm-selected', confirmDeleteSelected)
            confirmCancel.classList.toggle('clipboard-confirm-selected', !confirmDeleteSelected)
        }

        function renderPane() {
            const row = cursorActive ? rows[selectedIndex] : rows[0]
            const active = rows.length > 0 ? (row || rows[0]) : null
            if (active && active.previewImage) {
                paneText.textContent = ''
                paneImage.src = active.previewImage
                paneImage.hidden = false
            } else {
                paneImage.hidden = true
                paneImage.removeAttribute('src')
                paneText.textContent = active ? active.fullText : ''
            }
        }

        /** @param {boolean} [scroll] */
        function updateSelection(scroll = false) {
            const cells = [...list.children]
            cells.forEach((cell, index) => {
                cell.classList.toggle('clipboard-row-selected',
                    cursorActive && index === selectedIndex)
                cell.setAttribute('aria-selected', String(cursorActive && index === selectedIndex))
            })
            if (scroll && cells[selectedIndex]) {
                cells[selectedIndex].scrollIntoView({ block: 'nearest' })
            }
            renderPane()
        }

        function rebuild() {
            rows = ClipboardHistory.displayRows(history, filterText, 50)
            if (rows.length === 0) selectedIndex = 0
            else if (selectedIndex >= rows.length) selectedIndex = rows.length - 1
            else if (selectedIndex < 0) selectedIndex = 0

            renderHeader()
            empty.hidden = rows.length > 0
            emptyText.textContent = history.length === 0
                ? 'Clipboard is empty'
                : `No matches for “${filterText}”`

            list.textContent = ''
            rows.forEach((row, index) => {
                const cell = document.createElement('button')
                cell.type = 'button'
                cell.className = 'clipboard-row'
                cell.setAttribute('role', 'option')
                if (row.previewImage) {
                    const thumb = document.createElement('img')
                    thumb.className = 'clipboard-row-thumb'
                    thumb.src = row.previewImage
                    thumb.alt = ''
                    cell.appendChild(thumb)
                }
                const label = document.createElement('span')
                label.className = 'clipboard-row-text'
                // Image and file rows read as descriptions, dimmed like
                // upstream (0.72).
                if (row.entryType !== 'text') label.classList.add('clipboard-row-text-muted')
                label.textContent = row.previewText
                cell.appendChild(label)

                cell.addEventListener('mousemove', () => {
                    if (!cursorActive || selectedIndex !== index) {
                        cursorActive = true
                        selectedIndex = index
                        updateSelection()
                    }
                })
                cell.addEventListener('click', () => {
                    cursorActive = true
                    selectedIndex = index
                    copyIndex(index)
                })
                list.appendChild(cell)
            })
            updateSelection(true)
        }

        /** @param {string} nextFilter */
        function setFilter(nextFilter) {
            filterText = nextFilter
            selectedIndex = 0
            cursorActive = true
            rebuild()
        }

        /** @param {number} delta */
        function select(delta) {
            if (rows.length === 0) return
            if (!cursorActive) {
                cursorActive = true
                selectedIndex = delta < 0 ? rows.length - 1 : 0
            } else {
                selectedIndex = (selectedIndex + delta + rows.length) % rows.length
            }
            updateSelection(true)
        }

        /** @param {number} index */
        function selectAbsolute(index) {
            if (rows.length === 0) return
            cursorActive = true
            selectedIndex = Math.max(0, Math.min(index, rows.length - 1))
            updateSelection(true)
        }

        // ---- Summon / dismiss -----------------------------------------

        function open() {
            filterText = ''
            selectedIndex = 0
            cursorActive = true
            overlay.hidden = false
            rebuild()
            // The one OS-clipboard read a browser allows: snapshot the
            // current selection into history, like upstream's startup
            // capture. Refused permission just means no snapshot.
            if (navigator.clipboard && navigator.clipboard.readText) {
                navigator.clipboard.readText().then(captureText).catch(() => { })
            }
        }

        function close() {
            cancelClearHistory()
            overlay.hidden = true
        }

        function toggle() {
            if (opened()) close()
            else open()
        }

        dismissOnOutsideClick(opened, close, target => card.contains(target))

        confirmDelete.addEventListener('click', () => confirmClearHistory())
        confirmCancel.addEventListener('click', () => cancelClearHistory())

        // Capture phase so the manager's exclusive keyboard (upstream:
        // WlrKeyboardFocus.Exclusive) beats the menu's own document
        // handler when summoned over it.
        document.addEventListener('keydown', event => {
            if (!opened()) return
            event.preventDefault()
            event.stopPropagation()

            if (confirmOpen) {
                if (event.key === 'Escape') cancelClearHistory()
                else if (event.key === 'Enter') {
                    if (confirmDeleteSelected) confirmClearHistory()
                    else cancelClearHistory()
                } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight'
                    || event.key === 'Tab') {
                    confirmDeleteSelected = !confirmDeleteSelected
                    renderConfirm()
                }
                return
            }

            if (event.key === 'Escape') {
                if (filterText) setFilter('')
                else close()
            } else if (event.key === 'Backspace') {
                if (filterText) setFilter(filterText.slice(0, -1))
            } else if (event.key === 'Delete') {
                if (event.shiftKey) requestClearHistory()
                else removeDisplayIndex(selectedIndex)
            } else if (event.key === 'ArrowUp') select(-1)
            else if (event.key === 'ArrowDown') select(1)
            else if (event.key === 'PageUp') select(-PAGE_STRIDE)
            else if (event.key === 'PageDown') select(PAGE_STRIDE)
            else if (event.key === 'Home') selectAbsolute(0)
            else if (event.key === 'End') selectAbsolute(rows.length - 1)
            else if (event.key === 'Enter') {
                if (cursorActive && event.altKey) openIndex(selectedIndex)
                else if (cursorActive) copyIndex(selectedIndex)
                else if (rows.length > 0) {
                    cursorActive = true
                    updateSelection()
                }
            } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                setFilter(filterText + event.key)
            }
        }, { capture: true })

        document.addEventListener('omarchy:clipboard-toggle', () => toggle())

        // ---- Keybinding: Super+Ctrl+V, the Super stand-in as usual.
        const isMac = /Mac|iPhone|iPad/.test(navigator.platform)

        /** @param {KeyboardEvent} event */
        function isSummon(event) {
            return event.code === 'KeyV' && event.ctrlKey && !event.shiftKey
                && (isMac
                    ? (event.altKey && !event.metaKey)
                    : (event.metaKey || event.altKey))
        }

        window.addEventListener('keydown', event => {
            if (!isSummon(event)) return
            event.preventDefault()
            event.stopImmediatePropagation()

            // A fullscreen surface above owns the keyboard (same guard
            // as the menu's summon).
            const modalBlocking = ['.image-picker', '.keybindings', '.reminders',
                '.emojis', '.lock', '.screensaver', '.system-login'].some(selector => {
                const el = /** @type {HTMLElement | null} */ (document.querySelector(selector))
                return el !== null && !el.hidden
            })
            if (modalBlocking) return

            // Summoning over the open menu closes it, like a menu-run
            // action would.
            const menu = /** @type {HTMLElement | null} */ (document.querySelector('.menu'))
            if (menu && !menu.hidden && overlay.hidden) {
                document.dispatchEvent(new CustomEvent('omarchy:menu-toggle'))
            }
            toggle()
        }, { capture: true })
    }
}
