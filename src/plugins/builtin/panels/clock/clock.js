/**
 * Clock defaults — the plugin's own shipped config, same keys as the
 * upstream widget entry in shell.json (each plugin owns its defaults;
 * persisted user overrides live in the `clock.*` Settings namespace).
 */
const CLOCK_CONFIG = Object.freeze({
    format: 'dddd HH:mm',
    formatAlt: "d MMMM 'W'ww yyyy",
    verticalFormat: 'HH\n—\nmm',
    verticalFormatAlt: "dd\nMMM\n'W'ww\n''yy",
})

/**
 * Clock plugin — the date/time bar widget and its calendar popup,
 * mirroring upstream `omarchy.clock` (`shell/plugins/panels/clock/`,
 * kind `bar-widget`; BarWidget.qml owns the bar label, Panel.qml the
 * popup — both live here since the panel is anchored to, and summoned
 * from, the label).
 *
 * The label: left click toggles the calendar — asking "what is the
 * date?" is what a click on a clock means — and right click walks the
 * common label formats (stacked-line variants on a vertical bar),
 * persisting the result so a cycled format is the format from then on.
 *
 * The calendar is a read-out rather than a picker: today is the only
 * marked day, and the only thing that moves is which month is on
 * screen — chevrons, the scroll wheel, arrow keys, and `[` `]` `{` `}`
 * all step it; `T`/Enter or clicking the hero date returns to today.
 * Above the grid, a year-progress rail; double-clicking it asks for a
 * birth year and life expectancy and adds the memento-mori rail
 * (double-click that to put it away). The grid's "W" heading toggles
 * the week start between Sunday and Monday; unset, it follows the
 * browser locale.
 *
 * Owns the `omarchy:clock-toggle` action event (the analog of
 * `omarchy-shell shell toggle omarchy.clock`) and the `clock.*`
 * settings namespace (`clock.format`, `clock.verticalFormat`,
 * `clock.weekStartDay`, `clock.birthYear`, `clock.lifeExpectancy`),
 * seeded from `CLOCK_CONFIG`. Registers as `omarchy.clock` in
 * {@link BAR_WIDGETS}.
 * @extends {Component}
 */
class ClockBarWidget extends Component {
    static template = `
        <div class="clock">
            <button type="button" class="clock-bar-widget" data-ref="button"
                    title="Right-click to toggle format"
                    aria-haspopup="dialog" aria-expanded="false"></button>
            <div class="clock-panel" hidden data-ref="panel"
                 role="dialog" aria-label="Calendar">
                <div class="clock-panel-content">
                    <div class="clock-hero" data-ref="hero">
                        <span class="clock-hero-glyph" data-ref="heroGlyph"></span>
                        <span class="clock-hero-date" data-ref="heroDate"></span>
                    </div>
                    <div class="clock-rail" data-ref="yearRail">
                        <span class="clock-rail-label" data-ref="yearLabel"></span>
                        <span class="clock-rail-track"><span class="clock-rail-fill" data-ref="yearFill"></span></span>
                        <span class="clock-rail-percent" data-ref="yearPercent"></span>
                    </div>
                    <div class="clock-life-edit" hidden data-ref="lifeEdit">
                        <label class="clock-rail-label" for="clock-born">BORN</label>
                        <input class="clock-input" id="clock-born" data-ref="bornField"
                               placeholder="year" inputmode="numeric" maxlength="4">
                        <label class="clock-rail-label" for="clock-live-to">LIVE TO</label>
                        <input class="clock-input" id="clock-live-to" data-ref="expectancyField"
                               placeholder="90" inputmode="numeric" maxlength="3">
                    </div>
                    <div class="clock-rail clock-life" hidden data-ref="lifeRail" title="Memento Mori">
                        <span class="clock-rail-label">LIFE</span>
                        <span class="clock-rail-track"><span class="clock-rail-fill" data-ref="lifeFill"></span></span>
                        <span class="clock-rail-percent" data-ref="lifePercent"></span>
                    </div>
                    <div class="clock-grid" data-ref="grid"></div>
                    <div class="clock-nav">
                        <button type="button" class="clock-nav-button" data-ref="prev"
                                title="Previous month"></button>
                        <span class="clock-nav-label" data-ref="navLabel"></span>
                        <button type="button" class="clock-nav-button" data-ref="next"
                                title="Next month"></button>
                    </div>
                </div>
            </div>
        </div>
    `

