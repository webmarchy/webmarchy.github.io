/**
 * File manager app — GNOME Files (Nautilus), Omarchy's default file
 * manager, reimplemented with web tech: places sidebar over a
 * back/forward + breadcrumb-pill header and an icon grid (or list —
 * the header toggle switches, like Nautilus's). Fully themed by
 * `--color-*` — sidebar and selection tints are foreground mixes, the
 * selected entry rides `--color-selection` — restyling live on theme
 * switch. The window chrome is the app layer's (accent border, gap).
 *
 * Browsing is REAL: a `file://`-friendly page can't scan anything on
 * its own, so Home starts as an "Open Folder" state; granting a
 * directory via the File System Access picker (or the
 * `webkitdirectory` input fallback, which snapshots the tree) makes
 * that folder Home — its subfolders become the sidebar bookmarks,
 * exactly how the reference window shows the home dirs. Recent fills
 * with files opened this session; Starred/Network/Trash show their
 * Nautilus empty states (a browser can't reach them — mimic, don't
 * fake).
 *
 * Opening a file routes it to the right app through the AppLibrary
 * launch contracts (the launched app tiles in beside this window and
 * takes focus): images → `image-viewer` with the folder's images as the
 * gallery, audio → `audio-player` with the folder as the queue, video
 * → `media-player`, PDFs → `document-viewer`, text-like files →
 * `editor`. Object URLs handed to those apps are deliberately never
 * revoked here — the receiving app outlives this window. Granted
 * root, bookmarks, recents, and the view mode live in the
 * session-global `FILE_MANAGER_STATE`, so relaunching the app after
 * opening a file comes back to the same tree without re-granting.
 *
 * Keys: arrows move the selection (grid-aware), Enter opens, `u` goes
 * up, Backspace goes back in history, `v` flips grid/list, typing
 * filters the folder (Escape clears), `q` closes (`Alt+W` too).
 * @extends {Component}
 */

/**
 * @typedef {Object} FMNode
 * @property {string} name
 * @property {'directory' | 'file'} kind
 * @property {*} [handle] - FileSystemHandle (File System Access path).
 * @property {File} [file] - The file itself (webkitdirectory path).
 * @property {Map<string, FMNode>} [children] - Subtree (webkitdirectory path).
 */

/**
 * Session state surviving remounts — closing and relaunching the app
 * must come back to the same granted tree without re-asking. The
 * analog of Nautilus staying alive as a process while windows open
 * and close.
 */
const FILE_MANAGER_STATE = {
    /** @type {FMNode | null} */
    root: null,
    /** @type {FMNode[]} */
    bookmarks: [],
    /** @type {{name: string, glyph: string, open: () => void}[]} */
    recent: [],
    /** @type {'grid' | 'list'} */
    view: Settings.get('fileManager.view') === 'list' ? 'list' : 'grid',
}

class FileManager extends Component {
    static template = `
        <section class="file-manager" data-ref="app">
            <aside class="file-manager-sidebar">
                <div class="file-manager-sidebar-header">Files</div>
                <ul class="file-manager-places" data-ref="places"></ul>
                <div class="file-manager-separator" data-ref="separator" hidden></div>
                <ul class="file-manager-places" data-ref="bookmarks"></ul>
            </aside>
            <div class="file-manager-main">
                <header class="file-manager-header">
                    <button type="button" class="file-manager-nav" data-ref="back"
                            title="Back" aria-label="Back" disabled>\u{f0141}</button>
                    <button type="button" class="file-manager-nav" data-ref="forward"
                            title="Forward" aria-label="Forward" disabled>\u{f0142}</button>
                    <div class="file-manager-crumbs" data-ref="crumbs"></div>
                    <input class="file-manager-search" data-ref="search" hidden
                           type="text" spellcheck="false" autocomplete="off"
                           placeholder="Search" aria-label="Search this folder">
                    <button type="button" class="file-manager-nav" data-ref="searchToggle"
                            title="Search this folder" aria-label="Search">\u{f0349}</button>
                    <button type="button" class="file-manager-nav" data-ref="viewToggle"
                            title="Grid/list view" aria-label="Grid/list view"></button>
                    <button type="button" class="file-manager-nav" data-ref="close"
                            title="Close (Q)" aria-label="Close">\u{f0156}</button>
                </header>
                <div class="file-manager-content" data-ref="content">
                    <ul class="file-manager-entries" data-ref="entries" role="listbox"></ul>
                    <div class="file-manager-message" hidden data-ref="message">
                        <p class="file-manager-message-icon" data-ref="messageIcon"></p>
                        <p class="file-manager-message-title" data-ref="messageTitle"></p>
                        <p class="file-manager-message-hint" data-ref="messageHint"></p>
                        <button type="button" class="file-manager-grant" hidden
                                data-ref="grant">Open Folder…</button>
                    </div>
                </div>
            </div>
            <input data-ref="dirInput" type="file" webkitdirectory multiple hidden>
        </section>
    `

