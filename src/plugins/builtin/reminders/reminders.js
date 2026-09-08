/**
 * Reminders plugin — the quick-capture flow, mirroring upstream
 * `omarchy.reminders` (`shell/plugins/reminders/ReminderFlow.qml`, kind
 * `overlay`, `keepLoaded: true`), plus the web analog of the
 * `omarchy-reminder` bin the flow hands off to (manual Ch.9).
 *
 * The flow, ported from ReminderFlow.qml: a single menu-styled card
 * centered over a scrim, two prompts in sequence. "Remind in minutes…"
 * takes a number — Enter with nothing typed dismisses, a non-number
 * complains ("Invalid reminder") and stays, a valid count advances to
 * "Reminder message…" where Enter (message optional) sets the reminder
 * and dismisses. Typing edits the entry, Backspace deletes, Escape
 * clears the typed text first and dismisses second; clicking the scrim
 * dismisses. Same summons as upstream: `Super+Ctrl+R` (Alt standing in
 * for Super where the browser can't see it, as everywhere in this
 * port), the menu's Trigger → Reminder → Set one, and the
 * `omarchy:reminders-toggle` action event.
 *
 * The scheduler stands in for the bin's systemd user timers: records
 * persist in the `reminders.pending` setting and are re-armed at mount,
 * so reminders survive a reload the way transient user units survive a
 * shell restart; ones that came due while the page was closed fire
 * immediately at the next load. Due, set-confirmation, list, clear, and
 * invalid-input feedback all dispatch `omarchy:notification-send`
 * (detail `{glyph, title, body}`) — the analog of the bin calling
 * `omarchy-notification-send`. No notifications plugin exists to render
 * them yet, so they currently go unheard; the events are the contract a
 * future one picks up. Every pending-set change (and mount) is announced as
 * `omarchy:reminders-changed` with `{count, tooltip}` — the analog of
 * the bin's `omarchy-shell -q omarchy.indicators refresh` +
 * `show --json`, and what the bar's Reminder indicator listens for.
 *
 * `omarchy-reminder show` / `clear` map to `omarchy:reminders-show` /
 * `omarchy:reminders-clear` (menu: Show all / Clear all;
 * keys: `Super+Ctrl+Alt+R` show — only where a real Super exists, since
 * with Alt standing in the combination collapses — and
 * `Super+Shift+Ctrl+R` clear).
 *
 * Owns the `reminders.*` settings namespace (`reminders.pending`) and
 * the `omarchy:reminders-toggle` / `omarchy:reminders-show` /
 * `omarchy:reminders-clear` action events.
 * @extends {Component}
 */
class Reminders extends Component {
    static template = `
        <div class="reminders" hidden data-ref="overlay"
             role="dialog" aria-modal="true" aria-label="Set a reminder">
            <div class="reminders-card">
                <div class="reminders-prompt" data-ref="prompt"></div>
            </div>
        </div>
    `

