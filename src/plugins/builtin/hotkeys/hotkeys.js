/**
 * @typedef {Object} HotkeyBinding
 * @property {string} code
 * @property {boolean} ctrl
 * @property {boolean} shift
 * @property {boolean} [alt]
 * @property {string} action
 */

/** @type {HotkeyBinding[]} */
const HOTKEY_BINDINGS = [
    { code: 'Space', ctrl: true, shift: true, action: 'omarchy:theme-picker' },
    { code: 'Space', ctrl: true, shift: false, action: 'omarchy:background-picker' },
    { code: 'Space', ctrl: false, shift: true, action: 'omarchy:bar-toggle' },
    { code: 'Space', ctrl: false, shift: false, alt: true, action: 'omarchy:menu-toggle apps' },
    { code: 'Escape', ctrl: false, shift: false, action: 'omarchy:menu-toggle system' },
    { code: 'KeyA', ctrl: true, shift: false, action: 'omarchy:audio-toggle' },
    { code: 'KeyB', ctrl: true, shift: false, action: 'omarchy:bluetooth-toggle' },
    { code: 'KeyW', ctrl: true, shift: false, action: 'omarchy:network-toggle' },
    { code: 'KeyD', ctrl: true, shift: false, alt: true, action: 'omarchy:clock-toggle' },
    { code: 'KeyD', ctrl: true, shift: false, action: 'omarchy:monitor-toggle' },
    { code: 'KeyP', ctrl: true, shift: false, action: 'omarchy:power-toggle' },
    { code: 'KeyL', ctrl: true, shift: false, action: 'omarchy:lock' },
    { code: 'KeyI', ctrl: true, shift: false, action: 'omarchy:idle-toggle' },
    { code: 'KeyN', ctrl: true, shift: false, action: 'omarchy:nightlight-toggle' },
    { code: 'KeyO', ctrl: true, shift: false, action: 'omarchy:menu-toggle trigger.toggle' },
    { code: 'KeyQ', ctrl: true, shift: false, action: 'omarchy:app-launch calculator' },
    { code: 'KeyF', ctrl: false, shift: true, action: 'omarchy:app-launch file-manager' },
    { code: 'KeyN', ctrl: false, shift: true, action: 'omarchy:app-launch editor' },
    { code: 'KeyM', ctrl: false, shift: true, action: 'omarchy:app-launch audio-player' },
    { code: 'Slash', ctrl: false, shift: false, alt: true, action: 'omarchy:monitor-scale-step -1' },
    { code: 'Slash', ctrl: false, shift: false, action: 'omarchy:monitor-scale-step 1' },
]

const HOTKEY_MODAL_SELECTORS = ['.menu', '.image-picker', '.keybindings',
    '.reminders', '.emojis', '.clipboard', '.lock', '.screensaver', '.system-login']

/**
 * @param {string} action
 */
function hotkeyDispatch(action) {
    const spaceAt = action.indexOf(' ')
    const type = spaceAt === -1 ? action : action.slice(0, spaceAt)
    const detail = spaceAt === -1 ? '' : action.slice(spaceAt + 1)
    document.dispatchEvent(new CustomEvent(type, { detail }))
}

window.addEventListener('keydown', event => {
    if (!appLibraryMod(event)) return
    if (HOTKEY_MODAL_SELECTORS.some(selector => {
        const el = /** @type {HTMLElement | null} */ (document.querySelector(selector))
        return el !== null && !el.hidden
    })) return
    const digit = /^Digit([1-9])$/.exec(event.code)
    if (digit && event.ctrlKey && !event.shiftKey) {
        event.preventDefault()
        event.stopImmediatePropagation()
        document.dispatchEvent(new CustomEvent('omarchy:bar-panel', {
            detail: Number(digit[1]),
        }))
        return
    }
    const binding = HOTKEY_BINDINGS.find(row => row.code === event.code
        && row.ctrl === event.ctrlKey
        && row.shift === event.shiftKey
        && (!row.alt || (event.altKey && event.metaKey)))
    if (!binding) return
    event.preventDefault()
    event.stopImmediatePropagation()
    hotkeyDispatch(binding.action)
}, { capture: true })
