/** @extends {Component} */
class Calculator extends Component {
    static template = `
        <section class="calculator" data-ref="calculator">
            <div class="calculator-face">
                <div class="calculator-display">
                    <div class="calculator-expression" data-ref="expression">&nbsp;</div>
                    <div class="calculator-result" data-ref="result">0</div>
                </div>
                <div class="calculator-keypad" data-ref="keypad">
                    <button type="button" class="calculator-key calculator-key-fn" data-key="clear">AC</button>
                    <button type="button" class="calculator-key calculator-key-fn" data-key="negate">±</button>
                    <button type="button" class="calculator-key calculator-key-fn" data-key="percent">%</button>
                    <button type="button" class="calculator-key calculator-key-op" data-key="÷">÷</button>
                    <button type="button" class="calculator-key" data-key="7">7</button>
                    <button type="button" class="calculator-key" data-key="8">8</button>
                    <button type="button" class="calculator-key" data-key="9">9</button>
                    <button type="button" class="calculator-key calculator-key-op" data-key="×">×</button>
                    <button type="button" class="calculator-key" data-key="4">4</button>
                    <button type="button" class="calculator-key" data-key="5">5</button>
                    <button type="button" class="calculator-key" data-key="6">6</button>
                    <button type="button" class="calculator-key calculator-key-op" data-key="−">−</button>
                    <button type="button" class="calculator-key" data-key="1">1</button>
                    <button type="button" class="calculator-key" data-key="2">2</button>
                    <button type="button" class="calculator-key" data-key="3">3</button>
                    <button type="button" class="calculator-key calculator-key-op" data-key="+">+</button>
                    <button type="button" class="calculator-key" data-key="0">0</button>
                    <button type="button" class="calculator-key" data-key=".">.</button>
                    <button type="button" class="calculator-key" data-key="backspace"
                            aria-label="Backspace">\u{f006e}</button>
                    <button type="button" class="calculator-key calculator-key-equals" data-key="=">=</button>
                </div>
            </div>
        </section>
    `

    /**
     * @param {Object} [config]
     * @param {AppSession} [config.session]
     */
    constructor(config) {
        super()
        this.session = config?.session ?? null
    }

