/**
 * The Omarchy ASCII wordmark, copied verbatim from upstream `logo.txt`.
 * Rendered by the boot splash and the screensaver.
 */
const OMARCHY_ASCII = `                 ▄▄▄
 ▄█████▄    ▄███████████▄    ▄███████   ▄███████   ▄███████   ▄█   █▄    ▄█   █▄
███   ███  ███   ███   ███  ███   ███  ███   ███  ███   ███  ███   ███  ███   ███
███   ███  ███   ███   ███  ███   ███  ███   ███  ███   █▀   ███   ███  ███   ███
███   ███  ███   ███   ███ ▄███▄▄▄███ ▄███▄▄▄██▀  ███       ▄███▄▄▄███▄ ███▄▄▄███
███   ███  ███   ███   ███ ▀███▀▀▀███ ▀███▀▀▀▀    ███      ▀▀███▀▀▀███  ▀▀▀▀▀▀███
███   ███  ███   ███   ███  ███   ███ ██████████  ███   █▄   ███   ███  ▄██   ███
███   ███  ███   ███   ███  ███   ███  ███   ███  ███   ███  ███   ███  ███   ███
 ▀█████▀    ▀█   ███   █▀   ███   █▀   ███   ███  ███████▀   ███   █▀    ▀█████▀
                                       ███   █▀`

/**
 * System power plugin — in-browser simulations of Omarchy's power
 * states. Nothing touches the real machine; each flow reproduces the
 * *feel*:
 *
 * - `omarchy:suspend` — display sleeps (fade to black); any key or
 *   click wakes it instantly.
 * - `omarchy:shutdown` — fade to black, powered off; after a moment a
 *   dim power hint appears, and clicking "powers on" through the boot
 *   splash into a fresh session.
 * - `omarchy:hibernate` — like shutdown (state is already persisted via
 *   Settings, so waking "restores" the session), waking through the
 *   boot splash.
 * - `omarchy:reboot` — fade to black, then boot: the splash (Plymouth
 *   analog: black screen, the Omarchy ASCII wordmark, a spinner) shows
 *   over the freshly reloaded session and fades away.
 * - `omarchy:logout` — an SDDM-style login screen; Enter logs back in
 *   through a fresh session.
 *
 * Also owns the idle timers from upstream `config/omarchy/shell.json`
 * (`idle: { screensaver: 150, lock: 300 }`): after 150s without input
 * it dispatches `omarchy:screensaver`, after 300s `omarchy:lock`.
 * Stay-awake (upstream `omarchy-toggle-idle`, the omarchy.idle service
 * override) suspends both timers: `omarchy:idle-toggle` flips it,
 * persisted as `system.stayAwake` — the analog of upstream's
 * `~/.local/state/omarchy/indicators/stay-awake` state file — and every
 * change (and mount) is announced as `omarchy:idle-changed` with the
 * stay-awake state as detail, for the bar's StayAwake indicator.
 *
 * The pending-boot marker lives in sessionStorage (transient, per-tab —
 * not a Setting): set before `location.reload()`, consumed on load to
 * show the splash once.
 * @extends {Component}
 */
class SystemPower extends Component {
    static template = `
        <div data-ref="host">
            <div class="system-black" hidden data-ref="black">
                <p class="system-power-hint" hidden data-ref="hint">\u{f0425}  click to power on</p>
            </div>
            <div class="system-login" hidden data-ref="login">
                <form class="system-login-card" data-ref="login-form">
                    <p class="system-login-user">talha@omarchy</p>
                    <input class="system-login-input" data-ref="login-input" type="password"
                           placeholder="Enter Password" aria-label="Password">
                </form>
            </div>
            <div class="system-splash" hidden data-ref="splash">
                <pre class="system-splash-logo"></pre>
                <div class="system-splash-track">
                    <div class="system-splash-fill" data-ref="splash-fill"></div>
                </div>
            </div>
        </div>
    `

