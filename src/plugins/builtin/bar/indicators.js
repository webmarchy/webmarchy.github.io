class IndicatorsBarWidget extends Component {
    static template = `
        <div class="bar-indicators" data-ref="host"></div>
    `

    /** @param {DocumentFragment} root */
    script(root) {
        const host = $(root, '[data-ref="host"]')

        const alwaysShow = Settings.get('indicators.alwaysShow', false) === true
        let revealed = false
        let hideTimer = 0

        let reminderCount = 0
        let reminderTooltip = 'Set Reminder'
        let nightLight = false
        let stayAwake = false

        const indicators = [
            {
                id: 'Reminder',
                glyph: '\u{F088C}',
                active: false,
                tooltip: () => reminderTooltip,
                press: () => document.dispatchEvent(new CustomEvent(
                    reminderCount > 0 ? 'omarchy:reminders-show' : 'omarchy:reminders-toggle')),
            },
            {
                id: 'NightLight',
                glyph: '\u{F050E}',
                active: false,
                tooltip: () => nightLight ? 'Day Light' : 'Night Light',
                press: () => document.dispatchEvent(new CustomEvent('omarchy:nightlight-toggle')),
            },
            {
                id: 'StayAwake',
                glyph: '\u{F0176}',
                active: false,
                tooltip: () => stayAwake ? 'Allow Idle Lock & Screensaver' : 'Stay Awake',
                press: () => document.dispatchEvent(new CustomEvent('omarchy:idle-toggle')),
            },
        ]

        const buttons = indicators.map(indicator => {
            const button = document.createElement('button')
            button.type = 'button'
            button.className = 'bar-indicator'
            button.textContent = indicator.glyph
            button.addEventListener('click', () => {
                button.blur()
                indicator.press()
            })
            host.appendChild(button)
            return button
        })

        function render() {
            indicators.forEach((indicator, index) => {
                const button = buttons[index]
                button.title = indicator.tooltip()
                button.classList.toggle('bar-indicator-active', indicator.active)
                button.classList.toggle('bar-indicator-concealed',
                    !indicator.active && !revealed && !alwaysShow)
            })
        }

        document.addEventListener('omarchy:reminders-changed', event => {
            const detail = /** @type {CustomEvent} */ (event).detail || {}
            reminderCount = Number(detail.count) || 0
            if (detail.tooltip) reminderTooltip = String(detail.tooltip)
            indicators[0].active = reminderCount > 0
            render()
        })
        document.addEventListener('omarchy:nightlight-changed', event => {
            nightLight = /** @type {CustomEvent} */ (event).detail === true
            indicators[1].active = nightLight
            render()
        })
        document.addEventListener('omarchy:idle-changed', event => {
            stayAwake = /** @type {CustomEvent} */ (event).detail === true
            indicators[2].active = stayAwake
            render()
        })

        /** @param {boolean} hovered */
        function setHovered(hovered) {
            clearTimeout(hideTimer)
            if (hovered) {
                if (!revealed) {
                    revealed = true
                    render()
                }
            } else {
                hideTimer = setTimeout(() => {
                    revealed = false
                    render()
                }, 120)
            }
        }

        document.addEventListener('mouseover', event => {
            const section = host.closest('.bar-section')
            if (!section) return
            setHovered(event.target instanceof Node && section.contains(event.target))
        })

        render()
    }
}

BAR_WIDGETS['omarchy.indicators'] = IndicatorsBarWidget