    /** @param {DocumentFragment} root */
    script(root) {
        const calculator = $(root, '[data-ref="calculator"]')
        const expressionLabel = $(root, '[data-ref="expression"]')
        const resultLabel = $(root, '[data-ref="result"]')
        const keypad = $(root, '[data-ref="keypad"]')

        const session = this.session
        const saved = session && typeof session.state === 'object' && session.state !== null
            && session.state.state !== 'error' ? session.state : null

        /** @param {*} list @returns {(number | string)[]} */
        const savedTokens = list => Array.isArray(list)
            ? list.filter((/** @type {*} */ t) =>
                typeof t === 'number' || typeof t === 'string')
            : []

        /**
         * @type {(number | string)[]}
         */
        let tokens = saved ? savedTokens(saved.tokens) : []
        let entry = saved && typeof saved.entry === 'string' ? saved.entry : ''
        /** @type {'input' | 'result' | 'error'} */
        let state = saved && saved.state === 'result' ? 'result' : 'input'
        let result = saved && typeof saved.result === 'number' ? saved.result : 0
        /** @type {(number | string)[]} */
        let lastExpression = saved ? savedTokens(saved.lastExpression) : []

        function persist() {
            if (!session) return
            session.save({ tokens, entry, state, result, lastExpression })
        }

        const isOp = (/** @param {number | string} t */ t) => typeof t === 'string'

        /** @param {(number | string)[]} list */
        function evaluate(list) {
            if (!list.length) return 0
            /** @type {(number | string)[]} */
            const flat = [list[0]]
            for (let i = 1; i < list.length; i += 2) {
                const op = list[i]
                const value = Number(list[i + 1])
                if (op === '×' || op === '÷') {
                    const prev = Number(flat.pop())
                    flat.push(op === '×' ? prev * value : prev / value)
                } else {
                    flat.push(op, value)
                }
            }
            let total = Number(flat[0])
            for (let i = 1; i < flat.length; i += 2) {
                total = flat[i] === '+' ? total + Number(flat[i + 1]) : total - Number(flat[i + 1])
            }
            return total
        }

        /** @param {number} value */
        function format(value) {
            if (!Number.isFinite(value)) return 'Error'
            return String(Number(value.toPrecision(12)))
        }

        function render() {
            const parts = (state === 'result' || state === 'error' ? lastExpression : tokens)
                .map(token => isOp(token) ? token : format(Number(token)))
            if (state === 'input' && entry) parts.push(entry)
            expressionLabel.textContent = parts.join(' ') || ' '

            const text = state === 'input'
                ? (entry || format(lastNumber()))
                : format(result)
            resultLabel.textContent = text
            resultLabel.classList.toggle('calculator-result-long', text.length > 9)
        }

        function lastNumber() {
            for (let i = tokens.length - 1; i >= 0; i--) {
                if (!isOp(tokens[i])) return Number(tokens[i])
            }
            return 0
        }

        function clear() {
            tokens = []
            entry = ''
            state = 'input'
            result = 0
            lastExpression = []
        }

        function freshEntry() {
            if (state !== 'input') clear()
        }

        /** @param {string} d */
        function digit(d) {
            freshEntry()
            if (entry.replace(/[-.]/g, '').length >= 15) return
            entry = entry === '0' ? d : entry + d
        }

        function dot() {
            freshEntry()
            if (entry.includes('.')) return
            entry = entry === '' ? '0.' : entry + '.'
        }

        /** @param {string} sym */
        function operator(sym) {
            if (state === 'error') return
            if (state === 'result') {
                tokens = [result]
                state = 'input'
            } else if (entry !== '') {
                tokens.push(Number(entry))
                entry = ''
            } else if (!tokens.length) {
                tokens = [0]
            }
            if (isOp(tokens[tokens.length - 1])) tokens[tokens.length - 1] = sym
            else tokens.push(sym)
        }

        function negate() {
            if (state === 'error') return
            if (state === 'result') {
                result = -result
                return
            }
            if (entry) {
                entry = entry.startsWith('-') ? entry.slice(1) : `-${entry}`
            } else {
                for (let i = tokens.length - 1; i >= 0; i--) {
                    if (!isOp(tokens[i])) { tokens[i] = -Number(tokens[i]); break }
                }
            }
        }

        function percent() {
            if (state === 'error') return
            if (state === 'result') {
                result = result / 100
                return
            }
            const value = entry !== '' ? Number(entry) : lastNumber()
            const pending = tokens.length && isOp(tokens[tokens.length - 1])
                ? tokens[tokens.length - 1] : ''
            entry = pending === '+' || pending === '−'
                ? format(evaluate(tokens.slice(0, -1)) * value / 100)
                : format(value / 100)
        }

        function backspace() {
            if (state === 'error') { clear(); return }
            if (state === 'result') {
                entry = format(result)
                state = 'input'
                lastExpression = []
            }
            if (entry) entry = entry.slice(0, -1)
            else if (tokens.length && isOp(tokens[tokens.length - 1])) tokens.pop()
            else if (tokens.length) entry = format(Number(tokens.pop())).slice(0, -1)
        }

        function equals() {
            if (state !== 'input') return
            const list = tokens.slice()
            if (entry !== '') list.push(Number(entry))
            if (list.length && isOp(list[list.length - 1])) list.pop()
            if (!list.length) return
            lastExpression = list
            result = evaluate(list)
            state = Number.isFinite(result) ? 'result' : 'error'
            tokens = []
            entry = ''
        }

        /** @param {string} key */
        function press(key) {
            if (key >= '0' && key <= '9') digit(key)
            else if (key === '.') dot()
            else if (key === '+' || key === '−' || key === '×' || key === '÷') operator(key)
            else if (key === '=') equals()
            else if (key === 'clear') clear()
            else if (key === 'negate') negate()
            else if (key === 'percent') percent()
            else if (key === 'backspace') backspace()
            else return
            render()
            persist()
        }

        keypad.addEventListener('click', event => {
            const button = /** @type {HTMLElement} */ (event.target).closest('[data-key]')
            if (button instanceof HTMLElement && button.dataset.key) press(button.dataset.key)
        })

        function disconnected() {
            if (calculator.isConnected) return false
            document.removeEventListener('keydown', onKey)
            return true
        }

        /** @param {KeyboardEvent} event */
        function onKey(event) {
            if (disconnected()) return
            if (!AppLibrary.focusedContains(calculator)) return
            if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key === 'c'
                && !String(getSelection()).length) {
                navigator.clipboard?.writeText(resultLabel.textContent || '')
                document.dispatchEvent(new CustomEvent('omarchy:clipboard-capture',
                    { detail: resultLabel.textContent || '' }))
                event.preventDefault()
                return
            }
            if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return
            for (const selector of ['.menu', '.image-picker', '.keybindings',
                '.lock', '.screensaver', '.system-login']) {
                const el = /** @type {HTMLElement | null} */ (document.querySelector(selector))
                if (el && !el.hidden) return
            }

            const key = event.key
            if (key >= '0' && key <= '9') press(key)
            else if (key === '.' || key === ',') press('.')
            else if (key === '+') press('+')
            else if (key === '-' || key === '−') press('−')
            else if (key === '*' || key === '×' || key === 'x') press('×')
            else if (key === '/' || key === '÷') press('÷')
            else if (key === 'Enter' || key === '=') press('=')
            else if (key === 'Backspace') press('backspace')
            else if (key === 'c' || key === 'Escape') press('clear')
            else if (key === 's') press('negate')
            else if (key === '%') press('percent')
            else if (key === 'q') document.dispatchEvent(new CustomEvent('omarchy:app-close'))
            else return
            event.preventDefault()
        }

        document.addEventListener('keydown', onKey)

        render()
    }
}

AppLibrary.register('calculator', {
    name: 'Calculator',
    icon: '\u{f018b}',
    component: Calculator,
    floating: { width: '40rem', height: '62rem' },
})
