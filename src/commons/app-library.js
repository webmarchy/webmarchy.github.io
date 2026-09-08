/**
 * @typedef {Object} AppEntry
 * @property {string} name
 * @property {string} icon
 * @property {new (config?: *) => Component} component
 * @property {boolean | {width: string, height: string}} [floating]
 */

/**
 * @typedef {Object} AppWindow
 * @property {string} id
 * @property {HTMLElement} element
 * @property {number} workspace
 * @property {boolean} fullscreen
 * @property {boolean} floating
 * @property {{width: string, height: string} | null} floatingSize
 */

const AppLibrary = {
    /** @type {Map<string, AppEntry>} */
    _entries: new Map(),
    /** @type {HTMLElement | null} */
    _host: null,
    /** @type {AppWindow[]} */
    _windows: [],
    WORKSPACES: 5,
    _activeWorkspace: 1,
    current: '',

    /**
     * @param {string} id
     * @param {AppEntry} entry
     */
    register(id, entry) {
        if (this._entries.has(id)) {
            throw new Error(`AppLibrary.register: "${id}" is already registered`)
        }
        this._entries.set(id, entry)
    },

    entries() {
        return [...this._entries.entries()].map(([id, e]) => ({
            id, name: e.name, icon: e.icon,
        }))
    },

    /**
     * @param {HTMLElement} host
     */
    attach(host) {
        this._host = host
        window.addEventListener('resize', () => this._layout())
        document.addEventListener('keydown', event => this._onKey(event))
        document.addEventListener('omarchy:workspace-switch', event => {
            this.switchWorkspace(Number(/** @type {CustomEvent} */ (event).detail))
        })
    },

    /**
     * @param {KeyboardEvent} event
     */
    _onKey(event) {
        if (event.defaultPrevented) return
        if (!event.altKey || event.ctrlKey || event.metaKey) return
        const digit = /^Digit([1-5])$/.exec(event.code)
        if (digit) {
            const n = Number(digit[1])
            if (event.shiftKey) this.moveToWorkspace(n)
            else this.switchWorkspace(n)
        } else if ((event.code === 'KeyW' || event.code === 'KeyQ') && !event.shiftKey) {
            this.close()
        } else if (event.code === 'KeyF' && !event.shiftKey) {
            this.toggleFullscreen()
        } else if (event.code === 'KeyT' && !event.shiftKey) {
            this.toggleFloating()
        } else if (event.code === 'Enter' && !event.shiftKey) {
            this.launch('terminal')
        } else if (event.code.startsWith('Arrow')) {
            const direction = event.code.slice(5).toLowerCase()
            if (event.shiftKey) this.swap(direction)
            else this.focusDirection(direction)
        } else {
            return
        }
        event.preventDefault()
    },

    /** @returns {AppWindow[]} */
    _activeWindows() {
        return this._windows.filter(win => win.workspace === this._activeWorkspace)
    },

    /**
     * @param {string} id
     * @param {*} [config]
     */
    launch(id, config) {
        const entry = this._entries.get(id)
        if (!entry || !this._host) return
        const existing = this._windows.find(win => win.id === id)
        if (existing) {
            if (config !== undefined) {
                existing.element.textContent = ''
                mount(existing.element, new entry.component(config))
            }
            this.focus(id)
            return
        }
        const element = document.createElement('div')
        element.className = 'app-window'
        element.addEventListener('pointerdown', () => this.focus(id), { capture: true })
        mount(element, new entry.component(config))
        this._host.appendChild(element)
        this._windows.push({
            id, element, workspace: this._activeWorkspace, fullscreen: false,
            floating: Boolean(entry.floating),
            floatingSize: typeof entry.floating === 'object' ? entry.floating : null,
        })
        this._host.hidden = false
        this._apply()
        this.focus(id)
        this._notify()
    },

    /**
     * @param {string} id
     */
    focus(id) {
        const target = this._windows.find(win => win.id === id)
        if (!target) return
        if (target.workspace !== this._activeWorkspace) {
            this._activeWorkspace = target.workspace
            this._apply()
            this._notify()
        }
        this.current = id
        for (const win of this._windows) {
            win.element.classList.toggle('app-window-focused', win === target)
        }
        this._layout()
        const active = document.activeElement
        if (active instanceof HTMLElement && active !== document.body
            && !target.element.contains(active)) {
            active.blur()
        }
    },

    /**
     * @param {Element} element
     */
    focusedContains(element) {
        const focused = this._windows.find(win => win.id === this.current)
        return focused !== undefined && focused.element.contains(element)
    },

    /**
     * @param {string} [id]
     */
    close(id = this.current) {
        const index = this._windows.findIndex(win => win.id === id)
        if (index < 0 || !this._host) return
        this._windows[index].element.remove()
        this._windows.splice(index, 1)
        this._apply()
        const survivors = this._activeWindows()
        if (survivors.length) {
            this.focus(survivors[survivors.length - 1].id)
        } else {
            this.current = ''
        }
        this._host.hidden = this._windows.length === 0
        this._notify()
    },

    /** @param {number} n */
    switchWorkspace(n) {
        if (!Number.isInteger(n) || n < 1 || n > this.WORKSPACES) return
        if (n === this._activeWorkspace) return
        this._activeWorkspace = n
        this._apply()
        const windows = this._activeWindows()
        if (windows.length) this.focus(windows[windows.length - 1].id)
        else this.current = ''
        this._notify()
    },

    /**
     * @param {number} n
     */
    moveToWorkspace(n) {
        if (!Number.isInteger(n) || n < 1 || n > this.WORKSPACES) return
        const win = this._windows.find(w => w.id === this.current)
        if (!win || win.workspace === n) return
        win.workspace = n
        this._activeWorkspace = n
        this._apply()
        this.focus(win.id)
        this._notify()
    },

    toggleFullscreen() {
        const win = this._windows.find(w => w.id === this.current)
        if (!win) return
        win.fullscreen = !win.fullscreen
        this._apply()
    },

    toggleFloating() {
        const win = this._windows.find(w => w.id === this.current)
        if (!win) return
        win.floating = !win.floating
        this._apply()
    },

    /**
     * @param {string} direction
     * @returns {AppWindow | null}
     */
    _neighbour(direction) {
        const focused = this._windows.find(w => w.id === this.current)
        if (!focused || focused.workspace !== this._activeWorkspace) return null
        const from = focused.element.getBoundingClientRect()
        const fx = from.left + from.width / 2
        const fy = from.top + from.height / 2
        /** @type {AppWindow | null} */
        let best = null
        let bestDistance = Infinity
        for (const win of this._activeWindows()) {
            if (win === focused) continue
            const rect = win.element.getBoundingClientRect()
            const cx = rect.left + rect.width / 2
            const cy = rect.top + rect.height / 2
            const inDirection = direction === 'left' ? cx < fx - 1
                : direction === 'right' ? cx > fx + 1
                    : direction === 'up' ? cy < fy - 1
                        : cy > fy + 1
            if (!inDirection) continue
            const distance = (cx - fx) ** 2 + (cy - fy) ** 2
            if (distance < bestDistance) {
                bestDistance = distance
                best = win
            }
        }
        return best
    },

    /** @param {string} direction */
    focusDirection(direction) {
        const windows = this._activeWindows()
        if (!windows.length) return
        if (!windows.some(w => w.id === this.current)) {
            this.focus(windows[windows.length - 1].id)
            return
        }
        const target = this._neighbour(direction)
        if (target) this.focus(target.id)
    },

    /**
     * @param {string} direction
     */
    swap(direction) {
        const target = this._neighbour(direction)
        const focused = this._windows.find(w => w.id === this.current)
        if (!target || !focused || target.floating || focused.floating) return
        const a = this._windows.indexOf(focused)
        const b = this._windows.indexOf(target)
        this._windows[a] = target
        this._windows[b] = focused
        this._apply()
    },

    workspaceState() {
        return {
            active: this._activeWorkspace,
            occupied: Array.from({ length: this.WORKSPACES }, (_, i) =>
                this._windows.some(win => win.workspace === i + 1)),
        }
    },

    _notify() {
        document.dispatchEvent(new CustomEvent('omarchy:workspaces-changed'))
    },

    _apply() {
        for (const win of this._windows) {
            win.element.hidden = win.workspace !== this._activeWorkspace
        }
        this._layout()
    },

    _layout() {
        const host = this._host
        const windows = this._activeWindows()
        if (!host || !windows.length) return

        const tiled = windows.filter(win => !win.floating)
        const aspect = host.clientWidth / Math.max(1, host.clientHeight)
        /** @type {{x: number, y: number, w: number, h: number}[]} */
        const rects = []
        for (let i = 0; i < tiled.length; i++) {
            if (i === 0) {
                rects.push({ x: 0, y: 0, w: 1, h: 1 })
                continue
            }
            const target = rects[i - 1]
            if (target.w * aspect >= target.h) {
                target.w /= 2
                rects.push({ x: target.x + target.w, y: target.y, w: target.w, h: target.h })
            } else {
                target.h /= 2
                rects.push({ x: target.x, y: target.y + target.h, w: target.w, h: target.h })
            }
        }
        tiled.forEach((win, i) => {
            const rect = rects[i]
            const style = win.element.style
            style.left = `calc(${rect.x * 100}% + 2.5px)`
            style.top = `calc(${rect.y * 100}% + 2.5px)`
            style.width = `calc(${rect.w * 100}% - 5px)`
            style.height = `calc(${rect.h * 100}% - 5px)`
            style.transform = ''
            style.zIndex = ''
        })

        windows.filter(win => win.floating).forEach((win, i) => {
            const style = win.element.style
            style.width = win.floatingSize?.width ?? '60%'
            style.height = win.floatingSize?.height ?? '70%'
            style.left = `calc(50% + ${i * 2}rem)`
            style.top = `calc(50% + ${i * 1.5}rem)`
            style.transform = 'translate(-50%, -50%)'
            style.zIndex = win.id === this.current ? '4' : '3'
        })

        for (const win of windows) {
            win.element.classList.toggle('app-window-fullscreen', win.fullscreen)
        }
    },
}

document.addEventListener('omarchy:app-launch', event => {
    const detail = /** @type {CustomEvent} */ (event).detail
    if (typeof detail === 'object' && detail !== null) {
        AppLibrary.launch(String(detail.id), detail.config)
    } else {
        AppLibrary.launch(String(detail))
    }
})
document.addEventListener('omarchy:app-close', () => {
    AppLibrary.close()
})
