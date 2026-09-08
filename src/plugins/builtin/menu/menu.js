/** @extends {Component} */
class Menu extends Component {
    static template = `
        <div class="menu" hidden data-ref="menu"
             role="dialog" aria-modal="true" aria-label="Omarchy menu">
            <div class="menu-card">
                <div class="menu-header" data-ref="header" aria-hidden="true"></div>
                <ul class="menu-list" data-ref="list" role="listbox" id="menu-listbox"></ul>
            </div>
        </div>
    `

    /** @param {DocumentFragment} root */
    script(root) {
        const menu = $(root, '[data-ref="menu"]')
        const header = /** @type {HTMLElement} */ ($(root, '[data-ref="header"]'))
        const list = $(root, '[data-ref="list"]')

        let activeMenu = 'root'
        let filter = ''
        let selectedIndex = 0
        let providerRows = null

        function currentRows() {
            if (filter.trim()) return menuSearch(filter)
            if (providerRows) return providerRows
            return menuChildrenOf(activeMenu)
        }

        /**
         * @param {boolean} [scroll]
         */
        function updateSelection(scroll = false) {
            const slides = [...list.children]
            slides.forEach((li, index) => {
                li.classList.toggle('menu-row-selected', index === selectedIndex)
                li.setAttribute('aria-selected', String(index === selectedIndex))
            })
            list.setAttribute('aria-activedescendant',
                slides.length ? `menu-opt-${selectedIndex}` : '')
            if (scroll && slides[selectedIndex]) {
                slides[selectedIndex].scrollIntoView({ block: 'nearest' })
            }
        }

        function render() {
            const rows = currentRows()
            selectedIndex = Math.min(selectedIndex, Math.max(0, rows.length - 1))
            card.classList.toggle('menu-card-wide', activeMenu === 'style.font')

            if (filter) {
                header.textContent = filter
                header.classList.remove('menu-header-placeholder')
            } else {
                const item = MENU_ITEMS[activeMenu]
                header.textContent = `${item?.title || item?.label || 'Go'}…`
                header.classList.add('menu-header-placeholder')
            }
            list.setAttribute('aria-label', header.textContent)

            list.textContent = ''
            rows.forEach((row, index) => {
                const li = document.createElement('li')
                li.className = 'menu-row'
                li.id = `menu-opt-${index}`
                li.setAttribute('role', 'option')

                const icon = document.createElement('span')
                icon.className = 'menu-row-icon'
                icon.textContent = row.icon ?? ''
                li.appendChild(icon)

                const body = document.createElement('span')
                body.className = 'menu-row-body'
                const label = document.createElement('span')
                label.className = 'menu-row-label'
                label.textContent = row.label
                body.appendChild(label)
                if (row.detail) {
                    const detail = document.createElement('span')
                    detail.className = 'menu-row-detail'
                    detail.textContent = row.detail
                    body.appendChild(detail)
                }
                li.appendChild(body)

                const trailing = document.createElement('span')
                trailing.className = 'menu-row-trailing'
                trailing.textContent = row.action || row.target ? '' : '›'
                li.appendChild(trailing)

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

        /** @param {{id: string, action?: string, target?: string, provider?: string}} row */
        function activate(row) {
            if (row.action) {
                close()
                const spaceAt = row.action.indexOf(' ')
                const type = spaceAt === -1 ? row.action : row.action.slice(0, spaceAt)
                const detail = spaceAt === -1 ? '' : row.action.slice(spaceAt + 1)
                document.dispatchEvent(new CustomEvent(type, { detail }))
            } else if (row.target) {
                close()
                window.open(row.target, '_blank', 'noopener')
            } else {
                activeMenu = row.id
                providerRows = row.provider
                    ? MENU_PROVIDERS[row.provider]?.() ?? []
                    : null
                filter = ''
                selectedIndex = 0
                render()
            }
        }

        function goBack() {
            if (activeMenu === 'root') return
            activeMenu = menuParentOf(activeMenu)
            providerRows = null
            filter = ''
            selectedIndex = 0
            render()
        }

        function reflectExpanded(expanded) {
            const widget = document.querySelector('.menu-bar-widget')
            if (widget) widget.setAttribute('aria-expanded', String(expanded))
        }

        function open(startMenu = 'root') {
            activeMenu = startMenu
            const provider = MENU_ITEMS[startMenu]?.provider
            providerRows = provider
                ? MENU_PROVIDERS[provider]?.() ?? []
                : null
            filter = ''
            selectedIndex = 0
            menu.hidden = false
            reflectExpanded(true)
            render()
        }

        function close() {
            menu.hidden = true
            reflectExpanded(false)
        }

        function toggle() {
            if (menu.hidden) open()
            else close()
        }

        const card = $(root, '.menu-card')
        dismissOnOutsideClick(() => !menu.hidden, close,
            target => card.contains(target))

        document.addEventListener('omarchy:menu-toggle', event => {
            const startMenu = String(/** @type {CustomEvent} */ (event).detail || '')
            if (startMenu && MENU_ITEMS[startMenu]) {
                if (menu.hidden || activeMenu !== startMenu) open(startMenu)
                else close()
            } else {
                toggle()
            }
        })

        const isMac = /Mac|iPhone|iPad/.test(navigator.platform)

        /** @param {KeyboardEvent} event */
        function isSummon(event) {
            return event.code === 'Space'
                && !event.ctrlKey && !event.shiftKey
                && (isMac
                    ? (event.altKey && !event.metaKey)
                    : (event.metaKey || event.altKey))
        }

        window.addEventListener('keydown', event => {
            if (!isSummon(event)) return
            event.preventDefault()
            event.stopImmediatePropagation()
            const modalBlocking = ['.image-picker', '.keybindings', '.reminders', '.emojis', '.clipboard', '.lock', '.screensaver', '.system-login'].some(selector => {
                const el = /** @type {HTMLElement | null} */ (document.querySelector(selector))
                return el !== null && !el.hidden
            })
            if (modalBlocking) return
            toggle()
        }, { capture: true })

        window.addEventListener('keyup', event => {
            if (!isSummon(event)) return
            event.preventDefault()
            event.stopImmediatePropagation()
        }, { capture: true })

        document.addEventListener('keydown', event => {
            if (menu.hidden) return

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
            } else if (event.key === 'Enter' || event.key === 'ArrowRight') {
                if (rows[selectedIndex]) activate(rows[selectedIndex])
            } else if (event.key === 'Backspace' && filter) {
                filter = filter.slice(0, -1)
                selectedIndex = 0
                render()
            } else if (event.key === 'Backspace' || event.key === 'ArrowLeft') {
                goBack()
            } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                filter += event.key
                selectedIndex = 0
                render()
            }
        })
    }
}
