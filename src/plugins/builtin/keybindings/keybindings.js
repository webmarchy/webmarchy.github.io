/**
 * Keybindings cheatsheet plugin — the analog of upstream's `Super+K`
 * hotkeys viewer (`omarchy-menu-keybindings`, manual Ch.7): a wide
 * top-anchored card listing bindings as a flat dmenu-style list —
 * UPPERCASE keys on the left, `→ label` at the midline, roomy
 * selectable rows — with type-to-filter. Rows whose binding maps to an
 * action event are runnable: `Enter` or a click dispatches it, like the
 * real sheet.
 *
 * Summoned by `Super+K` on Windows/Linux (`Alt+K` fallback, since a
 * real compositor usually grabs Super) or `Alt+K` on macOS — same
 * platform logic as the menu's summon, in a window capture-phase
 * listener — and by the `omarchy:keybindings` action event (the menu's
 * Learn → Keybindings entry). `Escape` clears the filter, then closes.
 *
 * BINDINGS is the single source of truth for what the sheet shows —
 * update it whenever a binding is added or changed anywhere.
 * @extends {Component}
 */
class Keybindings extends Component {
    static template = `
        <div class="keybindings" hidden data-ref="overlay"
             role="dialog" aria-modal="true" aria-label="Keybindings">
            <div class="keybindings-card">
                <div class="keybindings-header" data-ref="header"></div>
                <ul class="keybindings-list" data-ref="list" role="listbox"></ul>
            </div>
        </div>
    `

