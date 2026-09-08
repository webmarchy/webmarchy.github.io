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
 * @property {boolean} sticky
 * @property {boolean} scratch
 * @property {boolean} transparent
 * @property {'h' | 'v' | null} splitAxis
 * @property {'h' | 'v'} effectiveAxis
 * @property {number} ratio
 * @property {{width: string, height: string} | null} floatingSize
 * @property {{x: number, y: number} | null} floatingPos
 */

const APP_LIBRARY_IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform)

/**
 * @param {{altKey: boolean, metaKey: boolean}} event
 */
function appLibraryMod(event) {
    return APP_LIBRARY_IS_MAC
        ? event.altKey && !event.metaKey
        : event.altKey || event.metaKey
}

const AppLibrary = {
    /** @type {Map<string, AppEntry>} */
    _entries: new Map(),
    /** @type {HTMLElement | null} */
    _host: null,
    /** @type {AppWindow[]} */
    _windows: [],
    WORKSPACES: 5,
    _activeWorkspace: 1,
    _formerWorkspace: 1,
    _scratchVisible: false,
    _gaps: true,
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
        this._gaps = Settings.get('shell.gaps', true) !== false
        if (!this._gaps) document.documentElement.dataset.gaps = 'off'
        window.addEventListener('resize', () => this._layout())
        document.addEventListener('keydown', event => this._onKey(event))
        document.addEventListener('wheel', event => {
            if (!appLibraryMod(event) || event.ctrlKey) return
            event.preventDefault()
            this.stepWorkspace(event.deltaY > 0 || event.deltaX > 0 ? 1 : -1)
        }, { passive: false })
        document.addEventListener('pointerdown', event => this._onPointerDown(event))
        document.addEventListener('contextmenu', event => {
            if (!appLibraryMod(event)) return
            const target = event.target
            if (target instanceof Element && target.closest('.app-window')) {
                event.preventDefault()
            }
        })
        document.addEventListener('omarchy:workspace-switch', event => {
            this.switchWorkspace(Number(/** @type {CustomEvent} */ (event).detail))
        })
        document.addEventListener('omarchy:workspace-step', event => {
            this.stepWorkspace(Number(/** @type {CustomEvent} */ (event).detail) || 1)
        })
        document.addEventListener('omarchy:gaps-toggle', () => this.toggleGaps())
    },

    /**
     * @param {KeyboardEvent} event
     */
    _onKey(event) {
        if (event.defaultPrevented) return
        if (event.ctrlKey && event.altKey && !event.shiftKey && !event.metaKey
            && event.code === 'Delete') {
            this.closeAll()
            event.preventDefault()
            return
        }
        if (!appLibraryMod(event)) return
        const digit = /^Digit([1-5])$/.exec(event.code)
        if (digit && !event.ctrlKey) {
            const n = Number(digit[1])
            if (event.shiftKey && event.altKey && event.metaKey) this.sendToWorkspace(n)
            else if (event.shiftKey) this.moveToWorkspace(n)
            else this.switchWorkspace(n)
        } else if (event.code === 'Tab') {
            if (event.ctrlKey) this.switchWorkspace(this._formerWorkspace)
            else this.stepWorkspace(event.shiftKey ? -1 : 1)
        } else if ((event.code === 'KeyW' || event.code === 'KeyQ')
            && !event.shiftKey && !event.ctrlKey) {
            this.close()
        } else if (event.code === 'KeyF' && !event.shiftKey && !event.ctrlKey) {
            this.toggleFullscreen()
        } else if (event.code === 'KeyT' && !event.shiftKey && !event.ctrlKey) {
            this.toggleFloating()
        } else if (event.code === 'KeyJ' && !event.shiftKey && !event.ctrlKey) {
            this.toggleSplit()
        } else if (event.code === 'KeyO' && !event.shiftKey && !event.ctrlKey) {
            this.toggleSticky()
        } else if (event.code === 'KeyS' && !event.shiftKey && !event.ctrlKey) {
            if (event.altKey && event.metaKey) this.moveToScratchpad()
            else this.toggleScratchpad()
        } else if (event.code === 'Backquote' && !event.ctrlKey) {
            if (event.shiftKey) this.moveToScratchpad()
            else this.toggleScratchpad()
        } else if (event.code === 'Enter' && !event.shiftKey && !event.ctrlKey) {
            this.launch('terminal')
        } else if ((event.code === 'Minus' || event.code === 'Equal') && !event.shiftKey) {
            const step = event.ctrlKey ? 0.1
                : event.altKey && event.metaKey ? 0.01 : 0.04
            this.resizeFocused(event.code === 'Minus' ? step : -step)
        } else if (event.code === 'Backspace' && !event.ctrlKey) {
            if (event.shiftKey) this.toggleGaps()
            else this.toggleTransparency()
        } else if (event.code.startsWith('Arrow') && !event.ctrlKey) {
            const direction = event.code.slice(5).toLowerCase()
            if (event.shiftKey) this.swap(direction)
            else this.focusDirection(direction)
        } else {
            return
        }
        event.preventDefault()
    },

    /**
     * @param {PointerEvent} event
     */
    _onPointerDown(event) {
        if (!appLibraryMod(event) || event.ctrlKey) return
        const host = this._host
        const target = event.target
        if (!host || !(target instanceof Element)) return
        const element = target.closest('.app-window')
        const win = this._windows.find(w => w.element === element)
        if (!win || !win.floating || win.fullscreen) return
        event.preventDefault()
        const mode = event.button === 2 ? 'resize' : 'move'
        const hostRect = host.getBoundingClientRect()
        const startRect = win.element.getBoundingClientRect()
        const startX = event.clientX
        const startY = event.clientY
        const startPos = win.floatingPos ?? {
            x: (startRect.left + startRect.width / 2 - hostRect.left) / hostRect.width * 100,
            y: (startRect.top + startRect.height / 2 - hostRect.top) / hostRect.height * 100,
        }
        /** @param {PointerEvent} move */
        const onMove = move => {
            const dx = move.clientX - startX
            const dy = move.clientY - startY
            if (mode === 'move') {
                win.floatingPos = {
                    x: Math.min(97, Math.max(3, startPos.x + dx / hostRect.width * 100)),
                    y: Math.min(97, Math.max(3, startPos.y + dy / hostRect.height * 100)),
                }
            } else {
                win.floatingSize = {
                    width: `${Math.min(100, Math.max(15,
                        (startRect.width + dx * 2) / hostRect.width * 100))}%`,
                    height: `${Math.min(100, Math.max(15,
                        (startRect.height + dy * 2) / hostRect.height * 100))}%`,
                }
            }
            this._layout()
        }
        const onUp = () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
    },

    /** @returns {AppWindow[]} */
    _activeWindows() {
        return this._windows.filter(win => win.scratch
            ? this._scratchVisible
            : win.sticky || win.workspace === this._activeWorkspace)
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
            sticky: false, scratch: false, transparent: false,
            splitAxis: null, effectiveAxis: 'h', ratio: 0.5,
            floatingSize: typeof entry.floating === 'object' ? entry.floating : null,
            floatingPos: null,
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
        if (target.scratch && !this._scratchVisible) {
            this._scratchVisible = true
            this._apply()
        }
        if (!target.scratch && !target.sticky
            && target.workspace !== this._activeWorkspace) {
            this._formerWorkspace = this._activeWorkspace
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

    closeAll() {
        for (const win of [...this._windows]) {
            this.close(win.id)
        }
    },

    /** @param {number} n */
    switchWorkspace(n) {
        if (!Number.isInteger(n) || n < 1 || n > this.WORKSPACES) return
        if (n === this._activeWorkspace) return
        this._formerWorkspace = this._activeWorkspace
        this._activeWorkspace = n
        this._apply()
        const windows = this._activeWindows().filter(win => !win.scratch)
        if (windows.length) this.focus(windows[windows.length - 1].id)
        else this.current = ''
        this._notify()
    },

    /** @param {number} delta */
    stepWorkspace(delta) {
        const span = this.WORKSPACES
        const next = ((this._activeWorkspace - 1 + delta) % span + span) % span + 1
        this.switchWorkspace(next)
    },

    /**
     * @param {number} n
     */
    moveToWorkspace(n) {
        if (!Number.isInteger(n) || n < 1 || n > this.WORKSPACES) return
        const win = this._windows.find(w => w.id === this.current)
        if (!win || win.workspace === n) return
        win.workspace = n
        win.scratch = false
        win.sticky = false
        this._formerWorkspace = this._activeWorkspace
        this._activeWorkspace = n
        this._apply()
        this.focus(win.id)
        this._notify()
    },

    /**
     * @param {number} n
     */
    sendToWorkspace(n) {
        if (!Number.isInteger(n) || n < 1 || n > this.WORKSPACES) return
        const win = this._windows.find(w => w.id === this.current)
        if (!win || win.workspace === n) return
        win.workspace = n
        win.scratch = false
        win.sticky = false
        this._apply()
        const survivors = this._activeWindows()
        if (survivors.length) this.focus(survivors[survivors.length - 1].id)
        else this.current = ''
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
        if (!win.floating) {
            win.sticky = false
            win.scratch = false
        }
        this._apply()
    },

    toggleSplit() {
        const win = this._windows.find(w => w.id === this.current)
        if (!win || win.floating) return
        win.splitAxis = win.effectiveAxis === 'h' ? 'v' : 'h'
        this._layout()
    },

    toggleSticky() {
        const win = this._windows.find(w => w.id === this.current)
        if (!win) return
        win.sticky = !win.sticky
        if (win.sticky) {
            win.floating = true
            win.scratch = false
        } else {
            win.workspace = this._activeWorkspace
        }
        this._apply()
        this._notify()
    },

    toggleScratchpad() {
        if (!this._windows.some(win => win.scratch)) return
        this._scratchVisible = !this._scratchVisible
        this._apply()
        if (this._scratchVisible) {
            const scratch = this._windows.filter(win => win.scratch)
            this.focus(scratch[scratch.length - 1].id)
        } else {
            const survivors = this._activeWindows()
            if (survivors.length) this.focus(survivors[survivors.length - 1].id)
            else this.current = ''
        }
        this._notify()
    },

    moveToScratchpad() {
        const win = this._windows.find(w => w.id === this.current)
        if (!win) return
        win.scratch = true
        win.floating = true
        win.sticky = false
        this._scratchVisible = false
        this._apply()
        const survivors = this._activeWindows()
        if (survivors.length) this.focus(survivors[survivors.length - 1].id)
        else this.current = ''
        this._notify()
    },

    /** @param {number} delta */
    resizeFocused(delta) {
        const win = this._windows.find(w => w.id === this.current)
        if (!win || !this._host) return
        if (win.floating) {
            const hostRect = this._host.getBoundingClientRect()
            const rect = win.element.getBoundingClientRect()
            const width = rect.width / hostRect.width * 100
            const height = rect.height / hostRect.height * 100
            win.floatingSize = {
                width: `${Math.min(100, Math.max(15, width + delta * 100))}%`,
                height: `${Math.min(100, Math.max(15, height + delta * 100))}%`,
            }
            this._layout()
            return
        }
        const tiled = this._activeWindows().filter(w => !w.floating)
        const index = tiled.indexOf(win)
        if (index < 0 || tiled.length < 2) return
        const target = index > 0 ? win : tiled[1]
        const applied = index > 0 ? delta : -delta
        target.ratio = Math.min(0.85, Math.max(0.15, target.ratio + applied))
        this._layout()
    },

    toggleTransparency() {
        const win = this._windows.find(w => w.id === this.current)
        if (!win) return
        win.transparent = !win.transparent
        win.element.classList.toggle('app-window-transparent', win.transparent)
    },

    toggleGaps() {
        this._gaps = !this._gaps
        Settings.set('shell.gaps', this._gaps)
        if (this._gaps) delete document.documentElement.dataset.gaps
        else document.documentElement.dataset.gaps = 'off'
        this._layout()
    },

    /**
     * @param {string} direction
     * @returns {AppWindow | null}
     */
    _neighbour(direction) {
        const focused = this._windows.find(w => w.id === this.current)
        if (!focused || !this._activeWindows().includes(focused)) return null
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
                this._windows.some(win => win.workspace === i + 1 && !win.scratch)),
        }
    },

    _notify() {
        document.dispatchEvent(new CustomEvent('omarchy:workspaces-changed'))
    },

    _apply() {
        for (const win of this._windows) {
            win.element.hidden = win.scratch
                ? !this._scratchVisible
                : !win.sticky && win.workspace !== this._activeWorkspace
        }
        this._layout()
    },

    _layout() {
        const host = this._host
        const windows = this._activeWindows()
        if (!host || !windows.length) return
        const gap = this._gaps ? 2.5 : 0

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
            const axis = tiled[i].splitAxis
                ?? (target.w * aspect >= target.h ? 'h' : 'v')
            const ratio = Math.min(0.85, Math.max(0.15, tiled[i].ratio))
            tiled[i].effectiveAxis = axis
            if (axis === 'h') {
                const width = target.w * ratio
                target.w -= width
                rects.push({ x: target.x + target.w, y: target.y, w: width, h: target.h })
            } else {
                const height = target.h * ratio
                target.h -= height
                rects.push({ x: target.x, y: target.y + target.h, w: target.w, h: height })
            }
        }
        tiled.forEach((win, i) => {
            const rect = rects[i]
            const style = win.element.style
            style.left = `calc(${rect.x * 100}% + ${gap}px)`
            style.top = `calc(${rect.y * 100}% + ${gap}px)`
            style.width = `calc(${rect.w * 100}% - ${gap * 2}px)`
            style.height = `calc(${rect.h * 100}% - ${gap * 2}px)`
            style.transform = ''
            style.zIndex = ''
        })

        windows.filter(win => win.floating).forEach((win, i) => {
            const style = win.element.style
            style.width = win.floatingSize?.width ?? '60%'
            style.height = win.floatingSize?.height ?? '70%'
            if (win.floatingPos) {
                style.left = `${win.floatingPos.x}%`
                style.top = `${win.floatingPos.y}%`
            } else {
                style.left = `calc(50% + ${i * 2}rem)`
                style.top = `calc(50% + ${i * 1.5}rem)`
            }
            style.transform = 'translate(-50%, -50%)'
            style.zIndex = win.scratch
                ? (win.id === this.current ? '6' : '5')
                : (win.id === this.current ? '4' : '3')
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