    /** @param {DocumentFragment} root */
    script(root) {
        const overlay = $(root, '[data-ref="overlay"]')
        const card = $(root, '.reminders-card')
        const prompt = $(root, '[data-ref="prompt"]')

        // Upstream's \u{F088C} (nf-md-reminder), the glyph on every reminder
        // notification — set from an escape so the file survives any
        // non-UTF-8 round trip.
        const GLYPH = '\u{F088C}'

        // ---- Flow state (ReminderFlow.qml's properties) ---------------
        let step = /** @type {'minutes' | 'message'} */ ('minutes')
        let minutes = ''
        let filterText = ''

        /** Armed timeouts by record id — the live systemd-timer analog. */
        const timers = new Map()

        const opened = () => !overlay.hidden

        // ---- Notifications --------------------------------------------

        /**
         * The analog of the bin shelling out to
         * `omarchy-notification-send [-g glyph] title [body]`.
         * @param {string} glyph @param {string} title @param {string} [body]
         */
        function notify(glyph, title, body) {
            document.dispatchEvent(new CustomEvent('omarchy:notification-send', {
                detail: { glyph, title, body: body || '' },
            }))
        }

        // The bin's `omarchy-shell -q omarchy.indicators refresh` +
        // `show --json` in one push: the bar's Reminder indicator keeps
        // whatever this last carried.
        function announcePending() {
            const count = loadPending().length
            document.dispatchEvent(new CustomEvent('omarchy:reminders-changed', {
                detail: { count, tooltip: RemindersModel.indicatorTooltip(count) },
            }))
        }

        // ---- Scheduling (the bin + systemd-run analog) ----------------

        function loadPending() {
            return RemindersModel.normalizePending(Settings.get('reminders.pending', []))
        }

        /** @param {ReturnType<typeof loadPending>} records */
        function savePending(records) {
            Settings.set('reminders.pending', records)
        }

        /**
         * Arms one record. setTimeout caps out below long delays, so
         * oversized waits re-arm in chunks until the due time is inside
         * one timeout.
         * @param {{id: string, minutes: number, message: string, at: number}} record
         */
        function schedule(record) {
            const delay = record.at - Date.now()
            if (delay <= 0) {
                fire(record)
                return
            }
            timers.set(record.id, setTimeout(() => schedule(record), Math.min(delay, 0x7fffffff)))
        }

        /** @param {{id: string, minutes: number, message: string, at: number}} record */
        function fire(record) {
            timers.delete(record.id)
            savePending(loadPending().filter(pending => pending.id !== record.id))
            notify(GLYPH, 'Reminder',
                record.message || RemindersModel.defaultMessage(record.minutes))
            announcePending()
        }

        /**
         * `omarchy-reminder <minutes> [message]`: persist, arm, confirm.
         * @param {string} count @param {string} message
         */
        function setReminder(count, message) {
            const record = RemindersModel.reminderRecord(count, message, Date.now())
            if (!record) return
            savePending(loadPending().concat([record]))
            schedule(record)
            notify(GLYPH,
                RemindersModel.confirmationTitle(record.minutes, record.message),
                RemindersModel.confirmationBody(record.at))
            announcePending()
        }

        /** `omarchy-reminder show`. */
        function showReminders() {
            notify(GLYPH, 'Upcoming reminders',
                RemindersModel.showBody(loadPending(), Date.now()))
        }

        /** `omarchy-reminder clear`. */
        function clearReminders() {
            for (const timer of timers.values()) clearTimeout(timer)
            timers.clear()
            savePending([])
            notify(GLYPH, 'All reminders have been cleared')
            announcePending()
        }

        // Re-arm what a previous session left pending — the analog of
        // systemd user timers outliving a shell restart. Anything that
        // came due while the page was closed fires right away.
        for (const record of loadPending()) schedule(record)
        announcePending()

        // ---- The capture flow -----------------------------------------

        function renderPrompt() {
            const promptText = step === 'message' ? 'Reminder message' : 'Remind in minutes'
            prompt.textContent = filterText || promptText + '…'
            prompt.classList.toggle('reminders-prompt-placeholder', !filterText)
        }

        function open() {
            step = 'minutes'
            minutes = ''
            filterText = ''
            renderPrompt()
            overlay.hidden = false
        }

        function dismiss() {
            overlay.hidden = true
        }

        function toggle() {
            if (opened()) dismiss()
            else open()
        }

        function submit() {
            const selection = filterText

            if (step === 'minutes') {
                // Enter on an empty prompt means "never mind".
                if (!selection.trim()) {
                    dismiss()
                    return
                }
                const nextMinutes = RemindersModel.validMinutes(selection)
                if (!nextMinutes) {
                    // Upstream sends this one without the reminder glyph.
                    notify('', 'Invalid reminder', 'Enter the number of minutes')
                    return
                }
                minutes = nextMinutes
                step = 'message'
                filterText = ''
                renderPrompt()
                return
            }

            setReminder(minutes, selection)
            dismiss()
        }

        // ---- Wiring ---------------------------------------------------

        dismissOnOutsideClick(opened, dismiss, target => card.contains(target))

        // Capture phase so the flow's exclusive keyboard (upstream:
        // WlrKeyboardFocus.Exclusive) beats the menu's own document
        // handler when summoned over it.
        document.addEventListener('keydown', event => {
            if (!opened()) return
            event.preventDefault()
            event.stopPropagation()

            if (event.key === 'Escape') {
                if (filterText) {
                    filterText = ''
                    renderPrompt()
                } else dismiss()
            } else if (event.key === 'Enter') {
                submit()
            } else if (event.key === 'Backspace') {
                filterText = filterText.slice(0, -1)
                renderPrompt()
            } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                filterText += event.key
                renderPrompt()
            }
        }, { capture: true })

        document.addEventListener('omarchy:reminders-toggle', () => toggle())
        document.addEventListener('omarchy:reminders-show', () => showReminders())
        document.addEventListener('omarchy:reminders-clear', () => clearReminders())

        // ---- Keybindings, per manual Ch.9 with the port's Super
        //      stand-in: Super+Ctrl+R set, Super+Shift+Ctrl+R clear.
        //      Super+Ctrl+Alt+R (show) only works with a real Super key —
        //      with Alt standing in it collapses onto set — so macOS
        //      reaches Show all through the menu instead.
        const isMac = /Mac|iPhone|iPad/.test(navigator.platform)

        /** @param {KeyboardEvent} event */
        function reminderCommand(event) {
            if (String(event.key).toLowerCase() !== 'r' || !event.ctrlKey) return ''
            if (isMac) {
                if (!event.altKey || event.metaKey) return ''
                return event.shiftKey ? 'clear' : 'set'
            }
            if (!event.metaKey && !event.altKey) return ''
            if (event.shiftKey) return 'clear'
            if (event.metaKey && event.altKey) return 'show'
            return 'set'
        }

        window.addEventListener('keydown', event => {
            const command = reminderCommand(event)
            if (!command) return
            event.preventDefault()
            event.stopImmediatePropagation()

            // A fullscreen surface above owns the keyboard (same guard
            // as the menu's summon).
            const modalBlocking = ['.image-picker', '.keybindings', '.emojis', '.clipboard',
                '.lock', '.screensaver', '.system-login'].some(selector => {
                const el = /** @type {HTMLElement | null} */ (document.querySelector(selector))
                return el !== null && !el.hidden
            })
            if (modalBlocking) return

            if (command === 'set') {
                // Upstream routes this key through the menu
                // (`omarchy-menu toggle reminder-set`); summoning from an
                // open menu closes it the same way here.
                const menu = /** @type {HTMLElement | null} */ (document.querySelector('.menu'))
                if (menu && !menu.hidden) document.dispatchEvent(new CustomEvent('omarchy:menu-toggle'))
                toggle()
            } else if (command === 'show') showReminders()
            else clearReminders()
        }, { capture: true })
    }
}