    /** @param {DocumentFragment} root */
    script(root) {
        const overlay = $(root, '[data-ref="overlay"]')
        const header = /** @type {HTMLElement} */ ($(root, '[data-ref="header"]'))
        const list = $(root, '[data-ref="list"]')

        const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
        const mod = isMac ? 'ALT' : 'SUPER'

        /** @type {{keys: string, label: string, action?: string}[]} */
        const BINDINGS = [
            { keys: `${mod} + K`, label: 'Keybindings', action: 'omarchy:keybindings' },
            { keys: `${mod} + SPACE`, label: 'Omarchy menu', action: 'omarchy:menu-toggle' },
            { keys: 'ALT + W / Q', label: 'Close the focused window', action: 'omarchy:app-close' },
            { keys: 'CTRL + ALT + DELETE', label: 'Close all windows' },
            { keys: 'ALT + 1-5', label: 'Switch workspace' },
            { keys: 'ALT + SHIFT + 1-5', label: 'Move window to workspace' },
            ...(isMac ? [] : [{ keys: 'SUPER + SHIFT + ALT + 1-5', label: 'Move window to workspace silently' }]),
            { keys: 'ALT + TAB', label: 'Next workspace' },
            { keys: 'ALT + SHIFT + TAB', label: 'Previous workspace' },
            { keys: 'ALT + CTRL + TAB', label: 'Former workspace' },
            { keys: 'ALT + SCROLL', label: 'Scroll through workspaces' },
            { keys: 'ALT + ARROWS', label: 'Focus window in direction' },
            { keys: 'ALT + SHIFT + ARROWS', label: 'Swap window in direction' },
            { keys: 'ALT + F', label: 'Fullscreen the focused window' },
            { keys: 'ALT + T', label: 'Float / tile the focused window' },
            { keys: 'ALT + J', label: 'Toggle window split direction' },
            { keys: 'ALT + O', label: "Toggle sticky'n'floating window" },
            { keys: 'ALT + S / ALT + GRAVE', label: 'Toggle scratchpad' },
            { keys: 'ALT + SHIFT + GRAVE', label: 'Move window to scratchpad' },
            { keys: 'ALT + MINUS / EQUAL', label: 'Expand / shrink window' },
            { keys: 'ALT + CTRL + MINUS / EQUAL', label: 'Resize in bigger steps' },
            ...(isMac ? [] : [{ keys: 'SUPER + ALT + MINUS / EQUAL', label: 'Resize in smaller steps' }]),
            { keys: 'ALT + BACKSPACE', label: 'Toggle window transparency' },
            { keys: 'ALT + SHIFT + BACKSPACE', label: 'Toggle window gaps' },
            { keys: 'ALT + LEFT MOUSE', label: 'Drag floating window' },
            { keys: 'ALT + RIGHT MOUSE', label: 'Resize floating window' },
            { keys: 'ALT + RIGHT MOUSE', label: 'Drag a gap to resize tiles' },
            { keys: 'ALT + RETURN', label: 'Launch the terminal', action: 'omarchy:app-launch terminal' },
            { keys: `${mod} + CTRL + E`, label: 'Emojis', action: 'omarchy:emojis-toggle' },
            { keys: `${mod} + CTRL + V`, label: 'Clipboard manager', action: 'omarchy:clipboard-toggle' },
            { keys: `${mod} + CTRL + R`, label: 'Set a reminder', action: 'omarchy:reminders-toggle' },
            // Show needs a real Super: with Alt standing in, the
            // upstream Super+Ctrl+Alt+R combination collapses onto Set.
            ...(isMac ? [] : [{ keys: 'SUPER + CTRL + ALT + R', label: 'Show reminders', action: 'omarchy:reminders-show' }]),
            { keys: `${mod} + SHIFT + CTRL + R`, label: 'Clear reminders', action: 'omarchy:reminders-clear' },
            { keys: `${mod} + ESCAPE`, label: 'System menu', action: 'omarchy:menu-toggle system' },
            ...(isMac ? [] : [{ keys: 'SUPER + ALT + SPACE', label: 'Apps menu', action: 'omarchy:menu-toggle apps' }]),
            { keys: `${mod} + CTRL + A`, label: 'Audio panel', action: 'omarchy:audio-toggle' },
            { keys: `${mod} + CTRL + B`, label: 'Bluetooth panel', action: 'omarchy:bluetooth-toggle' },
            { keys: `${mod} + CTRL + W`, label: 'Network panel', action: 'omarchy:network-toggle' },
            { keys: `${mod} + CTRL + D`, label: 'Display panel', action: 'omarchy:monitor-toggle' },
            { keys: `${mod} + CTRL + P`, label: 'Power panel', action: 'omarchy:power-toggle' },
            ...(isMac ? [] : [{ keys: 'SUPER + CTRL + ALT + D', label: 'Calendar panel', action: 'omarchy:clock-toggle' }]),
            { keys: `${mod} + CTRL + 1-9`, label: 'Toggle bar panel by position' },
            { keys: `${mod} + CTRL + L`, label: 'Lock computer', action: 'omarchy:lock' },
            { keys: `${mod} + CTRL + I`, label: 'Toggle locking on idle', action: 'omarchy:idle-toggle' },
            { keys: `${mod} + CTRL + N`, label: 'Toggle nightlight', action: 'omarchy:nightlight-toggle' },
            { keys: `${mod} + CTRL + O`, label: 'Toggle menu', action: 'omarchy:menu-toggle trigger.toggle' },
            { keys: `${mod} + SHIFT + SPACE`, label: 'Toggle the top bar', action: 'omarchy:bar-toggle' },
            { keys: `${mod} + CTRL + SHIFT + SPACE`, label: 'Pick a new theme', action: 'omarchy:theme-picker' },
            { keys: `${mod} + CTRL + SPACE`, label: 'Pick theme background', action: 'omarchy:background-picker' },
            { keys: `${mod} + /`, label: 'Step monitor scaling', action: 'omarchy:monitor-scale-step 1' },
            ...(isMac ? [] : [{ keys: 'SUPER + ALT + /', label: 'Step monitor scaling back', action: 'omarchy:monitor-scale-step -1' }]),
            { keys: `${mod} + CTRL + Q`, label: 'Calculator', action: 'omarchy:app-launch calculator' },
            { keys: `${mod} + SHIFT + F`, label: 'File manager', action: 'omarchy:app-launch file-manager' },
            { keys: `${mod} + SHIFT + N`, label: 'Editor', action: 'omarchy:app-launch editor' },
            { keys: `${mod} + SHIFT + M`, label: 'Music', action: 'omarchy:app-launch audio-player' },
            { keys: 'TYPE', label: 'Menu: search every entry' },
            { keys: 'UP / DOWN', label: 'Menu: move the selection' },
            { keys: 'ENTER / RIGHT', label: 'Menu: open submenu or run' },
            { keys: 'BACKSPACE / LEFT', label: 'Menu: back one level' },
            { keys: 'HOME / END', label: 'Menu: first / last entry' },
            { keys: 'ESCAPE', label: 'Menu: clear search, then close' },
            { keys: 'LEFT / RIGHT', label: 'Picker: select image' },
            { keys: 'ENTER', label: 'Picker: apply the selection' },
            { keys: 'ESCAPE', label: 'Picker: cancel' },
            { keys: 'LEFT / RIGHT or [ ]', label: 'Calendar: previous / next month' },
            { keys: 'UP / DOWN or { }', label: 'Calendar: previous / next year' },
            { keys: 'T / ENTER', label: 'Calendar: back to today' },
            { keys: 'W', label: 'Calendar: toggle week start' },
            { keys: 'ESCAPE', label: 'Calendar: close' },
            { keys: 'UP / DOWN or J / K', label: 'Display: switch section' },
            { keys: 'LEFT / RIGHT or H / L', label: 'Display: adjust size / pick scale' },
            { keys: 'ENTER', label: 'Display: apply the scale' },
            { keys: 'ESCAPE', label: 'Display: close' },
            { keys: 'N / P or LEFT / RIGHT', label: 'Viewer: previous / next image' },
            { keys: '+ / -', label: 'Viewer: zoom' },
            { keys: 'A / S', label: 'Viewer: actual size / fit' },
            { keys: 'R', label: 'Viewer: rotate' },
            { keys: 'I', label: 'Viewer: toggle the info overlay' },
            { keys: 'O', label: 'Viewer: open images' },
            { keys: 'Q', label: 'Viewer: close the window' },
            { keys: 'SPACE', label: 'Player: play / pause' },
            { keys: 'LEFT / RIGHT', label: 'Player: seek 5 seconds' },
            { keys: 'UP / DOWN', label: 'Player: volume' },
            { keys: 'M', label: 'Player: mute' },
            { keys: 'N / P', label: 'Player: next / previous track' },
            { keys: '[ / ]', label: 'Player: slower / faster, BACKSPACE resets' },
            { keys: 'L', label: 'Player: toggle loop' },
            { keys: 'I', label: 'Player: toggle the OSD' },
            { keys: 'O', label: 'Player: open media' },
            { keys: 'Q', label: 'Player: close the window' },
            { keys: 'J / K or UP / DOWN', label: 'Music: move the cursor' },
            { keys: 'ENTER', label: 'Music: play the cursor track' },
            { keys: 'SPACE', label: 'Music: play / pause' },
            { keys: 'N / P', label: 'Music: next / previous track' },
            { keys: 'LEFT / RIGHT', label: 'Music: seek 5 seconds' },
            { keys: '+ / -', label: 'Music: volume' },
            { keys: 'M', label: 'Music: mute' },
            { keys: 'S', label: 'Music: toggle shuffle' },
            { keys: 'R', label: 'Music: repeat off / all / one' },
            { keys: 'O', label: 'Music: open audio files' },
            { keys: 'Q', label: 'Music: close the window' },
            { keys: 'N / P', label: 'Docs: next / previous document' },
            { keys: 'T', label: "Docs: toggle the renderer's toolbar" },
            { keys: 'I', label: 'Docs: toggle the info overlay' },
            { keys: 'O', label: 'Docs: open documents' },
            { keys: 'Q', label: 'Docs: close the window' },
            { keys: 'I / A / O', label: 'Editor: enter insert mode' },
            { keys: 'ESCAPE', label: 'Editor: back to normal mode' },
            { keys: 'H J K L / W B / 0 $ / GG G', label: 'Editor: motions' },
            { keys: 'X / DD / YY / P', label: 'Editor: delete / yank / paste' },
            { keys: 'U / CTRL + R', label: 'Editor: undo / redo' },
            { keys: ': W / Q / WQ', label: 'Editor: write / quit' },
            { keys: 'CTRL / CMD + O', label: 'Editor: open a file' },
            { keys: 'CTRL / CMD + S', label: 'Editor: save the buffer' },
            { keys: 'TAB', label: 'Editor: insert an indent (insert mode)' },
            { keys: '0-9 . + - * / %', label: 'Calc: type the expression' },
            { keys: 'ENTER / =', label: 'Calc: evaluate' },
            { keys: 'BACKSPACE', label: 'Calc: delete back' },
            { keys: 'C / ESCAPE', label: 'Calc: clear' },
            { keys: 'S', label: 'Calc: toggle the sign' },
            { keys: 'CTRL / CMD + C', label: 'Calc: copy the result' },
            { keys: 'Q', label: 'Calc: close the window' },
            { keys: 'ARROWS', label: 'Files: move the selection' },
            { keys: 'ENTER', label: 'Files: open the selection' },
            { keys: 'U / BACKSPACE', label: 'Files: go up / back' },
            { keys: 'V', label: 'Files: grid / list view' },
            { keys: 'TYPE', label: 'Files: search the folder' },
            { keys: 'Q', label: 'Files: close the window' },
            { keys: 'ENTER', label: 'Terminal: run the line' },
            { keys: 'UP / DOWN', label: 'Terminal: walk the history' },
            { keys: 'CTRL + C', label: 'Terminal: abandon the line' },
            { keys: 'CTRL + L', label: 'Terminal: clear the screen' },
        ]

        let filter = ''
        let selectedIndex = 0

        function currentRows() {
            const query = filter.trim().toLowerCase()
            if (!query) return BINDINGS
            return BINDINGS.filter(row =>
                row.keys.toLowerCase().includes(query)
                || row.label.toLowerCase().includes(query))
        }

        /** @param {boolean} [scroll] */
        function updateSelection(scroll = false) {
            const rows = [...list.children]
            rows.forEach((li, index) => {
                li.classList.toggle('keybindings-row-selected', index === selectedIndex)
                li.setAttribute('aria-selected', String(index === selectedIndex))
            })
            if (scroll && rows[selectedIndex]) {
                rows[selectedIndex].scrollIntoView({ block: 'nearest' })
            }
        }

        function render() {
            const rows = currentRows()
            selectedIndex = Math.min(selectedIndex, Math.max(0, rows.length - 1))

            if (filter) {
                header.textContent = filter
                header.classList.remove('keybindings-header-placeholder')
            } else {
                header.textContent = 'Keybindings…'
                header.classList.add('keybindings-header-placeholder')
            }

            list.textContent = ''
            rows.forEach((row, index) => {
                const li = document.createElement('li')
                li.className = 'keybindings-row'
                li.setAttribute('role', 'option')

                const keysEl = document.createElement('span')
                keysEl.className = 'keybindings-keys'
                keysEl.textContent = row.keys

                const labelEl = document.createElement('span')
                labelEl.className = 'keybindings-label'
                const arrow = document.createElement('span')
                arrow.className = 'keybindings-arrow'
                arrow.textContent = '→ '
                labelEl.append(arrow, document.createTextNode(row.label))

                li.append(keysEl, labelEl)
                li.addEventListener('mousemove', () => {
                    if (selectedIndex !== index) {
                        selectedIndex = index
                        updateSelection()
                    }
                })
                li.addEventListener('click', () => activate(row))
                list.appendChild(li)
            })
            updateSelection(true)
        }

        /** @param {{action?: string}} row */
        function activate(row) {
            if (!row.action) return
            close()
            // Same action-string contract as the menu: event name, then
            // the remainder as detail.
            const spaceAt = row.action.indexOf(' ')
            const type = spaceAt === -1 ? row.action : row.action.slice(0, spaceAt)
            const detail = spaceAt === -1 ? '' : row.action.slice(spaceAt + 1)
            document.dispatchEvent(new CustomEvent(type, { detail }))
        }

        function open() {
            filter = ''
            selectedIndex = 0
            overlay.hidden = false
            render()
        }

        function close() {
            overlay.hidden = true
        }

        function toggle() {
            if (overlay.hidden) open()
            else close()
        }

        const card = $(root, '.keybindings-card')
        dismissOnOutsideClick(() => !overlay.hidden, close,
            target => card.contains(target))

        document.addEventListener('omarchy:keybindings', () => toggle())

        /** @param {KeyboardEvent} event */
        function isSummon(event) {
            return event.code === 'KeyK'
                && !event.ctrlKey && !event.shiftKey
                && (isMac
                    ? (event.altKey && !event.metaKey)
                    : (event.metaKey || event.altKey))
        }

        /** @param {string} selector */
        function modalOpen(selector) {
            const el = /** @type {HTMLElement | null} */ (document.querySelector(selector))
            return el !== null && !el.hidden
        }

        window.addEventListener('keydown', event => {
            if (!isSummon(event)) return
            event.preventDefault()
            event.stopImmediatePropagation()
            if (overlay.hidden && (modalOpen('.menu') || modalOpen('.image-picker')
                || modalOpen('.reminders') || modalOpen('.emojis') || modalOpen('.clipboard')
                || modalOpen('.lock') || modalOpen('.screensaver') || modalOpen('.system-login'))) return
            toggle()
        }, { capture: true })

        document.addEventListener('keydown', event => {
            if (overlay.hidden) return
            event.preventDefault()
            event.stopPropagation()
            const rows = currentRows()
            const rowHeight = list.firstElementChild
                ? /** @type {HTMLElement} */ (list.firstElementChild).offsetHeight + 3 : 53
            const pageStride = Math.max(1, Math.floor(list.clientHeight / rowHeight))

            if (event.key === 'Escape') {
                if (filter) { filter = ''; selectedIndex = 0; render() }
                else close()
            } else if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) {
                selectedIndex = (selectedIndex - 1 + rows.length) % Math.max(1, rows.length)
                updateSelection(true)
            } else if (event.key === 'ArrowDown' || event.key === 'Tab') {
                selectedIndex = (selectedIndex + 1) % Math.max(1, rows.length)
                updateSelection(true)
            } else if (event.key === 'Home') {
                selectedIndex = 0
                updateSelection(true)
            } else if (event.key === 'End') {
                selectedIndex = Math.max(0, rows.length - 1)
                updateSelection(true)
            } else if (event.key === 'PageUp') {
                selectedIndex = Math.max(0, selectedIndex - pageStride)
                updateSelection(true)
            } else if (event.key === 'PageDown') {
                selectedIndex = Math.min(Math.max(0, rows.length - 1), selectedIndex + pageStride)
                updateSelection(true)
            } else if (event.key === 'Enter') {
                if (rows[selectedIndex]) activate(rows[selectedIndex])
            } else if (event.key === 'Backspace') {
                filter = filter.slice(0, -1)
                selectedIndex = 0
                render()
            } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                filter += event.key
                selectedIndex = 0
                render()
            }
        })
    }
}
