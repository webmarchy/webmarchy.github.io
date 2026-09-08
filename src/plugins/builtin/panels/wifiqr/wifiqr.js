/**
 * Wi-Fi QR plugin — the Wi-Fi share overlay, mirroring upstream
 * `omarchy.wifiqr` (`shell/plugins/panels/wifiqr/Panel.qml`): no card,
 * just the QR code floating on a heavy near-black scrim — the network
 * name letterspaced above the white code canvas, "Scan to join this
 * network" below, and a click-to-reveal password line. Esc or the
 * scrim dismiss it.
 *
 * Upstream reads the active connection's SSID and passphrase out of
 * NetworkManager (`omarchy-network-qr`); a browser can see neither, so
 * summoning opens with a small entry step on the same scrim — network
 * name and passphrase fields — and generates from what you type. The
 * code itself is real: {@link QrCode} encodes the standard
 * `WIFI:S:…;T:WPA;P:…;;` join payload (verified module-for-module
 * against a reference encoder), so scanning it genuinely joins the
 * network. Like upstream, the passphrase only lives in shell memory
 * while the card is up — closing clears both fields.
 *
 * Owns the `omarchy:wifiqr-toggle` action event (menu: Setup →
 * Network → QR Code).
 * @extends {Component}
 */
class WifiQrPanel extends Component {
    static template = `
        <div class="wifiqr" hidden data-ref="overlay"
             role="dialog" aria-modal="true" aria-label="Share Wi-Fi">
            <div class="wifiqr-content" data-ref="content">
                <div class="wifiqr-title" data-ref="title"></div>
                <form class="wifiqr-form" data-ref="form">
                    <input class="wifiqr-input" data-ref="ssidField"
                           placeholder="Network name" autocomplete="off" maxlength="32">
                    <input class="wifiqr-input" type="password" data-ref="passwordField"
                           placeholder="Passphrase (empty for open networks)"
                           autocomplete="off" maxlength="63">
                    <button type="submit" class="wifiqr-generate">Show QR code</button>
                </form>
                <canvas class="wifiqr-canvas" hidden data-ref="canvas"></canvas>
                <div class="wifiqr-error" hidden data-ref="error"></div>
                <div class="wifiqr-hint" hidden data-ref="hint">Scan to join this network</div>
                <button type="button" class="wifiqr-password" hidden data-ref="passwordReveal"></button>
            </div>
        </div>
    `

    /** @param {DocumentFragment} root */
    script(root) {
        const overlay = $(root, '[data-ref="overlay"]')
        const content = $(root, '[data-ref="content"]')
        const title = $(root, '[data-ref="title"]')
        const form = /** @type {HTMLFormElement} */ ($(root, '[data-ref="form"]'))
        const ssidField = /** @type {HTMLInputElement} */ ($(root, '[data-ref="ssidField"]'))
        const passwordField = /** @type {HTMLInputElement} */ ($(root, '[data-ref="passwordField"]'))
        const canvas = /** @type {HTMLCanvasElement} */ ($(root, '[data-ref="canvas"]'))
        const errorText = $(root, '[data-ref="error"]')
        const hint = $(root, '[data-ref="hint"]')
        const passwordReveal = /** @type {HTMLButtonElement} */ ($(root, '[data-ref="passwordReveal"]'))

        let password = ''
        let passwordVisible = false
        let showingQr = false

        const opened = () => !overlay.hidden

        function renderPasswordLine() {
            passwordReveal.hidden = !(showingQr && password !== '')
            passwordReveal.textContent = passwordVisible ? password : 'Show password'
            passwordReveal.classList.toggle('wifiqr-password-revealed', passwordVisible)
        }

        /** @param {string} ssid @param {string} passphrase */
        function generate(ssid, passphrase) {
            let matrix
            try {
                matrix = QrCode.encodeText(QrCode.wifiPayload(ssid, passphrase))
            } catch {
                errorText.textContent = 'Could not generate the Wi-Fi QR code'
                errorText.hidden = false
                return
            }
            // Integer-sized modules on a white canvas, upstream's exact
            // rendering: only the dark modules paint, and the baked
            // quiet zone keeps the code clear of the rounded corners.
            const moduleSize = Math.max(4, Math.floor(240 / matrix.size))
            const pixels = matrix.size * moduleSize
            const scale = window.devicePixelRatio || 1
            canvas.width = pixels * scale
            canvas.height = pixels * scale
            canvas.style.width = pixels + 'px'
            canvas.style.height = pixels + 'px'
            const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'))
            context.scale(scale, scale)
            context.fillStyle = 'white'
            context.fillRect(0, 0, pixels, pixels)
            context.fillStyle = '#111111'
            for (let r = 0; r < matrix.size; r++) {
                for (let c = 0; c < matrix.size; c++) {
                    if (matrix.rows[r].charAt(c) === '1') {
                        context.fillRect(c * moduleSize, r * moduleSize, moduleSize, moduleSize)
                    }
                }
            }

            showingQr = true
            password = passphrase
            passwordVisible = false
            title.textContent = (ssid || 'Wi-Fi').toUpperCase()
            form.hidden = true
            canvas.hidden = false
            hint.hidden = false
            errorText.hidden = true
            renderPasswordLine()
        }

        function open() {
            showingQr = false
            password = ''
            passwordVisible = false
            ssidField.value = ''
            passwordField.value = ''
            title.textContent = 'SHARE WI-FI'
            form.hidden = false
            canvas.hidden = true
            hint.hidden = true
            errorText.hidden = true
            renderPasswordLine()
            overlay.hidden = false
            ssidField.focus()
        }

        function close() {
            overlay.hidden = true
            // The passphrase only enters shell memory while the card is
            // up, exactly upstream's care with it.
            password = ''
            passwordVisible = false
            ssidField.value = ''
            passwordField.value = ''
        }

        function toggle() {
            if (opened()) close()
            else open()
        }

        form.addEventListener('submit', event => {
            event.preventDefault()
            const ssid = ssidField.value.trim()
            if (!ssid) {
                ssidField.focus()
                return
            }
            generate(ssid, passwordField.value)
        })

        passwordReveal.addEventListener('click', () => {
            passwordVisible = !passwordVisible
            renderPasswordLine()
        })

        overlay.addEventListener('mousedown', event => {
            if (!(event.target instanceof Node) || !content.contains(event.target)) close()
        })

        document.addEventListener('keydown', event => {
            if (!opened()) return
            if (event.key === 'Escape') {
                close()
                event.preventDefault()
                event.stopPropagation()
            } else if (showingQr) {
                event.preventDefault()
                event.stopPropagation()
            } else {
                // The entry step is normal form typing; only stop the
                // shell's own summons underneath.
                event.stopPropagation()
            }
        }, { capture: true })

        document.addEventListener('omarchy:wifiqr-toggle', () => toggle())
    }
}
