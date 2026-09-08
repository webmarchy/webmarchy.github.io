/**
 * Power plugin — the battery bar widget and panel, mirroring upstream
 * `omarchy.power` (`shell/plugins/panels/power/Panel.qml`, kind
 * `bar-widget`): a battery glyph in the bar whose panel shows the hero
 * read-out, a charge bar, and the stat pairs.
 *
 * Data is the browser's real Battery API (`navigator.getBattery`):
 * level, charging, and the time-to-full / time-left estimates, updated
 * through the API's own change events. Where upstream reads UPower and
 * sysfs (battery size, cycle count, charge rate, charge thresholds),
 * a browser sees nothing — those stats render upstream's own "—"
 * placeholder. Upstream's POWER PROFILE picker
 * (`omarchy-powerprofiles-set`) has no browser analog at all and is
 * not rendered, the same honest omission as the monitor panel's fixed
 * brightness. Without the API (Safari, Firefox) the widget hides
 * entirely, upstream's own no-battery state.
 *
 * The hero status line rotates upstream's exact agent-flavored phrases
 * while current flows (2.8s fade cycle), and reads "Fully charged" /
 * "Charging" / "On battery" otherwise. The bar button: left-click
 * toggles the panel, right-click toggles the percentage readout beside
 * the glyph (persisted, upstream's togglePercentage).
 *
 * Owns the `power.*` settings namespace (`power.showPercentage`) and
 * the `omarchy:power-toggle` action event. Registers as
 * `omarchy.power` in {@link BAR_WIDGETS}.
 * @extends {Component}
 */
class PowerBarWidget extends Component {
    static template = `
        <div class="power">
            <button type="button" class="power-bar-widget bar-icon-button" hidden data-ref="button"
                    title="Right-click to toggle percentage"
                    aria-haspopup="dialog" aria-expanded="false"></button>
            <div class="power-panel" hidden data-ref="panel"
                 role="dialog" aria-label="Battery">
                <div class="power-hero">
                    <span class="power-hero-icon" data-ref="heroIcon"></span>
                    <div class="power-hero-labels">
                        <span class="power-hero-title">Battery</span>
                        <span class="power-hero-status" data-ref="heroStatus"></span>
                    </div>
                    <span class="power-hero-percent" data-ref="heroPercent"></span>
                </div>
                <div class="power-track">
                    <div class="power-fill" data-ref="fill"></div>
                </div>
                <div class="power-stats">
                    <div class="power-stats-column">
                        <div class="power-pair">
                            <span class="power-pair-label">Battery size</span>
                            <span class="power-pair-value">—</span>
                        </div>
                        <div class="power-pair">
                            <span class="power-pair-label">Charge cycles</span>
                            <span class="power-pair-value">—</span>
                        </div>
                    </div>
                    <div class="power-stats-column">
                        <div class="power-pair">
                            <span class="power-pair-label" data-ref="timeLabel"></span>
                            <span class="power-pair-value" data-ref="timeValue"></span>
                        </div>
                        <div class="power-pair">
                            <span class="power-pair-label" data-ref="rateLabel"></span>
                            <span class="power-pair-value">—</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `

