/**
 * @extends {Component}
 */
class NetworkBarWidget extends Component {
    static template = `
        <div class="network">
            <button type="button" class="network-bar-widget bar-icon-button" data-ref="button"
                    title="Network" aria-haspopup="dialog" aria-expanded="false"></button>
            <div class="network-panel" hidden data-ref="panel"
                 role="dialog" aria-label="Network">
                <div class="network-hero">
                    <span class="network-hero-icon" data-ref="heroIcon"></span>
                    <div class="network-hero-labels">
                        <span class="network-hero-title" data-ref="heroTitle"></span>
                        <span class="network-hero-status" data-ref="heroStatus"></span>
                    </div>
                    <button type="button" class="network-hero-action" data-ref="speedtest"
                            title="Run a speed test"></button>
                </div>
                <div class="network-stats" data-ref="stats">
                    <span class="network-stat-label">Ping</span>
                    <span class="network-stat-value" data-ref="ping"></span>
                    <span class="network-stat-label">Packet Loss</span>
                    <span class="network-stat-value" data-ref="loss"></span>
                    <span class="network-stat-label">Receiving</span>
                    <span class="network-stat-value" data-ref="receiving"></span>
                    <span class="network-stat-label">Sending</span>
                    <span class="network-stat-value" data-ref="sending"></span>
                    <span class="network-stat-label">Downloaded</span>
                    <span class="network-stat-value" data-ref="downloaded"></span>
                    <span class="network-stat-label">Uploaded</span>
                    <span class="network-stat-value" data-ref="uploaded"></span>
                    <span class="network-stat-label">IP Address</span>
                    <span class="network-stat-value network-stat-copy" data-ref="ip"
                          title="Copy IP"></span>
                    <span class="network-stat-label">Gateway</span>
                    <span class="network-stat-value" data-ref="gateway"></span>
                </div>
                <div class="network-separator"></div>
                <div class="network-section">
                    <span class="network-section-title">DNS PROVIDER</span>
                    <div class="network-dns-row" data-ref="dnsRow"></div>
                </div>
            </div>
        </div>
    `

