/**
 * Speedtest plugin — the internet speed test, mirroring upstream
 * `omarchy.speedtest` (`shell/plugins/panels/speedtest/Panel.qml`, a
 * standalone summonable panel): the shared gauge cluster
 * ({@link SpeedTestOverlay}) dressed with download and upload dials in
 * Mbps, titled with the connection under test.
 *
 * Where upstream shells out to `omarchy-network-speedtest` (fast.com),
 * this port measures REAL throughput against Cloudflare's speed test
 * endpoints (CORS-open, `file://` included): the download phase
 * streams `speed.cloudflare.com/__down` counting received bytes, the
 * upload phase posts random payloads to `__up` tracking upload
 * progress — each phase runs upstream's five seconds, feeding the dial
 * a fresh Mbps figure a few times a second, then the run settles on
 * the phase averages. Summoning starts a fresh run; dismissing aborts
 * the traffic, so the workers never keep saturating the link behind a
 * closed overlay.
 *
 * The connection name: a payload naming one wins (the network panel
 * passes its own); otherwise `navigator.connection.type` where a
 * browser exposes it, else "Network".
 *
 * Owns the `omarchy:speedtest-toggle` action event (menu: Trigger →
 * Speed Test → Network Speed Test; the network panel's gauge button).
 * @extends {Component}
 */
class SpeedtestPanel extends Component {
    static template = `<div class="speedtest-host"></div>`

    /** @param {DocumentFragment} root */
    script(root) {
        const host = $(root, '.speedtest-host')

        const DOWN_URL = 'https://speed.cloudflare.com/__down?bytes=250000000'
        const UP_URL = 'https://speed.cloudflare.com/__up'
        const PHASE_MS = 5000

        let running = false
        /** @type {AbortController | null} */
        let controller = null
        /** @type {XMLHttpRequest | null} */
        let uploadRequest = null
        let runSeq = 0

        const overlay = mount(host, new SpeedTestOverlay({
            leftLabel: 'DOWNLOAD',
            rightLabel: 'UPLOAD',
            unit: 'Mbps',
            runAgainTooltip: 'Measure again',
            onClose: () => close(),
            onRunAgain: () => run(),
        }))

        function connectionName() {
            const type = String(/** @type {any} */(navigator).connection?.type || '')
            if (type === 'wifi') return 'Wi-Fi'
            if (type === 'ethernet') return 'Ethernet'
            return 'Network'
        }

        function stopTraffic() {
            if (controller) controller.abort()
            controller = null
            if (uploadRequest) uploadRequest.abort()
            uploadRequest = null
        }

        /**
         * Streams the download URL for the phase window, reporting Mbps
         * from bytes-so-far a few times a second.
         * @param {number} seq
         */
        async function downloadPhase(seq) {
            controller = new AbortController()
            const signal = controller.signal
            const started = performance.now()
            let bytes = 0
            const timer = setInterval(() => {
                const elapsed = (performance.now() - started) / 1000
                if (elapsed > 0.3) overlay.setValue('left', (bytes * 8) / elapsed / 1e6)
            }, 250)
            const stop = setTimeout(() => controller && controller.abort(), PHASE_MS)
            try {
                const response = await fetch(DOWN_URL, { cache: 'no-store', signal })
                if (!response.ok || !response.body) throw new Error('bad response')
                const reader = response.body.getReader()
                for (; ;) {
                    const { done, value } = await reader.read()
                    if (done) break
                    bytes += value.byteLength
                }
            } catch (error) {
                // The deliberate 5s abort is the normal end of the phase;
                // anything else with no bytes on the wire is a failure.
                if (!signal.aborted && bytes === 0) throw error
            } finally {
                clearInterval(timer)
                clearTimeout(stop)
                controller = null
            }
            if (seq !== runSeq) return
            const elapsed = Math.min(PHASE_MS / 1000, (performance.now() - started) / 1000)
            if (elapsed > 0) overlay.setValue('left', (bytes * 8) / elapsed / 1e6)
        }

        /**
         * Posts payloads back-to-back for the phase window; XHR because
         * only its upload channel reports progress.
         * @param {number} seq
         */
        function uploadPhase(seq) {
            return new Promise((resolve, reject) => {
                const payload = new Uint8Array(25 * 1024 * 1024)
                crypto.getRandomValues(payload.subarray(0, 65536))
                const started = performance.now()
                let settled = false
                let sentBefore = 0
                let sentCurrent = 0

                const report = () => {
                    const elapsed = (performance.now() - started) / 1000
                    if (elapsed > 0.3 && seq === runSeq) {
                        overlay.setValue('right', ((sentBefore + sentCurrent) * 8) / elapsed / 1e6)
                    }
                }
                const finish = () => {
                    if (settled) return
                    settled = true
                    clearTimeout(stop)
                    uploadRequest = null
                    report()
                    resolve(undefined)
                }
                const stop = setTimeout(() => {
                    if (uploadRequest) uploadRequest.abort()
                    finish()
                }, PHASE_MS)

                const send = () => {
                    if (settled || performance.now() - started >= PHASE_MS) {
                        finish()
                        return
                    }
                    const xhr = new XMLHttpRequest()
                    uploadRequest = xhr
                    xhr.open('POST', UP_URL)
                    xhr.upload.addEventListener('progress', event => {
                        sentCurrent = event.loaded
                        report()
                    })
                    xhr.addEventListener('loadend', () => {
                        sentBefore += sentCurrent
                        sentCurrent = 0
                        if (settled) return
                        if (xhr.status === 0 && sentBefore === 0) {
                            settled = true
                            clearTimeout(stop)
                            uploadRequest = null
                            reject(new Error('upload failed'))
                            return
                        }
                        send()
                    })
                    xhr.send(payload)
                }
                send()
            })
        }

        async function run() {
            const seq = ++runSeq
            stopTraffic()
            running = true
            overlay.setRunning(true)
            overlay.setValue('left', 0)
            overlay.setValue('right', 0)
            overlay.setLive('left', true)
            overlay.setLive('right', false)
            try {
                await downloadPhase(seq)
                if (seq !== runSeq) return
                overlay.setLive('left', false)
                overlay.setLive('right', true)
                await uploadPhase(seq)
                if (seq !== runSeq) return
            } catch {
                if (seq !== runSeq) return
                overlay.setError('Speed test failed')
            } finally {
                if (seq === runSeq) {
                    running = false
                    overlay.setRunning(false)
                }
            }
        }

        /** @param {*} detail */
        function open(detail) {
            overlay.setTitle(typeof detail === 'string' && detail.trim()
                ? detail.trim() : connectionName())
            overlay.openOverlay()
            run()
        }

        function close() {
            runSeq++
            stopTraffic()
            running = false
            overlay.setRunning(false)
            overlay.closeOverlay()
        }

        document.addEventListener('omarchy:speedtest-toggle', event => {
            if (overlay.openedOverlay()) close()
            else open(/** @type {CustomEvent} */(event).detail)
        })
    }
}
