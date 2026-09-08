/**
 * Emojis plugin — the emoji picker, mirroring upstream `omarchy.emojis`
 * (`shell/plugins/emojis/Emojis.qml`, kind `overlay`, `keepLoaded`): a
 * menu-styled card centered over a scrim — the search line on top, a
 * grid of emoji below, the shared catalog from upstream's emojis.json
 * (`emojis-data.js`; filtering ported in `emoji-search.js`).
 *
 * Interactions, matching upstream: typing filters by keyword (Backspace
 * edits, Escape clears the query first and dismisses second, scrim
 * click dismisses), Left/Right walk the grid wrapping around the ends,
 * Up/Down move by rows and PageUp/PageDown by visible pages (both
 * clamped), hover moves the cursor, Enter or a click picks. An empty
 * result shows upstream's hidden-face glyph and "No matches" line.
 *
 * Picking an emoji stands in for `omarchy-menu-emoji-insert` (wl-copy +
 * a synthetic paste keystroke, which a browser cannot send): the emoji
 * is copied to the clipboard — async Clipboard API first, the
 * execCommand fallback where that's unavailable — and the picker
 * dismisses.
 *
 * Summons, as upstream (`Super+Ctrl+E` → shell toggle omarchy.emojis,
 * with Alt standing in for Super as everywhere in this port), the
 * menu's Trigger → Emoji entry, and the `omarchy:emojis-toggle` action
 * event, which this plugin owns.
 * @extends {Component}
 */
class Emojis extends Component {
    static template = `
        <div class="emojis" hidden data-ref="overlay"
             role="dialog" aria-modal="true" aria-label="Emoji picker">
            <div class="emojis-card">
                <div class="emojis-header" data-ref="header" aria-hidden="true"></div>
                <div class="emojis-grid" data-ref="grid" role="listbox" aria-label="Emojis"></div>
                <div class="emojis-empty" hidden data-ref="empty">
                    <span class="emojis-empty-glyph" data-ref="emptyGlyph"></span>
                    <span class="emojis-empty-text" data-ref="emptyText"></span>
                </div>
            </div>
        </div>
    `

