/**
 * Pure date and format math for the clock widget and its calendar panel —
 * a direct port of upstream `shell/plugins/panels/clock/Model.js`, kept
 * DOM-free for the same reason upstream keeps it Qt-free. What upstream
 * delegates to `Qt.formatDateTime` / `Qt.locale()` is reimplemented here
 * ({@link ClockModel.formatDateTime}, the name tables), since the
 * interface is English throughout either way.
 *
 * Everything lives on the single `ClockModel` namespace to keep the
 * shared global scope down to one name.
 */
const ClockModel = {
    MS_PER_DAY: 86400000,

    // Weekday indices match JS Date.getDay(): 0 = Sunday … 6 = Saturday.
    WEEKDAY_NAMES: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],

    // English names, matching the rest of the interface — where the week
    // *starts* is still a regional convention (see localeFirstDay), but
    // what a month is called is not taken from the system locale.
    MONTHS_LONG: ['January', 'February', 'March', 'April', 'May', 'June', 'July',
        'August', 'September', 'October', 'November', 'December'],
    MONTHS_SHORT: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    DAYS_LONG: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    DAYS_SHORT: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],

    // ---- Bar label formats (Qt format-token syntax, same strings as
    //      upstream so a config carries over verbatim). Right-clicking the
    //      clock walks these in order and persists the result, so the
    //      label the bar shows and the format the settings store are
    //      always the same thing.
    //
    // The locale-shaped time presets are each followed by their 12-hour
    // twin, so the walk from a 24-hour label to the same label in AM/PM
    // is a single right click rather than a lap of the ring. The ISO
    // preset is deliberately left without one: ISO 8601 writes time on a
    // 24-hour clock, so an AM/PM variant would contradict the only thing
    // that format is for.
    CLOCK_FORMATS: [
        'dddd HH:mm',
        'dddd h:mm AP',
        'dddd HH:mm:ss',
        'dddd h:mm:ss AP',
        'HH:mm',
        'h:mm AP',
        'ddd d MMM HH:mm',
        'ddd d MMM h:mm AP',
        "d MMMM 'W'ww yyyy",
        'yyyy-MM-dd HH:mm',
    ],

    // Vertical bars have room for a few stacked lines and nothing else,
    // so the ring stays short. AM/PM costs a fourth line, which is why
    // only the plain time carries it here.
    VERTICAL_CLOCK_FORMATS: [
        'HH\n—\nmm',
        'h\n—\nmm\nAP',
        "dd\nMMM\n'W'ww\n''yy",
        'HH\nmm',
    ],

    /**
     * Whether a format prints seconds, so the widget can tick once a
     * second only for the formats that show them. Quoted literals go
     * first: the s in a 'Sat' is text rather than a token, and an opening
     * quote with no closing one runs to the end of the format the way Qt
     * reads it.
     * @param {*} format
     */
    clockNeedsSeconds(format) {
        const text = String(format ?? '')
        return /s/.test(text.replace(/'[^']*'?/g, ''))
    },

    /** @param {boolean} vertical */
    clockFormats(vertical) {
        return vertical ? this.VERTICAL_CLOCK_FORMATS.slice() : this.CLOCK_FORMATS.slice()
    },

    /**
     * The presets in a fixed order, plus the configured alternate and
     * current format when they are something else. The order must not
     * depend on which entry is current: cycling persists the result, and
     * a ring that reshuffled itself around the current value would bounce
     * between two entries instead of walking.
     * @param {*} configured
     * @param {*} configuredAlt
     * @param {string[]} presets
     * @returns {string[]}
     */
    clockFormatRing(configured, configuredAlt, presets) {
        /** @type {string[]} */
        const ring = []
        for (const candidate of (presets || []).concat([configuredAlt, configured])) {
            const format = String(candidate ?? '')
            if (format === '' || ring.includes(format)) continue
            ring.push(format)
        }
        return ring.length > 0 ? ring : ['HH:mm']
    },

    /**
     * Next entry after `current`. An unknown current format (a
     * hand-written one that is not in the ring) starts the walk at the top.
     * @param {string[]} ring
     * @param {*} current
     */
    nextClockFormat(ring, current) {
        if (!ring || ring.length === 0) return ''
        const index = ring.indexOf(String(current ?? ''))
        return ring[(index + 1) % ring.length]
    },

    /**
     * Two-digit ISO week, substituted into a format's 'ww' token before
     * the formatter runs — kept a separate step to mirror upstream, where
     * Qt has no ISO week specifier of its own.
     * @param {number} year @param {number} month @param {number} day
     */
    isoWeekLiteral(year, month, day) {
        return this.pad2(this.isoWeek(year, month, day))
    },

    /** @param {*} value */
    pad2(value) {
        const n = Number(value)
        return (n < 10 ? '0' : '') + n
    },

    /**
     * Stable "yyyy-MM-dd" identity for a day, so a grid cell can be
     * compared against today without dragging Date objects around.
     * @param {number} year @param {number} month @param {number} day
     */
    dateKey(year, month, day) {
        return year + '-' + this.pad2(Number(month) + 1) + '-' + this.pad2(day)
    },

    /** @param {Date} date */
    keyForDate(date) {
        return this.dateKey(date.getFullYear(), date.getMonth(), date.getDate())
    },

    /**
     * @param {*} value
     * @returns {number | null} Weekday index 0–6, or null for nonsense.
     */
    coerceWeekStart(value) {
        if (value === undefined || value === null) return null
        if (typeof value === 'number') {
            return isFinite(value) ? ((Math.round(value) % 7) + 7) % 7 : null
        }
        const text = String(value).trim().toLowerCase()
        if (text === '') return null

        for (let i = 0; i < this.WEEKDAY_NAMES.length; i++) {
            if (this.WEEKDAY_NAMES[i] === text || this.WEEKDAY_NAMES[i].slice(0, 3) === text) return i
        }
        const parsed = parseInt(text, 10)
        return isFinite(parsed) ? ((parsed % 7) + 7) % 7 : null
    },

    /**
     * Configured week start, falling back to the locale's own first day
     * when the setting is missing or nonsense.
     * @param {*} value @param {*} fallback
     */
    normalizedWeekStart(value, fallback) {
        const configured = this.coerceWeekStart(value)
        if (configured !== null) return configured
        const fallbackStart = this.coerceWeekStart(fallback)
        return fallbackStart === null ? 1 : fallbackStart
    },

    /**
     * The browser locale's first day of the week as a Date.getDay()
     * index — the analog of upstream reading `Qt.locale().firstDayOfWeek`.
     * Intl weekInfo counts 1 = Monday … 7 = Sunday; not every engine
     * exposes it (a getter in some, a method in others), so unset falls
     * back to Monday, upstream's own last resort.
     */
    localeFirstDay() {
        try {
            const locale = new Intl.Locale(navigator.language)
            const info = /** @type {any} */ (locale).weekInfo
                ?? (typeof (/** @type {any} */ (locale)).getWeekInfo === 'function'
                    ? /** @type {any} */ (locale).getWeekInfo()
                    : null)
            if (info && typeof info.firstDay === 'number') return info.firstDay % 7
        } catch {
        }
        return 1
    },

    /** @param {*} index */
    weekStartSettingName(index) {
        return this.WEEKDAY_NAMES[this.normalizedWeekStart(index, 1)]
    },

    /**
     * The toggle flips between the two conventions people actually switch
     * between. A calendar configured to any other start (Saturday, say)
     * is shown as-is and lands on Monday the first time it is toggled.
     * @param {*} index
     */
    toggledWeekStart(index) {
        return this.normalizedWeekStart(index, 1) === 1 ? 0 : 1
    },

    /** @param {*} weekStart */
    weekdayOrder(weekStart) {
        const start = this.normalizedWeekStart(weekStart, 1)
        const out = []
        for (let i = 0; i < 7; i++) out.push((start + i) % 7)
        return out
    },

    /**
     * ISO-8601 week number: the week owning the Thursday of that date's
     * Monday-based week. Mirrors the clock widget's 'ww' format token.
     * @param {number} year @param {number} month @param {number} day
     */
    isoWeek(year, month, day) {
        const date = new Date(Date.UTC(year, month, day))
        const weekday = date.getUTCDay() || 7
        date.setUTCDate(date.getUTCDate() + 4 - weekday)
        const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
        return Math.ceil(((date.getTime() - yearStart.getTime()) / this.MS_PER_DAY + 1) / 7)
    },

    /** @param {number} year @param {number} month @param {number} day */
    dayOfYear(year, month, day) {
        return Math.round((Date.UTC(year, month, day) - Date.UTC(year, 0, 1)) / this.MS_PER_DAY) + 1
    },

    /** @param {number} year */
    daysInYear(year) {
        return this.dayOfYear(year, 11, 31)
    },

    /**
     * Share of the year already behind you: whole days completed over
     * days in the year, so January 1 reads 0% and December 31 reads 100%.
     * @param {number} year @param {number} month @param {number} day
     */
    yearProgress(year, month, day) {
        const total = this.daysInYear(year)
        if (total <= 0) return 0
        return Math.max(0, Math.min(1, (this.dayOfYear(year, month, day) - 1) / total))
    },

    /** @param {number} year @param {number} month @param {number} day */
    yearProgressPercent(year, month, day) {
        return Math.round(this.yearProgress(year, month, day) * 100)
    },

    // Memento mori. The default span is a round number rather than
    // anything from an actuarial table: the point of the bar is the
    // reminder, not the arithmetic.
    DEFAULT_LIFE_EXPECTANCY: 90,

    /**
     * A birth year rather than an age, so the bar keeps counting on its
     * own instead of going stale the moment it is entered. 0 means "not
     * set", which is also what a blank, malformed, future, or implausibly
     * distant year means.
     * @param {*} value @param {number} currentYear
     */
    parseBirthYear(value, currentYear) {
        const now = Math.round(Number(currentYear))
        if (!isFinite(now)) return 0
        const text = String(value ?? '').trim()
        if (!/^\d{4}$/.test(text)) return 0
        const year = parseInt(text, 10)
        if (!isFinite(year) || year > now || year < now - 120) return 0
        return year
    },

    /**
     * Whole years, the way people say their age: born in 1979 makes you
     * 47 for all of 2026, whichever side of your birthday today falls.
     * @param {*} birthYear @param {number} currentYear
     */
    ageFromBirthYear(birthYear, currentYear) {
        const born = this.parseBirthYear(birthYear, currentYear)
        if (born <= 0) return 0
        return Math.round(Number(currentYear)) - born
    },

    /**
     * 0 means "not set", which is also what a blank, negative,
     * fractional, or absurd entry means — the life bar simply stays hidden.
     * @param {*} value
     */
    parseAge(value) {
        const text = String(value ?? '').trim()
        if (!/^\d+$/.test(text)) return 0
        const years = parseInt(text, 10)
        if (!isFinite(years) || years <= 0 || years > 120) return 0
        return years
    },

    /**
     * Unset or nonsense falls back to the default rather than to zero,
     * so the bar always has something to measure against.
     * @param {*} value
     */
    parseLifeExpectancy(value) {
        const text = String(value ?? '').trim()
        if (!/^\d+$/.test(text)) return this.DEFAULT_LIFE_EXPECTANCY
        const years = parseInt(text, 10)
        if (!isFinite(years) || years <= 0 || years > 150) return this.DEFAULT_LIFE_EXPECTANCY
        return years
    },

    /** @param {*} age @param {*} expectancy */
    lifeProgress(age, expectancy) {
        const years = this.parseAge(age)
        const span = this.parseLifeExpectancy(expectancy)
        if (years <= 0 || span <= 0) return 0
        return Math.max(0, Math.min(1, years / span))
    },

    /** @param {*} age @param {*} expectancy */
    lifeProgressPercent(age, expectancy) {
        return Math.round(this.lifeProgress(age, expectancy) * 100)
    },

    /**
     * Always six rows of seven days. A fixed grid keeps the popup exactly
     * the same height in every month, so stepping through the year never
     * makes the panel jump under the pointer.
     * @param {number} year @param {number} month
     * @param {*} weekStart @param {string} todayKey
     */
    monthGrid(year, month, weekStart, todayKey) {
        const start = this.normalizedWeekStart(weekStart, 1)
        const leading = (new Date(year, month, 1).getDay() - start + 7) % 7
        const cursor = new Date(year, month, 1 - leading)
        const today = String(todayKey || '')
        const weeks = []

        for (let w = 0; w < 6; w++) {
            const days = []
            let thursday = null
            for (let d = 0; d < 7; d++) {
                const cellYear = cursor.getFullYear()
                const cellMonth = cursor.getMonth()
                const cellDay = cursor.getDate()
                const weekday = cursor.getDay()
                const key = this.dateKey(cellYear, cellMonth, cellDay)
                if (weekday === 4) thursday = { year: cellYear, month: cellMonth, day: cellDay }
                days.push({
                    key,
                    year: cellYear,
                    month: cellMonth,
                    day: cellDay,
                    weekday,
                    inMonth: cellMonth === month && cellYear === year,
                    weekend: weekday === 0 || weekday === 6,
                    today: key === today,
                })
                cursor.setDate(cursor.getDate() + 1)
            }
            // Number every row by the ISO week owning its Thursday. That is
            // the definition itself for Monday-start weeks, and the only
            // answer that stays stable for the other starts, where a row
            // straddles two ISO weeks but shares all of Monday through
            // Thursday with one of them.
            const anchor = thursday || days[0]
            weeks.push({
                week: this.isoWeek(anchor.year, anchor.month, anchor.day),
                days,
            })
        }
        return weeks
    },

    /** @param {number} year @param {*} month @param {*} delta */
    stepMonth(year, month, delta) {
        const target = new Date(year, Number(month) + Number(delta), 1)
        return { year: target.getFullYear(), month: target.getMonth() }
    },

    /**
     * Formats a date with the Qt-style tokens the presets use — the
     * stand-in for upstream's `Qt.formatDateTime`. Single-quoted runs are
     * literal ('' is a literal quote), `AP`/`ap` print the meridiem, and
     * `ww` is substituted with the ISO week before tokenizing, exactly as
     * upstream substitutes it before handing Qt the format.
     * @param {Date} date @param {*} format
     */
    formatDateTime(date, format) {
        const src = String(format ?? '').replace(
            /ww/g, this.isoWeekLiteral(date.getFullYear(), date.getMonth(), date.getDate()))
        let out = ''
        let i = 0
        while (i < src.length) {
            const ch = src[i]
            if (ch === "'") {
                if (src[i + 1] === "'") {
                    out += "'"
                    i += 2
                    continue
                }
                const end = src.indexOf("'", i + 1)
                if (end === -1) {
                    out += src.slice(i + 1)
                    break
                }
                out += src.slice(i + 1, end)
                i = end + 1
                continue
            }
            if (src.startsWith('AP', i) || src.startsWith('ap', i)) {
                const meridiem = date.getHours() < 12 ? 'AM' : 'PM'
                out += ch === 'A' ? meridiem : meridiem.toLowerCase()
                i += 2
                continue
            }
            let run = 1
            while (run < 4 && src[i + run] === ch) run++
            out += this._formatToken(date, ch, run)
            i += run
        }
        return out
    },

    /**
     * One token run — an unknown letter passes through verbatim, the
     * closest a hand-written format gets to Qt's own tolerance.
     * @param {Date} date @param {string} ch @param {number} count
     */
    _formatToken(date, ch, count) {
        switch (ch) {
            case 'd':
                if (count === 4) return this.DAYS_LONG[date.getDay()]
                if (count === 3) return this.DAYS_SHORT[date.getDay()]
                return count === 2 ? this.pad2(date.getDate()) : String(date.getDate())
            case 'M':
                if (count === 4) return this.MONTHS_LONG[date.getMonth()]
                if (count === 3) return this.MONTHS_SHORT[date.getMonth()]
                return count === 2 ? this.pad2(date.getMonth() + 1) : String(date.getMonth() + 1)
            case 'y':
                if (count >= 4) return String(date.getFullYear())
                if (count >= 2) return this.pad2(date.getFullYear() % 100)
                return ch.repeat(count)
            case 'H':
                return count >= 2 ? this.pad2(date.getHours()) : String(date.getHours())
            case 'h': {
                const hour = date.getHours() % 12 || 12
                return count >= 2 ? this.pad2(hour) : String(hour)
            }
            case 'm':
                return count >= 2 ? this.pad2(date.getMinutes()) : String(date.getMinutes())
            case 's':
                return count >= 2 ? this.pad2(date.getSeconds()) : String(date.getSeconds())
            default:
                return ch.repeat(count)
        }
    },
}
Object.freeze(ClockModel)