    /** @param {DocumentFragment} root */
    script(root) {
        const button = /** @type {HTMLButtonElement} */ ($(root, '[data-ref="button"]'))
        const panel = $(root, '[data-ref="panel"]')
        const hero = $(root, '[data-ref="hero"]')
        const heroDate = $(root, '[data-ref="heroDate"]')
        const yearRail = $(root, '[data-ref="yearRail"]')
        const yearLabel = $(root, '[data-ref="yearLabel"]')
        const yearFill = $(root, '[data-ref="yearFill"]')
        const yearPercent = $(root, '[data-ref="yearPercent"]')
        const lifeEdit = $(root, '[data-ref="lifeEdit"]')
        const bornField = /** @type {HTMLInputElement} */ ($(root, '[data-ref="bornField"]'))
        const expectancyField = /** @type {HTMLInputElement} */ ($(root, '[data-ref="expectancyField"]'))
        const lifeRail = $(root, '[data-ref="lifeRail"]')
        const lifeFill = $(root, '[data-ref="lifeFill"]')
        const lifePercent = $(root, '[data-ref="lifePercent"]')
        const grid = $(root, '[data-ref="grid"]')
        const navLabel = $(root, '[data-ref="navLabel"]')

        // Nerd Font glyphs, same codepoints as upstream (calendar mark,
        // chevrons), set here rather than in the template so the file
        // survives any non-UTF-8 round trip.
        $(root, '[data-ref="heroGlyph"]').textContent = '\u{F00ED}'
        const prevButton = $(root, '[data-ref="prev"]')
        const nextButton = $(root, '[data-ref="next"]')
        prevButton.textContent = '\u{F0141}'
        nextButton.textContent = '\u{F0142}'

        // ---- State. `today` is re-read on every tick so the highlight
        //      rolls over at midnight without the panel being reopened;
        //      the view month is the only other thing that moves.
        let today = new Date()
        let todayKey = ClockModel.keyForDate(today)
        let viewYear = today.getFullYear()
        let viewMonth = today.getMonth()
        let editingLife = false
        let tickTimer = 0

        // The bar mirrors its position onto `<html data-bar-position>`
        // before mounting widgets, so this is readable from the start and
        // stays current through `omarchy:bar-position`.
        function vertical() {
            const position = document.documentElement.dataset.barPosition
            return position === 'left' || position === 'right'
        }

        function activeFormat() {
            return vertical()
                ? String(Settings.get('clock.verticalFormat', CLOCK_CONFIG.verticalFormat))
                : String(Settings.get('clock.format', CLOCK_CONFIG.format))
        }

        function weekStart() {
            return ClockModel.normalizedWeekStart(
                Settings.get('clock.weekStartDay', null), ClockModel.localeFirstDay())
        }

        function viewingCurrentMonth() {
            return viewYear === today.getFullYear() && viewMonth === today.getMonth()
        }

        const opened = () => !panel.hidden

        // ---- Bar label ------------------------------------------------

        function renderLabel() {
            const lines = ClockModel.formatDateTime(today, activeFormat()).split('\n')
            button.textContent = ''
            for (const line of lines) {
                const span = document.createElement('span')
                span.className = 'clock-line'
                span.textContent = line
                button.appendChild(span)
            }
        }

        // A seconds label needs the clock to tick sixty times as often,
        // and a repaint a second is a price only the formats that print
        // seconds pay — everything else realigns to the next minute.
        function scheduleTick() {
            clearTimeout(tickTimer)
            const now = new Date()
            const delay = ClockModel.clockNeedsSeconds(activeFormat())
                ? 1000 - now.getMilliseconds()
                : (60 - now.getSeconds()) * 1000 - now.getMilliseconds()
            tickTimer = setTimeout(tick, Math.max(delay, 50))
        }

        function tick() {
            today = new Date()
            const key = ClockModel.keyForDate(today)
            if (key !== todayKey) {
                todayKey = key
                if (viewingCurrentMonth()) goToToday()
                else if (opened()) renderPanel()
            }
            renderLabel()
            scheduleTick()
        }

        function cycleFormat() {
            const key = vertical() ? 'clock.verticalFormat' : 'clock.format'
            const alt = vertical() ? CLOCK_CONFIG.verticalFormatAlt : CLOCK_CONFIG.formatAlt
            const ring = ClockModel.clockFormatRing(
                activeFormat(), alt, ClockModel.clockFormats(vertical()))
            const next = ClockModel.nextClockFormat(ring, activeFormat())
            if (next === '' || next === activeFormat()) return
            Settings.set(key, next)
            renderLabel()
            scheduleTick()
        }

        // ---- Calendar panel -------------------------------------------

        function renderPanel() {
            heroDate.textContent = ClockModel.formatDateTime(today, 'MMMM d')
            hero.classList.toggle('clock-hero-link', !viewingCurrentMonth())
            hero.title = viewingCurrentMonth() ? '' : 'Back to today'

            // Pinned to today, not to the month being browsed — stepping
            // through the calendar does not change how much of the year
            // is gone.
            yearLabel.textContent = String(today.getFullYear())
            const yearDone = ClockModel.yearProgress(
                today.getFullYear(), today.getMonth(), today.getDate())
            yearFill.style.width = (yearDone * 100).toFixed(2) + '%'
            yearPercent.textContent = ClockModel.yearProgressPercent(
                today.getFullYear(), today.getMonth(), today.getDate()) + '%'

            const birthYear = ClockModel.parseBirthYear(
                Settings.get('clock.birthYear', 0), today.getFullYear())
            const age = ClockModel.ageFromBirthYear(birthYear, today.getFullYear())
            const expectancy = Settings.get('clock.lifeExpectancy', 0)
            lifeRail.hidden = birthYear <= 0
            lifeFill.style.width = (ClockModel.lifeProgress(age, expectancy) * 100).toFixed(2) + '%'
            lifePercent.textContent = ClockModel.lifeProgressPercent(age, expectancy) + '%'

            renderGrid()
            navLabel.textContent = ClockModel.formatDateTime(
                new Date(viewYear, viewMonth, 1), 'MMMM yyyy').toUpperCase()
        }

        function renderGrid() {
            const start = weekStart()
            grid.textContent = ''

            // Header band: the week-number heading doubles as the
            // week-start toggle — the one control in the panel whose
            // meaning is not self-evident, so it carries a tooltip naming
            // the day the click will switch to.
            const toggle = document.createElement('button')
            toggle.type = 'button'
            toggle.className = 'clock-wk-toggle'
            toggle.textContent = 'W'
            toggle.title = 'Start weeks on '
                + ClockModel.DAYS_LONG[ClockModel.toggledWeekStart(start)]
            toggle.addEventListener('click', () => toggleWeekStart())
            grid.appendChild(toggle)
            grid.appendChild(gutterCell(true))
            for (const weekday of ClockModel.weekdayOrder(start)) {
                const label = document.createElement('span')
                label.className = 'clock-dow'
                label.textContent = ClockModel.DAYS_SHORT[weekday].toUpperCase()
                grid.appendChild(label)
            }

            for (const week of ClockModel.monthGrid(viewYear, viewMonth, start, todayKey)) {
                const number = document.createElement('span')
                number.className = 'clock-wk'
                number.textContent = String(week.week)
                grid.appendChild(number)
                grid.appendChild(gutterCell(false))
                for (const day of week.days) {
                    const cell = document.createElement('span')
                    cell.className = 'clock-day'
                    // Today is outlined, not filled: a lit-up block shouts
                    // over a grid this quiet.
                    if (day.today) cell.classList.add('clock-day-today')
                    if (!day.inMonth) cell.classList.add('clock-day-out')
                    else if (day.weekend) cell.classList.add('clock-day-weekend')
                    cell.textContent = String(day.day)
                    grid.appendChild(cell)
                }
            }
        }

        /**
         * Spacer between the week numbers and the days; the day rows'
         * spacers carry the hairline, so it does not cut through the
         * header band.
         * @param {boolean} header
         */
        function gutterCell(header) {
            const cell = document.createElement('span')
            cell.className = header ? 'clock-gutter' : 'clock-gutter clock-gutter-rule'
            return cell
        }

        function goToToday() {
            viewYear = today.getFullYear()
            viewMonth = today.getMonth()
            if (opened()) renderPanel()
        }

        /** @param {number} delta */
        function moveMonth(delta) {
            const next = ClockModel.stepMonth(viewYear, viewMonth, delta)
            viewYear = next.year
            viewMonth = next.month
            renderPanel()
        }

        /** @param {number} delta */
        function moveYear(delta) {
            moveMonth(delta * 12)
        }

        function toggleWeekStart() {
            const next = ClockModel.toggledWeekStart(weekStart())
            Settings.set('clock.weekStartDay', ClockModel.weekStartSettingName(next))
            if (opened()) renderPanel()
        }

        function open() {
            today = new Date()
            todayKey = ClockModel.keyForDate(today)
            goToToday()
            renderPanel()
            panel.hidden = false
            button.setAttribute('aria-expanded', 'true')
        }

        function close() {
            // Dismissing the panel mid-edit would otherwise leave the
            // inputs up, waiting behind a closed popup for the next time
            // it opens.
            if (editingLife) cancelEditingLife()
            panel.hidden = true
            button.setAttribute('aria-expanded', 'false')
        }

        function toggle() {
            if (opened()) close()
            else open()
        }

        // ---- Memento mori editing -------------------------------------

        function startEditingLife() {
            editingLife = true
            const birthYear = ClockModel.parseBirthYear(
                Settings.get('clock.birthYear', 0), today.getFullYear())
            bornField.value = birthYear > 0 ? String(birthYear) : ''
            expectancyField.value = String(
                ClockModel.parseLifeExpectancy(Settings.get('clock.lifeExpectancy', 0)))
            yearRail.hidden = true
            lifeEdit.hidden = false
            bornField.select()
            bornField.focus()
        }

        function cancelEditingLife() {
            editingLife = false
            lifeEdit.hidden = true
            yearRail.hidden = false
        }

        function commitLife() {
            const born = ClockModel.parseBirthYear(bornField.value, today.getFullYear())
            const span = ClockModel.parseLifeExpectancy(expectancyField.value)
            Settings.set('clock.birthYear', born)
            // The expectancy stays put on a clear, so setting a birth year
            // again brings your own number back rather than the default.
            Settings.set('clock.lifeExpectancy', span)
            cancelEditingLife()
            renderPanel()
        }

        /**
         * Shared by both fields: Tab hops to the other one, Enter commits
         * the pair, Escape drops the lot.
         * @param {KeyboardEvent} event
         * @param {HTMLInputElement} other
         */
        function handleLifeKey(event, other) {
            event.stopPropagation()
            if (event.key === 'Escape') {
                cancelEditingLife()
                event.preventDefault()
            } else if (event.key === 'Enter') {
                commitLife()
                event.preventDefault()
            } else if (event.key === 'Tab') {
                other.select()
                other.focus()
                event.preventDefault()
            }
        }

        function clearLife() {
            const birthYear = ClockModel.parseBirthYear(
                Settings.get('clock.birthYear', 0), today.getFullYear())
            if (birthYear <= 0) return
            Settings.set('clock.birthYear', 0)
            renderPanel()
        }

        // ---- Wiring ---------------------------------------------------

        button.addEventListener('click', () => {
            button.blur()
            toggle()
        })
        button.addEventListener('contextmenu', event => {
            event.preventDefault()
            cycleFormat()
        })

        hero.addEventListener('click', () => {
            if (!viewingCurrentMonth()) goToToday()
        })
        prevButton.addEventListener('click', () => moveMonth(-1))
        nextButton.addEventListener('click', () => moveMonth(1))
        yearRail.addEventListener('dblclick', () => startEditingLife())
        lifeRail.addEventListener('dblclick', () => clearLife())
        bornField.addEventListener('keydown', event => handleLifeKey(event, expectancyField))
        expectancyField.addEventListener('keydown', event => handleLifeKey(event, bornField))

        grid.addEventListener('wheel', event => {
            // Horizontal wheels and touchpad side-scrolls report
            // deltaY === 0; without this they would every one read as a
            // month step.
            if (event.deltaY === 0) return
            event.preventDefault()
            moveMonth(event.deltaY > 0 ? 1 : -1)
        }, { passive: false })

        dismissOnOutsideClick(opened, close,
            target => panel.contains(target) || button.contains(target))

        document.addEventListener('keydown', event => {
            if (!opened() || editingLife) return
            // A fullscreen surface above the panel owns the keyboard.
            for (const selector of ['.menu', '.image-picker', '.keybindings',
                '.lock', '.screensaver', '.system-login']) {
                const el = /** @type {HTMLElement | null} */ (document.querySelector(selector))
                if (el && !el.hidden) return
            }

            if (event.key === 'Escape') close()
            else if (event.key === 'ArrowLeft' || event.key === '[') moveMonth(-1)
            else if (event.key === 'ArrowRight' || event.key === ']') moveMonth(1)
            else if (event.key === 'ArrowUp' || event.key === '{') moveYear(-1)
            else if (event.key === 'ArrowDown' || event.key === '}') moveYear(1)
            else if (event.key === 't' || event.key === 'T' || event.key === 'Enter') goToToday()
            else if (event.key === 'w' || event.key === 'W') toggleWeekStart()
            else return
            event.preventDefault()
            event.stopPropagation()
        })

        document.addEventListener('omarchy:clock-toggle', () => toggle())
        document.addEventListener('omarchy:bar-position', () => {
            // Orientation changes the format family; the panel re-anchors
            // through CSS on its own.
            renderLabel()
            scheduleTick()
        })

        renderLabel()
        scheduleTick()
    }
}

BAR_WIDGETS['omarchy.clock'] = ClockBarWidget