    /** @param {DocumentFragment} root */
    script(root) {
        const app = $(root, '[data-ref="app"]')
        const placesList = $(root, '[data-ref="places"]')
        const bookmarksList = $(root, '[data-ref="bookmarks"]')
        const separator = $(root, '[data-ref="separator"]')
        const backButton = /** @type {HTMLButtonElement} */ ($(root, '[data-ref="back"]'))
        const forwardButton = /** @type {HTMLButtonElement} */ ($(root, '[data-ref="forward"]'))
        const crumbs = $(root, '[data-ref="crumbs"]')
        const search = /** @type {HTMLInputElement} */ ($(root, '[data-ref="search"]'))
        const searchToggle = $(root, '[data-ref="searchToggle"]')
        const viewToggle = $(root, '[data-ref="viewToggle"]')
        const closeButton = $(root, '[data-ref="close"]')
        const entriesList = $(root, '[data-ref="entries"]')
        const message = $(root, '[data-ref="message"]')
        const messageIcon = $(root, '[data-ref="messageIcon"]')
        const messageTitle = $(root, '[data-ref="messageTitle"]')
        const messageHint = $(root, '[data-ref="messageHint"]')
        const grantButton = $(root, '[data-ref="grant"]')
        const dirInput = /** @type {HTMLInputElement} */ ($(root, '[data-ref="dirInput"]'))

        const PLACES = [
            { id: 'home', label: 'Home', glyph: '\u{f02dc}' },
            { id: 'recent', label: 'Recent', glyph: '\u{f02da}' },
            { id: 'starred', label: 'Starred', glyph: '\u{f04ce}' },
            { id: 'network', label: 'Network', glyph: '\u{f0317}' },
            { id: 'trash', label: 'Trash', glyph: '\u{f01c0}' },
        ]

        const state = FILE_MANAGER_STATE
        /** Which sidebar place is showing. */
        let place = 'home'
        /** @type {FMNode[]} Breadcrumb path, [0] = the granted root. */
        let path = state.root ? [state.root] : []
        /** @type {FMNode[][]} */
        let history = state.root ? [path] : []
        let historyIndex = history.length - 1
        /** @type {{node: FMNode, glyph: string, file?: File}[]} */
        let entries = []
        let selected = -1
        let filter = ''

        const CODE_EXTENSIONS = ['js', 'ts', 'jsx', 'tsx', 'css', 'html', 'json',
            'py', 'rb', 'rs', 'go', 'c', 'h', 'cpp', 'java', 'sh', 'toml', 'yml', 'yaml', 'qml']
        const TEXT_EXTENSIONS = ['txt', 'md', 'markdown', 'log', 'csv', 'ini', 'conf', 'xml', 'svg']

        /** @param {string} name */
        const extension = name => (name.includes('.') ? name.split('.').pop() || '' : '').toLowerCase()

        /** @param {string} name @param {string} type */
        function fileGlyph(name, type) {
            const ext = extension(name)
            if (type.startsWith('image/')) return '\u{f02e9}'
            if (type.startsWith('audio/')) return '\u{f0387}'
            if (type.startsWith('video/')) return '\u{f0567}'
            if (type === 'application/pdf' || ext === 'pdf') return '\u{f0226}'
            if (CODE_EXTENSIONS.includes(ext)) return '\u{f022e}'
            if (type.startsWith('text/') || TEXT_EXTENSIONS.includes(ext)) return '\u{f0219}'
            return '\u{f0214}'
        }

        // ---- The two directory backends behind one node shape.

        /** @param {FMNode} node @returns {Promise<FMNode[]>} */
        async function listDirectory(node) {
            /** @type {FMNode[]} */
            const children = []
            if (node.children) {
                children.push(...node.children.values())
            } else if (node.handle) {
                for await (const handle of node.handle.values()) {
                    children.push({ name: handle.name, kind: handle.kind, handle })
                }
            }
            return children.sort((a, b) =>
                a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1)
        }

        /** @param {FMNode} node @returns {Promise<File>} */
        async function fileOf(node) {
            return node.file ? node.file : node.handle.getFile()
        }

        /** Builds a tree from a webkitdirectory FileList snapshot. */
        /** @param {FileList} files @returns {FMNode | null} */
        function treeFromFileList(files) {
            /** @type {FMNode | null} */
            let top = null
            for (const file of files) {
                const parts = (file.webkitRelativePath || file.name).split('/')
                if (!top) top = { name: parts[0] || 'Folder', kind: 'directory', children: new Map() }
                let dir = top
                for (let i = 1; i < parts.length - 1; i++) {
                    const children = /** @type {Map<string, FMNode>} */ (dir.children)
                    if (!children.has(parts[i])) {
                        children.set(parts[i], { name: parts[i], kind: 'directory', children: new Map() })
                    }
                    dir = /** @type {FMNode} */ (children.get(parts[i]))
                }
                /** @type {Map<string, FMNode>} */ (dir.children)
                    .set(parts[parts.length - 1], { name: parts[parts.length - 1], kind: 'file', file })
            }
            return top
        }

        /** @param {FMNode} rootNode */
        async function adoptRoot(rootNode) {
            state.root = rootNode
            state.bookmarks = (await listDirectory(rootNode))
                .filter(node => node.kind === 'directory').slice(0, 8)
            place = 'home'
            history = []
            historyIndex = -1
            await navigate([rootNode])
        }

        async function grantAccess() {
            const picker = /** @type {*} */ (window).showDirectoryPicker
            if (picker) {
                try {
                    const handle = await picker.call(window)
                    await adoptRoot({ name: handle.name, kind: 'directory', handle })
                } catch { /* picker cancelled */ }
            } else {
                dirInput.click()
            }
        }

        // ---- Navigation + rendering.

        /**
         * @param {FMNode[]} nextPath
         * @param {boolean} [fromHistory] - True when back/forward moves.
         */
        async function navigate(nextPath, fromHistory = false) {
            place = 'home'
            path = nextPath
            filter = ''
            search.value = ''
            search.hidden = true
            selected = -1
            if (!fromHistory) {
                history = history.slice(0, historyIndex + 1)
                history.push(nextPath)
                historyIndex = history.length - 1
            }
            const directory = nextPath[nextPath.length - 1]
            const listed = await listDirectory(directory)
            entries = []
            for (const node of listed) {
                if (node.kind === 'directory') {
                    entries.push({ node, glyph: '\u{f024b}' })
                } else {
                    const file = await fileOf(node)
                    entries.push({ node, glyph: fileGlyph(node.name, file.type), file })
                }
            }
            render()
        }

        /** @param {number} bytes */
        function formatSize(bytes) {
            if (bytes < 1024) return `${bytes} B`
            const units = ['KB', 'MB', 'GB', 'TB']
            let value = bytes
            let unit = -1
            do { value /= 1024; unit++ } while (value >= 1024 && unit < units.length - 1)
            return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
        }

        function visibleEntries() {
            const query = filter.trim().toLowerCase()
            if (!query) return entries
            return entries.filter(entry => entry.node.name.toLowerCase().includes(query))
        }

        /**
         * @param {string} glyph @param {string} title @param {string} hint
         * @param {boolean} [withGrant]
         */
        function showMessage(glyph, title, hint, withGrant = false) {
            entriesList.hidden = true
            message.hidden = false
            messageIcon.textContent = glyph
            messageTitle.textContent = title
            messageHint.textContent = hint
            grantButton.hidden = !withGrant
        }

        function renderSidebar() {
            placesList.textContent = ''
            for (const entry of PLACES) {
                const li = document.createElement('li')
                li.className = 'file-manager-place'
                li.classList.toggle('file-manager-place-active', place === entry.id)
                const glyph = document.createElement('span')
                glyph.className = 'file-manager-place-glyph'
                glyph.textContent = entry.glyph
                li.append(glyph, document.createTextNode(entry.label))
                li.addEventListener('click', () => showPlace(entry.id))
                placesList.appendChild(li)
            }
            separator.hidden = !state.bookmarks.length
            bookmarksList.textContent = ''
            for (const node of state.bookmarks) {
                const li = document.createElement('li')
                li.className = 'file-manager-place'
                const active = place === 'home' && path[path.length - 1] === node
                li.classList.toggle('file-manager-place-active', active)
                const glyph = document.createElement('span')
                glyph.className = 'file-manager-place-glyph'
                glyph.textContent = '\u{f024b}'
                li.append(glyph, document.createTextNode(node.name))
                li.addEventListener('click', () => {
                    if (state.root) navigate([state.root, node])
                })
                bookmarksList.appendChild(li)
            }
        }

        function renderCrumbs() {
            crumbs.textContent = ''
            if (place !== 'home') {
                const placeEntry = PLACES.find(entry => entry.id === place)
                const segment = document.createElement('span')
                segment.className = 'file-manager-crumb file-manager-crumb-current'
                segment.textContent = `${placeEntry?.glyph}  ${placeEntry?.label}`
                crumbs.appendChild(segment)
                return
            }
            path.forEach((node, index) => {
                if (index) {
                    const sep = document.createElement('span')
                    sep.className = 'file-manager-crumb-sep'
                    sep.textContent = '\u{f0142}'
                    crumbs.appendChild(sep)
                }
                const segment = document.createElement('button')
                segment.type = 'button'
                segment.className = 'file-manager-crumb'
                segment.classList.toggle('file-manager-crumb-current', index === path.length - 1)
                segment.textContent = index === 0 ? `\u{f02dc}  Home` : node.name
                segment.addEventListener('click', () => {
                    if (index < path.length - 1) navigate(path.slice(0, index + 1))
                })
                crumbs.appendChild(segment)
            })
            if (!path.length) {
                const segment = document.createElement('span')
                segment.className = 'file-manager-crumb file-manager-crumb-current'
                segment.textContent = '\u{f02dc}  Home'
                crumbs.appendChild(segment)
            }
        }

        function renderEntries() {
            entriesList.hidden = false
            message.hidden = true
            entriesList.className = `file-manager-entries file-manager-entries-${state.view}`
            entriesList.textContent = ''
            const visible = visibleEntries()
            visible.forEach((entry, index) => {
                const li = document.createElement('li')
                li.className = 'file-manager-entry'
                li.classList.toggle('file-manager-entry-selected', index === selected)
                li.setAttribute('role', 'option')
                li.setAttribute('aria-selected', String(index === selected))

                const glyph = document.createElement('span')
                glyph.className = 'file-manager-entry-glyph'
                glyph.textContent = entry.glyph

                const name = document.createElement('span')
                name.className = 'file-manager-entry-name'
                name.textContent = entry.node.name

                li.append(glyph, name)
                if (state.view === 'list') {
                    const size = document.createElement('span')
                    size.className = 'file-manager-entry-size'
                    size.textContent = entry.file ? formatSize(entry.file.size) : '—'
                    li.appendChild(size)
                }
                li.addEventListener('click', () => {
                    selected = index
                    renderEntries()
                })
                li.addEventListener('dblclick', () => activate(entry))
                entriesList.appendChild(li)
            })
            const selectedRow = entriesList.children[selected]
            if (selectedRow) selectedRow.scrollIntoView({ block: 'nearest' })
        }

        function render() {
            renderSidebar()
            renderCrumbs()
            backButton.disabled = historyIndex <= 0
            forwardButton.disabled = historyIndex >= history.length - 1
            viewToggle.textContent = state.view === 'grid' ? '\u{f0572}' : '\u{f0570}'

            if (place === 'recent') {
                if (!state.recent.length) {
                    showMessage('\u{f02da}', 'No Recent Files',
                        'Files you open will appear here')
                    return
                }
                renderRecent()
                return
            }
            if (place === 'starred') {
                showMessage('\u{f04ce}', 'Starred Files',
                    'Star files to easily find them later')
                return
            }
            if (place === 'network') {
                showMessage('\u{f0317}', 'No Network Locations',
                    'A browser window cannot reach network shares')
                return
            }
            if (place === 'trash') {
                showMessage('\u{f01c0}', 'Trash is Empty',
                    'A browser window cannot touch real files')
                return
            }
            if (!state.root) {
                showMessage('\u{f0770}', 'Open a folder to start browsing',
                    'Nothing leaves your machine — the tree is read in place', true)
                return
            }
            if (!entries.length) {
                showMessage('\u{f024b}', 'Folder is Empty', '')
                return
            }
            if (!visibleEntries().length) {
                showMessage('\u{f0349}', 'No Results Found', 'Try a different search')
                return
            }
            renderEntries()
        }

        function renderRecent() {
            entriesList.hidden = false
            message.hidden = true
            entriesList.className = 'file-manager-entries file-manager-entries-list'
            entriesList.textContent = ''
            for (const item of state.recent) {
                const li = document.createElement('li')
                li.className = 'file-manager-entry'
                const glyph = document.createElement('span')
                glyph.className = 'file-manager-entry-glyph'
                glyph.textContent = item.glyph
                const name = document.createElement('span')
                name.className = 'file-manager-entry-name'
                name.textContent = item.name
                li.append(glyph, name)
                li.addEventListener('dblclick', () => item.open())
                entriesList.appendChild(li)
            }
        }

        /** @param {string} id */
        function showPlace(id) {
            place = id
            selected = -1
            if (id === 'home') {
                if (state.root) { navigate([state.root]); return }
                path = []
            }
            render()
        }

        // ---- Opening: folders navigate, files launch the right app.

        /** @param {{node: FMNode, glyph: string, file?: File}} entry */
        async function activate(entry) {
            if (entry.node.kind === 'directory') {
                navigate([...path, entry.node])
                return
            }
            const file = entry.file || await fileOf(entry.node)
            openFile(entry.node, file)
        }

        /**
         * Routes a file to its app via the AppLibrary launch contracts.
         * The target app tiles in beside this window and takes focus;
         * the object URLs stay alive for it — never revoked here on
         * purpose, since the receiving app can outlive this window.
         * @param {FMNode} node @param {File} file
         */
        async function openFile(node, file) {
            const type = file.type
            const ext = extension(node.name)

            /** @param {(f: File) => boolean} match */
            const siblings = async match => {
                /** @type {{src: string, label: string, file: File}[]} */
                const group = []
                let index = 0
                for (const entry of entries) {
                    if (entry.node.kind !== 'file' || !entry.file || !match(entry.file)) continue
                    if (entry.node === node) index = group.length
                    group.push({
                        src: URL.createObjectURL(entry.file),
                        label: entry.node.name,
                        file: entry.file,
                    })
                }
                return { group, index }
            }

            /** @param {string} id @param {*} config */
            const launch = (id, config) => {
                remember(node, file)
                document.dispatchEvent(new CustomEvent('omarchy:app-launch', {
                    detail: { id, config },
                }))
            }

            if (type.startsWith('image/')) {
                const { group, index } = await siblings(f => f.type.startsWith('image/'))
                launch('image-viewer', { images: group, index })
            } else if (type.startsWith('audio/')) {
                const { group, index } = await siblings(f => f.type.startsWith('audio/'))
                launch('audio-player', { tracks: group, index })
            } else if (type.startsWith('video/')) {
                const { group, index } = await siblings(f => f.type.startsWith('video/'))
                launch('media-player', { tracks: group, index })
            } else if (type === 'application/pdf' || ext === 'pdf') {
                const { group, index } = await siblings(f =>
                    f.type === 'application/pdf' || extension(f.name) === 'pdf')
                launch('document-viewer', { documents: group, index })
            } else if (type.startsWith('text/') || type === 'application/json'
                || CODE_EXTENSIONS.includes(ext) || TEXT_EXTENSIONS.includes(ext)
                || (type === '' && file.size < 1024 * 1024)) {
                const content = await file.text()
                launch('editor', { name: node.name, content })
            }
            // Anything else has no app to open it — like a desktop with
            // no handler registered, the double-click just doesn't bite.
        }

        /** @param {FMNode} node @param {File} file */
        function remember(node, file) {
            state.recent = state.recent.filter(item => item.name !== node.name)
            state.recent.unshift({
                name: node.name,
                glyph: fileGlyph(node.name, file.type),
                open: () => openFile(node, file),
            })
            state.recent = state.recent.slice(0, 20)
        }

        // ---- History + header controls.

        function goBack() {
            if (historyIndex <= 0) return
            historyIndex -= 1
            navigate(history[historyIndex], true)
        }

        function goForward() {
            if (historyIndex >= history.length - 1) return
            historyIndex += 1
            navigate(history[historyIndex], true)
        }

        backButton.addEventListener('click', goBack)
        forwardButton.addEventListener('click', goForward)
        closeButton.addEventListener('click', () =>
            document.dispatchEvent(new CustomEvent('omarchy:app-close')))
        viewToggle.addEventListener('click', () => {
            state.view = state.view === 'grid' ? 'list' : 'grid'
            Settings.set('fileManager.view', state.view)
            render()
        })
        searchToggle.addEventListener('click', () => {
            search.hidden = !search.hidden
            if (!search.hidden) search.focus()
            else { filter = ''; search.value = ''; render() }
        })
        search.addEventListener('input', () => {
            filter = search.value
            selected = -1
            render()
        })
        grantButton.addEventListener('click', grantAccess)
        dirInput.addEventListener('change', () => {
            const tree = dirInput.files ? treeFromFileList(dirInput.files) : null
            dirInput.value = ''
            if (tree) adoptRoot(tree)
        })

        // ---- Keyboard, grid-aware.

        function gridColumns() {
            if (state.view === 'list') return 1
            const style = getComputedStyle(entriesList)
            return Math.max(1, style.gridTemplateColumns.split(' ').length)
        }

        /** Cleans up everything the closed manager left on the document. */
        function disconnected() {
            if (app.isConnected) return false
            document.removeEventListener('keydown', onKey)
            return true
        }

        /** @param {KeyboardEvent} event */
        function onKey(event) {
            if (disconnected()) return
            if (!AppLibrary.focusedContains(app)) return
            if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return
            for (const selector of ['.menu', '.image-picker', '.keybindings',
                '.lock', '.screensaver', '.system-login']) {
                const el = /** @type {HTMLElement | null} */ (document.querySelector(selector))
                if (el && !el.hidden) return
            }
            if (document.activeElement === search) {
                if (event.key === 'Escape') {
                    search.hidden = true
                    filter = ''
                    search.value = ''
                    search.blur()
                    render()
                    event.preventDefault()
                }
                return
            }

            const visible = visibleEntries()
            const columns = gridColumns()
            const key = event.key
            if (key === 'ArrowRight') selected = Math.min(visible.length - 1, selected + 1)
            else if (key === 'ArrowLeft') selected = Math.max(0, selected - 1)
            else if (key === 'ArrowDown') selected = Math.min(visible.length - 1, selected + columns)
            else if (key === 'ArrowUp') selected = Math.max(0, selected - columns)
            else if (key === 'Enter') {
                if (visible[selected]) activate(visible[selected])
                event.preventDefault()
                return
            }
            else if (key === 'Backspace') { goBack(); event.preventDefault(); return }
            else if (key === 'u') {
                if (path.length > 1) navigate(path.slice(0, -1))
                event.preventDefault()
                return
            }
            else if (key === 'v') {
                state.view = state.view === 'grid' ? 'list' : 'grid'
                Settings.set('fileManager.view', state.view)
                render()
                event.preventDefault()
                return
            }
            else if (key === 'q') {
                document.dispatchEvent(new CustomEvent('omarchy:app-close'))
                event.preventDefault()
                return
            }
            else if (key.length === 1 && key !== ' ') {
                // Nautilus type-ahead: typing starts a folder search.
                search.hidden = false
                search.focus()
                return
            }
            else return
            event.preventDefault()
            renderEntries()
        }

        document.addEventListener('keydown', onKey)

        // Returning to an already-granted tree: reload the last folder.
        if (state.root) navigate(path, true)
        else render()
    }
}

AppLibrary.register('file-manager', {
    name: 'Files',
    icon: '\u{f024b}',
    component: FileManager,
})