    /** @param {DocumentFragment} root */
    script(root) {
        const overlay = $(root, '[data-ref="overlay"]')
        const card = $(root, '.emojis-card')
        const header = $(root, '[data-ref="header"]')
        const grid = $(root, '[data-ref="grid"]')
        const empty = $(root, '[data-ref="empty"]')
        const emptyText = $(root, '[data-ref="emptyText"]')

        // Upstream's hidden-face glyph on the no-matches state (set from
        // an escape so the file survives any non-UTF-8 round trip).
        $(root, '[data-ref="emptyGlyph"]').textContent = '\u{F0209}'

        let filterText = ''
        let selectedIndex = 0
        let cursorActive = false
        /** @type {{e: string, k: string}[]} */
        let filtered = []

        const opened = () => !overlay.hidden

        /** The grid's column count, from the real layout — the analog
         * of upstream's floor(width / cellWidth), robust under the
         * SCALE zoom and TEXT SIZE reflow. */
        function columns() {
            const cell = /** @type {HTMLElement | null} */ (grid.firstElementChild)
            if (!cell || cell.offsetWidth === 0) return 1
            return Math.max(1, Math.floor(grid.clientWidth / cell.offsetWidth))
        }

        function visibleRows() {
            const cell = /** @type {HTMLElement | null} */ (grid.firstElementChild)
            if (!cell || cell.offsetHeight === 0) return 1
            return Math.max(1, Math.floor(grid.clientHeight / cell.offsetHeight))
        }

        function renderHeader() {
            if (filterText) {
                header.textContent = filterText
                header.classList.remove('emojis-header-placeholder')
            } else {
                header.textContent = 'Search emojis…'
                header.classList.add('emojis-header-placeholder')
            }
        }

        /** Repaints selection classes only — hover and arrow moves
         * shouldn't rebuild a thousand cells. */
        function updateSelection(scroll = false) {
            const cells = [...grid.children]
            cells.forEach((cell, index) => {
                cell.classList.toggle('emojis-cell-selected',
                    cursorActive && index === selectedIndex)
                cell.setAttribute('aria-selected', String(cursorActive && index === selectedIndex))
            })
            if (scroll && cells[selectedIndex]) {
                cells[selectedIndex].scrollIntoView({ block: 'nearest' })
            }
        }

        function rebuild() {
            filtered = EmojiSearch.filterEmojis(EMOJIS_DATA, filterText, 1000)
            if (filtered.length === 0) selectedIndex = 0
            else if (selectedIndex >= filtered.length) selectedIndex = filtered.length - 1
            else if (selectedIndex < 0) selectedIndex = 0
            cursorActive = filtered.length > 0

            renderHeader()
            empty.hidden = filtered.length > 0
            emptyText.textContent = `No matches for “${filterText}”`

            grid.textContent = ''
            filtered.forEach((item, index) => {
                const cell = document.createElement('button')
                cell.type = 'button'
                cell.className = 'emojis-cell'
                cell.setAttribute('role', 'option')
                cell.textContent = item.e
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
                    activateIndex(index)
                })
                grid.appendChild(cell)
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

        // ---- Cursor movement, upstream's three strides ----------------

        /** @param {number} delta */
        function select(delta) {
            if (filtered.length === 0) return
            if (!cursorActive) {
                cursorActive = true
                selectedIndex = delta < 0 ? filtered.length - 1 : 0
            } else {
                selectedIndex = (selectedIndex + delta + filtered.length) % filtered.length
            }
            updateSelection(true)
        }

        /** @param {number} rowDelta */
        function selectRow(rowDelta) {
            if (filtered.length === 0) return
            if (!cursorActive) {
                cursorActive = true
                selectedIndex = rowDelta < 0 ? filtered.length - 1 : 0
            } else {
                selectedIndex = Math.max(0, Math.min(filtered.length - 1,
                    selectedIndex + rowDelta * columns()))
            }
            updateSelection(true)
        }

        /** @param {number} pageDelta */
        function selectPage(pageDelta) {
            if (filtered.length === 0) return
            if (!cursorActive) {
                cursorActive = true
                selectedIndex = pageDelta < 0 ? filtered.length - 1 : 0
            } else {
                selectedIndex = Math.max(0, Math.min(filtered.length - 1,
                    selectedIndex + pageDelta * columns() * visibleRows()))
            }
            updateSelection(true)
        }

        // ---- Picking --------------------------------------------------

        /** @param {number} index */
        function activateIndex(index) {
            const item = filtered[index]
            if (!item) return
            dismiss()
            copyEmoji(item.e)
        }

        /**
         * The `omarchy-menu-emoji-insert` analog: the clipboard is the
         * half a browser can do (no synthetic paste keystroke exists).
         * @param {string} emoji
         */
        function copyEmoji(emoji) {
            const legacyCopy = () => {
                const holder = document.createElement('textarea')
                holder.value = emoji
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
                navigator.clipboard.writeText(emoji).catch(legacyCopy)
            } else legacyCopy()
            // Clipboard API calls fire no copy event; announce for the
            // clipboard manager's history, the way every wl-copy
            // reaches upstream's watcher.
            document.dispatchEvent(new CustomEvent('omarchy:clipboard-capture', { detail: emoji }))
        }

        // ---- Summon / dismiss -----------------------------------------

        function open() {
            filterText = ''
            selectedIndex = 0
            cursorActive = true
            overlay.hidden = false
            rebuild()
        }

        function dismiss() {
            overlay.hidden = true
        }

        function toggle() {
            if (opened()) dismiss()
            else open()
        }

        dismissOnOutsideClick(opened, dismiss, target => card.contains(target))

        // Capture phase so the picker's exclusive keyboard (upstream:
        // WlrKeyboardFocus.Exclusive) beats the menu's own document
        // handler when summoned over it.
        document.addEventListener('keydown', event => {
            if (!opened()) return
            event.preventDefault()
            event.stopPropagation()

            if (event.key === 'Escape') {
                if (filterText) setFilter('')
                else dismiss()
            } else if (event.key === 'Backspace') {
                if (filterText) setFilter(filterText.slice(0, -1))
            } else if (event.key === 'ArrowLeft') select(-1)
            else if (event.key === 'ArrowRight') select(1)
            else if (event.key === 'ArrowUp') selectRow(-1)
            else if (event.key === 'ArrowDown') selectRow(1)
            else if (event.key === 'PageUp') selectPage(-1)
            else if (event.key === 'PageDown') selectPage(1)
            else if (event.key === 'Enter') {
                if (cursorActive) activateIndex(selectedIndex)
                else if (filtered.length > 0) {
                    cursorActive = true
                    updateSelection()
                }
            } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                setFilter(filterText + event.key)
            }
        }, { capture: true })

        document.addEventListener('omarchy:emojis-toggle', () => toggle())

        // ---- Keybinding: Super+Ctrl+E, the Super stand-in as usual.
        const isMac = /Mac|iPhone|iPad/.test(navigator.platform)

        /** @param {KeyboardEvent} event */
        function isSummon(event) {
            return event.code === 'KeyE' && event.ctrlKey && !event.shiftKey
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
                '.clipboard', '.lock', '.screensaver', '.system-login'].some(selector => {
                const el = /** @type {HTMLElement | null} */ (document.querySelector(selector))
                return el !== null && !el.hidden
            })
            if (modalBlocking) return

            // Summoning over the open menu closes it, like the menu-run
            // action would.
            const menu = /** @type {HTMLElement | null} */ (document.querySelector('.menu'))
            if (menu && !menu.hidden && overlay.hidden) {
                document.dispatchEvent(new CustomEvent('omarchy:menu-toggle'))
            }
            toggle()
        }, { capture: true })
    }
}
