/**
 * Terminal app — the Alacritty stand-in: a translucent themed pane, a
 * zsh-style prompt (`~ ❯` with the path in the theme's cyan, the
 * marker flipping to the red ✗ after a failed command), a steady block
 * cursor, scrollback, and line editing. Deliberately a DUMMY shell:
 * there is no interpreter behind it — `clear` is the ONE command that
 * exists (wipes the scrollback and, having exited 0, resets the
 * marker to ❯); every other command echoes under its prompt and
 * answers `bash: command not found: <cmd>`, flipping the marker to ×
 * as the real prompt reports exit codes.
 * The window chrome is the app layer's (accent border, gap);
 * all colors are `--color-*` (path cyan, error marker red, foreground
 * text), restyling live on theme switch.
 *
 * The line editor is real, though: type anywhere in the window (keys
 * route to a hidden input), the block cursor tracks the caret through
 * the text, Enter submits, Up/Down walk the history (with the
 * unsubmitted draft restored on the way back down), Ctrl+C abandons
 * the line with `^C`, Ctrl+L clears the screen, Tab does nothing (no
 * completion in a shell with no commands). The cursor hollows out
 * when the window loses focus, like a real terminal. Closing is the
 * global `Alt+W` — every printable key belongs to the line.
 * @extends {Component}
 */
class Terminal extends Component {
    /**
     * @param {Object} [config]
     * @param {AppSession} [config.session]
     */
    constructor(config) {
        super()
        this.session = config?.session ?? null
    }

    static template = `
        <section class="terminal" data-ref="terminal">
            <div class="terminal-scroll" data-ref="scroll">
                <div data-ref="lines"></div>
                <div class="terminal-line" data-ref="row"><span data-ref="prompt"></span><span data-ref="before"></span><span class="terminal-cursor" data-ref="cursor"> </span><span data-ref="after"></span></div>
            </div>
            <input class="terminal-key-sink" data-ref="input" type="text"
                   spellcheck="false" autocomplete="off" autocapitalize="off"
                   aria-label="Terminal input">
        </section>
    `

