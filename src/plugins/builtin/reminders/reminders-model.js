/**
 * Pure logic for the reminders plugin — the port of upstream
 * `shell/plugins/reminders/ReminderFlowModel.js` (input validation)
 * plus the text/arithmetic half of `bin/omarchy-reminder` (unit naming,
 * remaining-time and clock formatting, notification copy), kept
 * DOM-free and timer-free so the flow and the scheduler stay testable.
 *
 * Everything lives on the single `RemindersModel` namespace to keep the
 * shared global scope down to one name.
 */
const RemindersModel = {
    /**
     * A usable minutes entry: digits only, more than zero. Anything
     * else — blank, signed, fractional, zero — returns '' (upstream
     * validMinutes).
     * @param {*} value
     */
    validMinutes(value) {
        const minutes = String(value || '').trim()
        return /^[0-9]+$/.test(minutes) && Number(minutes) > 0 ? minutes : ''
    },

    /**
     * A scheduled reminder — the analog of the bin's systemd transient
     * unit (`omarchy-reminder-<minutes>m-<epoch>` plus its message
     * file), as one plain record for the `reminders.pending` setting.
     * @param {*} minutes @param {*} message @param {number} nowMs
     * @returns {{id: string, minutes: number, message: string, setAt: number, at: number} | null}
     */
    reminderRecord(minutes, message, nowMs) {
        const valid = this.validMinutes(minutes)
        if (!valid) return null
        const count = Number(valid)
        return {
            id: 'omarchy-reminder-' + valid + 'm-' + Math.floor(nowMs / 1000),
            minutes: count,
            message: String(message || ''),
            setAt: nowMs,
            at: nowMs + count * 60000,
        }
    },

    /**
     * The `reminders.pending` setting re-read: keep only records that
     * still look like {@link RemindersModel.reminderRecord} produced
     * them, sorted soonest first. Malformed entries (hand edits, old
     * shapes) are dropped rather than scheduled.
     * @param {*} value
     * @returns {{id: string, minutes: number, message: string, setAt: number, at: number}[]}
     */
    normalizePending(value) {
        if (!Array.isArray(value)) return []
        const out = []
        for (const record of value) {
            if (!record || typeof record !== 'object') continue
            const at = Number(record.at)
            const minutes = Number(record.minutes)
            if (!isFinite(at) || at <= 0 || !isFinite(minutes) || minutes <= 0) continue
            out.push({
                id: String(record.id || 'omarchy-reminder-' + minutes + 'm-' + Math.floor(at / 1000)),
                minutes: Math.round(minutes),
                message: typeof record.message === 'string' ? record.message : '',
                setAt: isFinite(Number(record.setAt)) ? Number(record.setAt) : 0,
                at,
            })
        }
        return out.sort((a, b) => a.at - b.at)
    },

    /**
     * "5m 30s" / "5m" / "30s" — the bin's format_remaining.
     * @param {*} seconds
     */
    formatRemaining(seconds) {
        const total = Math.max(0, Math.round(Number(seconds) || 0))
        const minutes = Math.floor(total / 60)
        const remainder = total % 60
        if (minutes > 0 && remainder > 0) return minutes + 'm ' + remainder + 's'
        if (minutes > 0) return minutes + 'm'
        return remainder + 's'
    },

    /**
     * Wall-clock time a reminder lands, formatted like the bin's
     * `date +%-H:%M` — hours without a leading zero.
     * @param {number} atMs
     */
    atTime(atMs) {
        const date = new Date(atMs)
        const minutes = date.getMinutes()
        return date.getHours() + ':' + (minutes < 10 ? '0' : '') + minutes
    },

    /**
     * What a due reminder says when no message was given.
     * @param {*} minutes
     */
    defaultMessage(minutes) {
        return 'Your ' + minutes + ' minutes are up'
    },

    /**
     * How a reminder is referred to in lists — its message, or the
     * anonymous "<minutes>-min reminder".
     * @param {{minutes: number, message: string}} record
     */
    label(record) {
        return record.message || record.minutes + '-min reminder'
    },

    /**
     * Set-confirmation title: the message leads when there is one.
     * @param {*} minutes @param {*} message
     */
    confirmationTitle(minutes, message) {
        return message
            ? message + ' in ' + minutes + ' minutes'
            : 'Reminder set for ' + minutes + ' minutes'
    },

    /** @param {number} atMs */
    confirmationBody(atMs) {
        return "You'll be reminded at " + this.atTime(atMs)
    },

    /**
     * The bar indicator's hover text — the bin's show_json tooltip:
     * an invitation when nothing is queued, the count otherwise.
     * @param {*} count
     */
    indicatorTooltip(count) {
        const n = Math.max(0, Math.round(Number(count) || 0))
        if (n === 0) return 'Set Reminder'
        return n === 1 ? '1 reminder' : n + ' reminders'
    },

    /**
     * Body of the "Upcoming reminders" notification: one line per
     * pending reminder — "<label> in <remaining> (<at>)" — or the
     * no-reminders stand-in.
     * @param {{minutes: number, message: string, at: number}[]} records
     * @param {number} nowMs
     */
    showBody(records, nowMs) {
        const lines = []
        for (const record of records) {
            if (record.at <= nowMs) continue
            lines.push(this.label(record) + ' in '
                + this.formatRemaining((record.at - nowMs) / 1000)
                + ' (' + this.atTime(record.at) + ')')
        }
        return lines.length > 0 ? lines.join('\n') : 'No outstanding reminders'
    },
}
Object.freeze(RemindersModel)