    /** @param {DocumentFragment} root */
    script(root) {
        const button = /** @type {HTMLButtonElement} */ ($(root, '[data-ref="button"]'))
        const panel = $(root, '[data-ref="panel"]')
        const heroIcon = $(root, '[data-ref="heroIcon"]')
        const heroStatus = $(root, '[data-ref="heroStatus"]')
        const heroPercent = $(root, '[data-ref="heroPercent"]')
        const fill = $(root, '[data-ref="fill"]')
        const timeLabel = $(root, '[data-ref="timeLabel"]')
        const timeValue = $(root, '[data-ref="timeValue"]')
        const rateLabel = $(root, '[data-ref="rateLabel"]')

        // Upstream's exact hero phrases, rotated while current flows.
        const CHARGING_PHRASES = ['Pumping power', 'Injecting electrons', 'Pouring juice',
            'Amassing watts', 'Hoarding joules', 'Sucking volts', 'Topping reserves',
            'Soaking amps', 'Inhaling kilowatts']
        const ON_BATTERY_PHRASES = ['Slurping power', 'Spending joules', 'Draining watts',
            'Burning electrons', 'Sipping juice', 'Spending coulombs', 'Bleeding amps',
            'Guzzling volts', 'Munching reserves']

        /** @type {any} The BatteryManager, once the API resolves. */
        let battery = null
        let phraseIndex = 0
        /** @type {ReturnType<typeof setInterval> | undefined} */
        let phraseTimer

        const opened = () => !panel.hidden
        const showPercentage = () => Settings.get('power.showPercentage', false) === true
        const fraction = () => battery ? PowerModel.batteryFraction(battery.level) : 0
        const charging = () => !!(battery && battery.charging)
        const full = () => charging() && fraction() >= 1

        function activePhrases() {
            if (full()) return []
            if (charging()) return CHARGING_PHRASES
            return ON_BATTERY_PHRASES
        }

        function heroStatusText() {
            const phrases = activePhrases()
            if (phrases.length > 0) return phrases[phraseIndex % phrases.length]
            return PowerModel.modeLabel(charging(), full())
        }

        function renderButton() {
            const glyph = PowerModel.batteryIcon(fraction(), charging(), full())
            const vertical = ['left', 'right']
                .includes(document.documentElement.dataset.barPosition || '')
            const wide = showPercentage() && !vertical
            button.textContent = wide
                ? Math.round(fraction() * 100) + '% ' + glyph
                : glyph
            // The percentage readout outgrows the fixed icon slot;
            // upstream widens the slot rather than clipping.
            button.classList.toggle('bar-icon-button-wide', wide)
        }

        function render() {
            renderButton()
            heroIcon.textContent = PowerModel.batteryIcon(fraction(), charging(), full())
            heroStatus.textContent = heroStatusText().toUpperCase()
            heroPercent.textContent = battery ? Math.round(fraction() * 100) + '%' : '—'
            fill.style.width = (fraction() * 100).toFixed(1) + '%'
            fill.classList.toggle('power-fill-charging', charging() && !full() && opened())

            timeLabel.textContent = charging() ? 'Time to full' : 'Time left'
            timeValue.textContent = battery
                ? PowerModel.formatDuration(charging() ? battery.chargingTime : battery.dischargingTime)
                : '—'
            rateLabel.textContent = charging() ? 'Charging' : 'Discharging'
        }

        // The changeover fades so it reads as one organism rather than a
        // hard cut, as upstream animates it.
        function rotatePhrase() {
            const phrases = activePhrases()
            if (phrases.length === 0) {
                heroStatus.classList.remove('power-status-fading')
                return
            }
            heroStatus.classList.add('power-status-fading')
            setTimeout(() => {
                phraseIndex = (phraseIndex + 1) % phrases.length
                heroStatus.textContent = heroStatusText().toUpperCase()
                heroStatus.classList.remove('power-status-fading')
            }, 180)
        }

        function open() {
            if (!battery) return
            panel.hidden = false
            button.setAttribute('aria-expanded', 'true')
            render()
            clearInterval(phraseTimer)
            phraseTimer = setInterval(rotatePhrase, 2800)
        }

        function close() {
            panel.hidden = true
            button.setAttribute('aria-expanded', 'false')
            clearInterval(phraseTimer)
        }

        function toggle() {
            if (opened()) close()
            else open()
        }

        button.addEventListener('click', () => {
            button.blur()
            toggle()
        })
        button.addEventListener('contextmenu', event => {
            event.preventDefault()
            Settings.set('power.showPercentage', !showPercentage())
            renderButton()
        })

        dismissOnOutsideClick(opened, close,
            target => panel.contains(target) || button.contains(target))

        document.addEventListener('keydown', event => {
            if (!opened()) return
            // A fullscreen surface above the panel owns the keyboard.
            for (const selector of ['.menu', '.image-picker', '.keybindings',
                '.lock', '.screensaver', '.system-login']) {
                const el = /** @type {HTMLElement | null} */ (document.querySelector(selector))
                if (el && !el.hidden) return
            }
            if (event.key !== 'Escape') return
            close()
            event.preventDefault()
            event.stopPropagation()
        })

        document.addEventListener('omarchy:power-toggle', () => toggle())
        document.addEventListener('omarchy:bar-position', () => renderButton())

        // Without the Battery API the widget stays hidden — upstream's
        // own batteryPresent gate.
        const getBattery = /** @type {any} */ (navigator).getBattery
        if (typeof getBattery === 'function') {
            getBattery.call(navigator).then((/** @type {any} */ manager) => {
                battery = manager
                button.hidden = false
                for (const type of ['levelchange', 'chargingchange',
                    'chargingtimechange', 'dischargingtimechange']) {
                    manager.addEventListener(type, () => render())
                }
                render()
            }).catch(() => { })
        }
    }
}

BAR_WIDGETS['omarchy.power'] = PowerBarWidget