    /** @param {DocumentFragment} root */
    script(root) {
        const button = /** @type {HTMLButtonElement} */ ($(root, '[data-ref="button"]'))
        const panel = $(root, '[data-ref="panel"]')
        const heroIcon = $(root, '[data-ref="heroIcon"]')
        const heroTitle = $(root, '[data-ref="heroTitle"]')
        const heroStatus = $(root, '[data-ref="heroStatus"]')
        const speedtestButton = /** @type {HTMLButtonElement} */ ($(root, '[data-ref="speedtest"]'))
        const stats = $(root, '[data-ref="stats"]')
        const pingValue = $(root, '[data-ref="ping"]')
        const lossValue = $(root, '[data-ref="loss"]')
        const receivingValue = $(root, '[data-ref="receiving"]')
        const sendingValue = $(root, '[data-ref="sending"]')
        const downloadedValue = $(root, '[data-ref="downloaded"]')
        const uploadedValue = $(root, '[data-ref="uploaded"]')
        const ipValue = $(root, '[data-ref="ip"]')
        const gatewayValue = $(root, '[data-ref="gateway"]')
        const dnsRow = $(root, '[data-ref="dnsRow"]')

        speedtestButton.textContent = '\u{F04C5}'

        const CONNECTION_PHRASES = [
            'Wiring bits',
            'Handling packets',
            'Sorting frames',
            'Hauling bytes',
            'Routing crumbs',
            'Counting collisions',
            'Bending light',
        ]
        const DNS_PROVIDERS = ['DHCP', 'Cloudflare', 'Google', 'Custom']
        const DNS_TOOLTIPS = {
            DHCP: 'Use DNS from DHCP',
            Cloudflare: 'Set DNS to Cloudflare',
            Google: 'Set DNS to Google',
            Custom: 'Set custom DNS servers',
        }
        const PROBE_INTERVAL_MS = 1500
        const PING_HISTORY_WINDOW = 24
        const PING_AVERAGE_WINDOW = 5
        const PHRASE_INTERVAL_MS = 2800
        const PROBE_URL = 'https://speed.cloudflare.com/__down?bytes=0'

        let online = navigator.onLine
        let phraseIndex = 0
        /** @type {any} */ let pingState = null
        /** @type {any} */ let throughput = null
        let probeBusy = false
        let publicIp = ''
        let totalDownloaded = 0
        let probeTimer = 0
        let phraseTimer = 0
        let fadeTimer = 0

        const SECTIONS = ['header', 'dns']
        let focusSection = 'dns'
        let dnsIndex = 0
        let cursorActive = false

        const opened = () => !panel.hidden

        for (const entry of performance.getEntriesByType('navigation')) {
            totalDownloaded += /** @type {any} */ (entry).transferSize || 0
        }
        const transferObserver = new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
                totalDownloaded += /** @type {any} */ (entry).transferSize || 0
            }
        })
        transferObserver.observe({ type: 'resource', buffered: true })

        function connectionDetail() {
            const connection = /** @type {any} */ (navigator).connection
            const downlink = connection && Number(connection.downlink)
            return downlink && isFinite(downlink)
                ? NetworkModel.formatHeaderSpeed(Math.round(downlink)) : ''
        }

        function heroTitleText() {
            if (!online) return 'Disconnected'
            const detail = connectionDetail()
            return detail ? `Ethernet (${detail})` : 'Ethernet'
        }

        function dnsProvider() {
            const stored = String(Settings.get('network.dnsProvider', 'DHCP'))
            return DNS_PROVIDERS.includes(stored) ? stored : 'DHCP'
        }

        /** @param {number} ms */
        function feedPing(ms) {
            pingState = NetworkModel.pingLatencyState(pingState,
                { iface: 'internet', internet_ping_ms: ms },
                PING_HISTORY_WINDOW, PING_AVERAGE_WINDOW)
            renderStats()
        }

        function feedThroughput() {
            throughput = NetworkModel.throughputState(throughput,
                { iface: 'page', rx_bytes: totalDownloaded, tx_bytes: 0 },
                performance.now() / 1000)
            renderStats()
        }

        function probe() {
            if (probeBusy) return
            probeBusy = true
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 5000)
            const started = performance.now()
            fetch(PROBE_URL, { cache: 'no-store', signal: controller.signal })
                .then(response => {
                    publicIp = response.headers.get('cf-meta-ip') || publicIp
                    return response.arrayBuffer().then(() => {
                        feedPing(performance.now() - started)
                    })
                })
                .catch(() => feedPing(-1))
                .finally(() => {
                    clearTimeout(timeout)
                    probeBusy = false
                })
        }

        function tick() {
            probe()
            feedThroughput()
        }

        function statusText() {
            if (!online) return 'NOT CONNECTED'
            return CONNECTION_PHRASES[phraseIndex % CONNECTION_PHRASES.length].toUpperCase()
        }

        function rotatePhrase() {
            heroStatus.classList.add('network-hero-status-fading')
            clearTimeout(fadeTimer)
            fadeTimer = setTimeout(() => {
                phraseIndex = (phraseIndex + 1) % CONNECTION_PHRASES.length
                heroStatus.textContent = statusText()
                heroStatus.classList.remove('network-hero-status-fading')
            }, 180)
        }

        function renderHero() {
            const icon = online
                ? NetworkModel.connectionIcon('ethernet', -1, 'full')
                : NetworkModel.connectionIcon('disconnected', -1, 'none')
            button.textContent = icon
            heroIcon.textContent = icon
            heroTitle.textContent = heroTitleText()
            heroStatus.textContent = statusText()
            speedtestButton.classList.toggle('network-cursor',
                cursorActive && focusSection === 'header')
        }

        function renderStats() {
            stats.hidden = !online
            if (!online) return
            const ping = pingState || {}
            const hasSamples = (ping.internetPingSamples || []).length > 0
            const loss = Number(ping.internetPingPacketLoss || 0)
            pingValue.textContent = NetworkModel.formatPingLatency(
                ping.internetPingLatency, hasSamples)
            pingValue.classList.toggle('network-stat-urgent', hasSamples && loss > 0)
            lossValue.textContent = NetworkModel.formatPacketLoss(loss, hasSamples)
            lossValue.classList.toggle('network-stat-urgent', hasSamples && loss > 0)

            receivingValue.textContent = throughput
                ? NetworkModel.formatRate(throughput.downloadRate) : '--'
            downloadedValue.textContent = NetworkModel.formatBytes(totalDownloaded)
            sendingValue.textContent = '--'
            uploadedValue.textContent = '--'

            ipValue.textContent = publicIp || '--'
            gatewayValue.textContent = '--'
        }

        /** @type {HTMLButtonElement[]} */
        const pills = DNS_PROVIDERS.map((provider, index) => {
            const pill = document.createElement('button')
            pill.type = 'button'
            pill.className = 'network-pill'
            pill.textContent = provider
            pill.title = DNS_TOOLTIPS[/** @type {keyof typeof DNS_TOOLTIPS} */ (provider)]
            pill.addEventListener('click', () => setDnsProvider(provider))
            pill.addEventListener('mouseenter', () => {
                cursorActive = true
                focusSection = 'dns'
                dnsIndex = index
                renderDns()
                renderHero()
            })
            dnsRow.appendChild(pill)
            return pill
        })

        function renderDns() {
            const active = dnsProvider()
            pills.forEach((pill, index) => {
                pill.classList.toggle('network-pill-active', DNS_PROVIDERS[index] === active)
                pill.classList.toggle('network-cursor',
                    cursorActive && focusSection === 'dns' && dnsIndex === index)
            })
        }

        function render() {
            renderHero()
            renderStats()
            renderDns()
        }

        /** @param {string} provider */
        function setDnsProvider(provider) {
            Settings.set('network.dnsProvider', provider)
            renderDns()
        }

        function copyIp() {
            if (!publicIp) return
            navigator.clipboard?.writeText(publicIp)
            document.dispatchEvent(new CustomEvent('omarchy:clipboard-capture', { detail: publicIp }))
        }

        function runSpeedTest() {
            close()
            document.dispatchEvent(new CustomEvent('omarchy:speedtest-toggle'))
        }

        function refresh() {
            tick()
        }

        function open() {
            focusSection = 'dns'
            dnsIndex = DNS_PROVIDERS.indexOf(dnsProvider())
            if (dnsIndex < 0) dnsIndex = 0
            cursorActive = false
            pingState = null
            throughput = null
            render()
            panel.hidden = false
            button.setAttribute('aria-expanded', 'true')
            tick()
            probeTimer = setInterval(tick, PROBE_INTERVAL_MS)
            phraseTimer = setInterval(() => {
                if (online) rotatePhrase()
            }, PHRASE_INTERVAL_MS)
        }

        function close() {
            panel.hidden = true
            button.setAttribute('aria-expanded', 'false')
            clearInterval(probeTimer)
            clearInterval(phraseTimer)
            clearTimeout(fadeTimer)
            heroStatus.classList.remove('network-hero-status-fading')
        }

        function toggle() {
            if (opened()) close()
            else open()
        }

        /** @param {number} delta */
        function moveCursor(delta) {
            const index = SECTIONS.indexOf(focusSection)
            const next = index + delta
            if (next < 0 || next >= SECTIONS.length) return
            focusSection = SECTIONS[next]
            if (focusSection === 'dns') {
                dnsIndex = Math.max(0, DNS_PROVIDERS.indexOf(dnsProvider()))
            }
            renderHero()
            renderDns()
        }

        /** @param {number} delta */
        function moveCursorH(delta) {
            if (focusSection !== 'dns') return
            dnsIndex = Math.max(0, Math.min(pills.length - 1, dnsIndex + delta))
            renderDns()
        }

        function activateCursor() {
            if (focusSection === 'header') runSpeedTest()
            else setDnsProvider(DNS_PROVIDERS[dnsIndex])
        }

        button.addEventListener('click', () => {
            button.blur()
            toggle()
        })
        speedtestButton.addEventListener('click', () => runSpeedTest())
        speedtestButton.addEventListener('mouseenter', () => {
            cursorActive = true
            focusSection = 'header'
            renderHero()
            renderDns()
        })
        ipValue.addEventListener('click', () => copyIp())

        window.addEventListener('online', () => {
            online = true
            render()
        })
        window.addEventListener('offline', () => {
            online = false
            render()
        })

        dismissOnOutsideClick(opened, close,
            target => panel.contains(target) || button.contains(target))

        document.addEventListener('keydown', event => {
            if (!opened()) return
            for (const selector of ['.menu', '.image-picker', '.keybindings',
                '.lock', '.screensaver', '.system-login']) {
                const el = /** @type {HTMLElement | null} */ (document.querySelector(selector))
                if (el && !el.hidden) return
            }

            const key = event.key
            if (key === 'Escape') close()
            else if (key === 'ArrowUp' || key === 'k') activateOr(() => moveCursor(-1))
            else if (key === 'ArrowDown' || key === 'j') activateOr(() => moveCursor(1))
            else if (key === 'ArrowLeft' || key === 'h') activateOr(() => moveCursorH(-1))
            else if (key === 'ArrowRight' || key === 'l') activateOr(() => moveCursorH(1))
            else if (key === 'Enter') {
                if (cursorActive) activateCursor()
            }
            else if (key === 'r' || key === 'R') refresh()
            else return
            event.preventDefault()
            event.stopPropagation()
        })

        /**
         * @param {() => void} action
         */
        function activateOr(action) {
            if (!cursorActive) {
                cursorActive = true
                renderHero()
                renderDns()
                return
            }
            action()
        }

        document.addEventListener('omarchy:network-toggle', () => toggle())

        render()
    }
}

BAR_WIDGETS['omarchy.network'] = NetworkBarWidget
