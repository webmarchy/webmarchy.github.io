/** @extends {Component} */
class LockScreen extends Component {
    static template = `
        <div class="lock" hidden data-ref="overlay"
             role="dialog" aria-modal="true" aria-label="Lock screen">
            <div class="lock-wallpaper" data-ref="wallpaper"></div>
            <div class="lock-wash"></div>
            <div class="lock-card">
                <img class="lock-logo" alt="" data-ref="logo">
                <form class="lock-form" data-ref="form">
                    <span class="lock-glyph" data-ref="glyph" aria-hidden="true"></span>
                    <input class="lock-input" data-ref="input" type="password"
                           aria-label="Password" autocomplete="off">
                </form>
            </div>
        </div>
    `

    /** @param {DocumentFragment} root */
    script(root) {
        const overlay = $(root, '[data-ref="overlay"]')
        const wallpaper = $(root, '[data-ref="wallpaper"]')
        const logo = /** @type {HTMLImageElement} */ ($(root, '[data-ref="logo"]'))
        const form = $(root, '[data-ref="form"]')
        const input = /** @type {HTMLInputElement} */ ($(root, '[data-ref="input"]'))

        $(root, '[data-ref="glyph"]').textContent = '\u{F033E}'

        function unlockTheme() {
            const picked = String(Settings.get('lock.unlockTheme', '') || '')
            return Theme.names().includes(picked) ? picked : Theme.current
        }

        function open() {
            const url = Settings.get('background.current', Theme.backgrounds()[0] ?? '')
            wallpaper.style.backgroundImage = url ? `url("${url}")` : ''
            logo.src = `./src/themes/${unlockTheme()}/unlock.png`
            input.value = ''
            overlay.hidden = false
            input.focus()
        }

        document.addEventListener('omarchy:unlock-set', event => {
            Settings.set('lock.unlockTheme',
                String(/** @type {CustomEvent} */ (event).detail || ''))
        })

        function close() {
            overlay.hidden = true
        }

        document.addEventListener('omarchy:lock', () => {
            if (overlay.hidden) open()
        })

        form.addEventListener('submit', event => {
            event.preventDefault()
            if (input.value.length > 0) {
                close()
            } else {
                input.classList.remove('lock-input-shake')
                void input.offsetWidth
                input.classList.add('lock-input-shake')
            }
        })

        overlay.addEventListener('mousedown', () => input.focus())

        window.addEventListener('keydown', event => {
            if (overlay.hidden) return
            if (event.metaKey || event.altKey || event.ctrlKey) {
                event.preventDefault()
                event.stopImmediatePropagation()
            } else {
                event.stopImmediatePropagation()
            }
        }, { capture: true })
    }
}
