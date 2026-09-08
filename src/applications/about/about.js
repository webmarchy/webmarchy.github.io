/** @extends {Component} */
class About extends Component {
    static template = `
        <section class="about" data-ref="about">
            <pre class="about-logo" data-ref="logo"></pre>
            <div class="about-info">
                <section class="about-box">
                    <h2 class="about-box-title">Hardware</h2>
                    <ul class="about-rows" data-ref="hardware"></ul>
                </section>
                <section class="about-box">
                    <h2 class="about-box-title">Software</h2>
                    <ul class="about-rows" data-ref="software"></ul>
                </section>
                <section class="about-box">
                    <h2 class="about-box-title">Age / Uptime / Update</h2>
                    <ul class="about-rows" data-ref="vitals"></ul>
                </section>
            </div>
        </section>
    `

    /** @param {DocumentFragment} root */
    script(root) {
        const about = $(root, '[data-ref="about"]')
        const hardware = $(root, '[data-ref="hardware"]')
        const software = $(root, '[data-ref="software"]')
        const vitals = $(root, '[data-ref="vitals"]')

        $(root, '[data-ref="logo"]').textContent = OMARCHY_ASCII

        if (!Settings.get('about.installed', 0)) {
            Settings.set('about.installed', Date.now())
        }

        /**
         * @param {HTMLElement} list @param {string} icon
         * @param {string} label @param {string} value
         * @returns {HTMLElement}
         */
        function addRow(list, icon, label, value) {
            const li = document.createElement('li')
            li.className = 'about-row'
            const iconEl = document.createElement('span')
            iconEl.className = 'about-row-icon'
            iconEl.textContent = icon
            const labelEl = document.createElement('span')
            labelEl.className = 'about-row-label'
            labelEl.textContent = `${label}:`
            const valueEl = document.createElement('span')
            valueEl.className = 'about-row-value'
            valueEl.textContent = value
            li.append(iconEl, labelEl, valueEl)
            list.appendChild(li)
            return valueEl
        }

        function gpuName() {
            try {
                const gl = document.createElement('canvas').getContext('webgl')
                if (!gl) return 'unknown'
                const info = gl.getExtension('WEBGL_debug_renderer_info')
                return info
                    ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
                    : 'WebGL'
            } catch {
                return 'unknown'
            }
        }

        function engineVersion() {
            const ua = navigator.userAgent
            const match = ua.match(/(Chrome|Firefox)\/([\d.]+)/)
                || ua.match(/(Version)\/([\d.]+).*Safari/)
            if (!match) return 'unknown'
            return match[1] === 'Version' ? `Safari ${match[2]}` : `${match[1]} ${match[2]}`
        }

        /** @param {number} bytes */
        const gib = bytes => `${(bytes / 2 ** 30).toFixed(2)} GiB`

        addRow(hardware, '\u{f0322}', 'PC', navigator.platform || 'unknown')
        addRow(hardware, '\u{f061a}', 'CPU',
            `${navigator.hardwareConcurrency || '?'} cores`)
        addRow(hardware, '\u{f08ae}', 'GPU', gpuName())
        addRow(hardware, '\u{f0379}', 'Display',
            `${screen.width}x${screen.height} @ ${devicePixelRatio}x`)
        const disk = addRow(hardware, '\u{f02ca}', 'Disk', 'estimating…')
        navigator.storage?.estimate?.().then(estimate => {
            const usage = estimate.usage ?? 0
            const quota = estimate.quota ?? 0
            disk.textContent = quota
                ? `${gib(usage)} / ${gib(quota)} (${Math.round((usage / quota) * 100)}%) - origin`
                : 'unknown'
        }).catch(() => { disk.textContent = 'unknown' })
        const deviceMemory = /** @type {*} */ (navigator).deviceMemory
        addRow(hardware, '\u{f035b}', 'Memory',
            deviceMemory ? `${deviceMemory} GiB (browser-capped)` : 'unknown')

        addRow(software, '\u{f08c7}', 'OS', 'Omarchy Web (quattro port)')
        addRow(software, '\u{f059f}', 'Kernel', engineVersion())
        addRow(software, '\u{f056e}', 'WM', 'AppLibrary (dwindle)')
        addRow(software, '\u{f03d7}', 'Apps',
            `${AppLibrary.entries().length} (app-library)`)
        const themeName = String(Settings.get('theme.current', THEME_DEFAULT))
        const theme = addRow(software, '\u{f03d8}', 'Theme', `${themeName} `)
        const styles = getComputedStyle(document.documentElement)
        for (const key of ['red', 'yellow', 'green', 'cyan', 'blue',
            'magenta', 'foreground', 'muted']) {
            const dot = document.createElement('span')
            dot.className = 'about-dot'
            dot.style.background = styles.getPropertyValue(`--color-${key}`).trim()
            theme.appendChild(dot)
        }
        const family = getComputedStyle(document.body).fontFamily
            .split(',')[0].replace(/["']/g, '').trim()
        const size = styles.getPropertyValue('--font-size-base').trim()
        addRow(software, '\u{f031f}', 'Font', `${family} (${size})`)

        const installed = Number(Settings.get('about.installed', Date.now()))
        const days = Math.floor((Date.now() - installed) / 86400000)
        addRow(vitals, '\u{f051f}', 'OS Age', `${days} day${days === 1 ? '' : 's'}`)
        const minutes = Math.floor(performance.now() / 60000)
        const uptime = minutes >= 60
            ? `${Math.floor(minutes / 60)} hrs ${minutes % 60} mins`
            : `${minutes} mins`
        addRow(vitals, '\u{f0150}', 'Uptime', uptime)
        const modified = new Date(document.lastModified)
        const weekday = modified.toLocaleDateString('en-US', { weekday: 'long' })
        const month = modified.toLocaleDateString('en-US', { month: 'long' })
        const pad = (/** @param {number} n */ n) => String(n).padStart(2, '0')
        addRow(vitals, '\u{f06b0}', 'Update',
            `${weekday}, ${month} ${pad(modified.getDate())} ${modified.getFullYear()}`
            + ` at ${pad(modified.getHours())}:${pad(modified.getMinutes())}`)

        function disconnected() {
            if (about.isConnected) return false
            document.removeEventListener('keydown', onKey)
            return true
        }

        /** @param {KeyboardEvent} event */
        function onKey(event) {
            if (disconnected()) return
            if (!AppLibrary.focusedContains(about)) return
            if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return
            for (const selector of ['.menu', '.image-picker', '.keybindings',
                '.lock', '.screensaver', '.system-login']) {
                const el = /** @type {HTMLElement | null} */ (document.querySelector(selector))
                if (el && !el.hidden) return
            }
            if (event.key === 'q') {
                event.preventDefault()
                document.dispatchEvent(new CustomEvent('omarchy:app-close'))
            }
        }

        document.addEventListener('keydown', onKey)
    }
}

AppLibrary.register('about', {
    name: 'About',
    icon: '\u{f05a}',
    component: About,
    floating: { width: '75%', height: '62%' },
})