    /** @param {DocumentFragment} root */
    script(root) {
        const terminal = $(root, '[data-ref="terminal"]')
        const scroll = $(root, '[data-ref="scroll"]')
        const lines = $(root, '[data-ref="lines"]')
        const promptSlot = $(root, '[data-ref="prompt"]')
        const before = $(root, '[data-ref="before"]')
        const cursor = $(root, '[data-ref="cursor"]')
        const after = $(root, '[data-ref="after"]')
        const input = /** @type {HTMLInputElement} */ ($(root, '[data-ref="input"]'))

        const session = this.session
        const saved = session && typeof session.state === 'object' && session.state !== null
            ? session.state : null

        /** Last command's fate — every command fails here, honestly. */
        let failed = saved ? Boolean(saved.failed) : false
        /** @type {string[]} */
        const history = saved && Array.isArray(saved.history)
            ? saved.history.filter((/** @type {*} */ line) => typeof line === 'string')
            : []

        function persist() {
            if (!session) return
            session.save({ history: history.slice(-100), failed })
        }
        /** @type {number | null} Position while walking history. */
        let historyIndex = null
        /** The line that was being typed before walking into history. */
        let draft = ''

        /**
         * The zsh-style prompt: path in cyan, then `❯` — or the red ✗
         * once the previous command failed.
         * @param {boolean} showFailed
         */
        function promptFragment(showFailed) {
            const fragment = document.createDocumentFragment()
            const path = document.createElement('span')
            path.className = 'terminal-path'
            path.textContent = '~'
            const marker = document.createElement('span')
            marker.className = showFailed ? 'terminal-marker-failed' : 'terminal-marker'
            marker.textContent = showFailed ? ' × ' : ' ❯ '
            fragment.append(path, marker)
            return fragment
        }

        function renderPrompt() {
            promptSlot.textContent = ''
            promptSlot.appendChild(promptFragment(failed))
        }

        /** Mirrors the hidden input into text + block cursor. */
        function renderInput() {
            const value = input.value
            const caret = input.selectionStart ?? value.length
            before.textContent = value.slice(0, caret)
            cursor.textContent = value[caret] || ' '
            after.textContent = value.slice(caret + 1)
        }

        /** @param {Node} content */
        function appendLine(content) {
            const line = document.createElement('div')
            line.className = 'terminal-line'
            line.appendChild(content)
            lines.appendChild(line)
            while (lines.children.length > 1000) {
                /** @type {Element} */ (lines.firstElementChild).remove()
            }
        }

        /** @param {string} text */
        function appendText(text) {
            appendLine(document.createTextNode(text))
        }

        /** Echoes the live prompt + typed text into the scrollback. */
        /** @param {string} text */
        function appendPromptLine(text) {
            const fragment = promptFragment(failed)
            fragment.appendChild(document.createTextNode(text))
            appendLine(fragment)
        }

        function scrollToBottom() {
            scroll.scrollTop = scroll.scrollHeight
        }

        function submit() {
            const raw = input.value
            const command = raw.trim()
            if (command === 'clear') {
                // The one command that exists: wipe the scrollback and,
                // having exited 0, put the prompt back to ❯.
                lines.textContent = ''
                history.push(raw)
                failed = false
            } else {
                appendPromptLine(raw)
                if (command) {
                    appendText(`bash: command not found: ${command.split(/\s+/)[0]}`)
                    appendText('')
                    history.push(raw)
                    failed = true
                }
            }
            historyIndex = null
            draft = ''
            input.value = ''
            renderPrompt()
            renderInput()
            scrollToBottom()
            persist()
        }

        /** @param {number} delta */
        function walkHistory(delta) {
            if (!history.length) return
            if (historyIndex === null) {
                if (delta > 0) return
                draft = input.value
                historyIndex = history.length - 1
            } else {
                historyIndex += delta
            }
            if (historyIndex < 0) historyIndex = 0
            if (historyIndex > history.length - 1) {
                historyIndex = null
                input.value = draft
            } else {
                input.value = history[historyIndex]
            }
            input.setSelectionRange(input.value.length, input.value.length)
            renderInput()
        }

        /** Cleans up everything the closed terminal left on the document. */
        function disconnected() {
            if (terminal.isConnected) return false
            document.removeEventListener('selectionchange', onSelect)
            document.removeEventListener('keydown', onGlobalKey)
            return true
        }

        function onSelect() {
            if (disconnected()) return
            if (document.activeElement === input) renderInput()
        }

        /**
         * A printable key while the window is focused but the sink is
         * not (e.g. focus arrived via Alt+Arrow) grabs the sink, so
         * typing "just works" like a real terminal.
         * @param {KeyboardEvent} event
         */
        function onGlobalKey(event) {
            if (disconnected()) return
            if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
            if (document.activeElement === input) return
            if (!AppLibrary.focusedContains(terminal)) return
            if (event.key.length === 1 || event.key === 'Backspace') input.focus()
        }

        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault()
                submit()
            } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                walkHistory(-1)
            } else if (event.key === 'ArrowDown') {
                event.preventDefault()
                walkHistory(1)
            } else if (event.key === 'Tab') {
                event.preventDefault()
            } else if (event.ctrlKey && event.key === 'c') {
                event.preventDefault()
                appendPromptLine(`${input.value}^C`)
                failed = true
                historyIndex = null
                input.value = ''
                renderPrompt()
                renderInput()
                scrollToBottom()
                persist()
            } else if (event.ctrlKey && event.key === 'l') {
                event.preventDefault()
                lines.textContent = ''
            }
        })
        input.addEventListener('input', () => {
            historyIndex = null
            renderInput()
        })
        input.addEventListener('focus', () => terminal.classList.remove('terminal-unfocused'))
        input.addEventListener('blur', () => terminal.classList.add('terminal-unfocused'))
        document.addEventListener('selectionchange', onSelect)
        document.addEventListener('keydown', onGlobalKey)

        // Click focuses the line — unless the user is selecting output.
        terminal.addEventListener('click', () => {
            if (String(getSelection()).length) return
            input.focus()
        })

        renderPrompt()
        renderInput()
        input.focus()
    }
}

AppLibrary.register('terminal', {
    name: 'Terminal',
    icon: '\u{f018d}',
    component: Terminal,
})