    /** @param {DocumentFragment} root */
    script(root) {
        const black = $(root, '[data-ref="black"]')
        const hint = $(root, '[data-ref="hint"]')
        const login = $(root, '[data-ref="login"]')
        const loginForm = $(root, '[data-ref="login-form"]')
        const loginInput = /** @type {HTMLInputElement} */ ($(root, '[data-ref="login-input"]'))
        const splash = $(root, '[data-ref="splash"]')
        $(root, '.system-splash-logo').textContent = OMARCHY_ASCII

        /** @type {'on' | 'suspended' | 'off' | 'off-bootable'} */
        let power = 'on'
        /** @type {ReturnType<typeof setTimeout> | undefined} */
        let hintTimer
        /** @type {ReturnType<typeof setTimeout> | undefined} */
        let hideTimer

        function fadeToBlack(interactive) {
            clearTimeout(hideTimer)
            black.hidden = false
            hint.hidden = true
            void black.offsetWidth
            black.classList.add('system-black-opaque')
            if (interactive) {
                hintTimer = setTimeout(() => { hint.hidden = false }, 2500)
            }
        }

        function wakeFromBlack() {
            clearTimeout(hintTimer)
            black.classList.remove('system-black-opaque')
            hint.hidden = true
            hideTimer = setTimeout(() => { black.hidden = true }, 400)
            power = 'on'
        }

        function bootReload() {
            try {
                sessionStorage.setItem('omarchy-boot', '1')
            } catch {
            }
            location.reload()
        }

        document.addEventListener('omarchy:suspend', () => {
            power = 'suspended'
            fadeToBlack(false)
        })
        document.addEventListener('omarchy:shutdown', () => {
            power = 'off'
            fadeToBlack(true)
        })
        document.addEventListener('omarchy:hibernate', () => {
            power = 'off'
            fadeToBlack(true)
        })
        document.addEventListener('omarchy:reboot', () => {
            power = 'off'
            fadeToBlack(false)
            setTimeout(bootReload, 900)
        })
        document.addEventListener('omarchy:logout', () => {
            login.hidden = false
            loginInput.value = ''
            loginInput.focus()
        })

        loginForm.addEventListener('submit', event => {
            event.preventDefault()
            bootReload()
        })

        window.addEventListener('keydown', event => {
            if (power === 'suspended') {
                event.preventDefault()
                event.stopImmediatePropagation()
                wakeFromBlack()
            } else if (power === 'off') {
                event.preventDefault()
                event.stopImmediatePropagation()
            }
        }, { capture: true })

        black.addEventListener('mousedown', () => {
            if (power === 'suspended') {
                wakeFromBlack()
            } else if (power === 'off') {
                power = 'off-bootable'
                bootReload()
            }
        })

        let bootPending = false
        try {
            bootPending = sessionStorage.getItem('omarchy-boot') === '1'
            sessionStorage.removeItem('omarchy-boot')
        } catch {
        }
        if (bootPending) {
            const fill = $(root, '[data-ref="splash-fill"]')
            splash.hidden = false
            void splash.offsetWidth
            fill.classList.add('system-splash-fill-boot')
            setTimeout(() => fill.classList.add('system-splash-fill-done'), 1000)
            setTimeout(() => {
                splash.classList.add('system-splash-fading')
                setTimeout(() => { splash.hidden = true }, 500)
            }, 1400)
        }

        const IDLE_SCREENSAVER_MS = 150 * 1000
        const IDLE_LOCK_MS = 300 * 1000
        /** @type {ReturnType<typeof setTimeout>} */
        let screensaverTimer
        /** @type {ReturnType<typeof setTimeout>} */
        let lockTimer
        let stayAwake = Settings.get('system.stayAwake', false) === true

        function resetIdleTimers() {
            clearTimeout(screensaverTimer)
            clearTimeout(lockTimer)
            if (power !== 'on' || stayAwake) return
            screensaverTimer = setTimeout(() => {
                document.dispatchEvent(new CustomEvent('omarchy:screensaver'))
            }, IDLE_SCREENSAVER_MS)
            lockTimer = setTimeout(() => {
                document.dispatchEvent(new CustomEvent('omarchy:lock'))
            }, IDLE_LOCK_MS)
        }
        for (const type of ['keydown', 'mousemove', 'mousedown', 'wheel']) {
            window.addEventListener(type, resetIdleTimers, { capture: true, passive: true })
        }

        function announceIdle() {
            document.dispatchEvent(new CustomEvent('omarchy:idle-changed', { detail: stayAwake }))
        }

        // Silent state change, like upstream's toggle — the StayAwake
        // indicator is the read-out.
        document.addEventListener('omarchy:idle-toggle', () => {
            stayAwake = !stayAwake
            Settings.set('system.stayAwake', stayAwake)
            resetIdleTimers()
            announceIdle()
        })

        resetIdleTimers()
        announceIdle()
    }
}
