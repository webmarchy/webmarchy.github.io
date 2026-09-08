/**
 * Screensaver plugin — the analog of Omarchy's terminal screensaver
 * (`omarchy-launch-screensaver`: a fullscreen terminal playing text
 * effects over the ASCII logo; users rebrand it via
 * `~/.config/omarchy/branding/screensaver.txt`). This port renders the
 * same ASCII wordmark on black and decodes it in with a scramble
 * effect, then pulses slowly — the terminal-text-effects feel without a
 * terminal.
 *
 * Summoned by `omarchy:screensaver` (System menu, and the idle timer in
 * the system plugin). Any key, click, or mouse move dismisses it; the
 * waking input is swallowed so it doesn't leak into the desktop.
 * @extends {Component}
 */
class Screensaver extends Component {
    static template = `
        <div class="screensaver" hidden data-ref="overlay" role="presentation">
            <pre class="screensaver-logo" data-ref="logo"></pre>
        </div>
    `

    /** @param {DocumentFragment} root */
    script(root) {
        const overlay = $(root, '[data-ref="overlay"]')
        const logo = $(root, '[data-ref="logo"]')

        const SCRAMBLE = '▁▂▃▄▅▆▇█▓▒░#%*+=-:.'
        /** @type {ReturnType<typeof setInterval> | undefined} */
        let decodeTimer

        function startDecode() {
            const target = OMARCHY_ASCII
            let revealed = 0
            const step = Math.max(4, Math.floor(target.length / 90))
            clearInterval(decodeTimer)
            decodeTimer = setInterval(() => {
                revealed += step
                if (revealed >= target.length) {
                    clearInterval(decodeTimer)
                    logo.textContent = target
                    logo.classList.add('screensaver-logo-pulse')
                    return
                }
                let scrambled = ''
                for (let i = revealed; i < target.length; i++) {
                    const ch = target[i]
                    scrambled += (ch === ' ' || ch === '\n')
                        ? ch
                        : SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)]
                }
                logo.textContent = target.slice(0, revealed) + scrambled
            }, 30)
        }

        function open() {
            overlay.hidden = false
            logo.classList.remove('screensaver-logo-pulse')
            startDecode()
        }

        function close() {
            clearInterval(decodeTimer)
            overlay.hidden = true
        }

        document.addEventListener('omarchy:screensaver', () => {
            if (overlay.hidden) open()
        })

        window.addEventListener('keydown', event => {
            if (overlay.hidden) return
            event.preventDefault()
            event.stopImmediatePropagation()
            close()
        }, { capture: true })

        overlay.addEventListener('mousedown', () => close())
        overlay.addEventListener('mousemove', () => {
            if (!overlay.hidden) close()
        })
    }
}
