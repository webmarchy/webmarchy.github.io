/** @extends {Component} */
class Nightlight extends Component {
    static template = `
        <div class="nightlight" hidden data-ref="overlay" aria-hidden="true"></div>
    `

    /** @param {DocumentFragment} root */
    script(root) {
        const overlay = $(root, '[data-ref="overlay"]')

        let on = Settings.get('nightlight.on', false) === true

        function apply() {
            overlay.hidden = !on
        }

        function announce() {
            document.dispatchEvent(new CustomEvent('omarchy:nightlight-changed', { detail: on }))
        }

        document.addEventListener('omarchy:nightlight-toggle', () => {
            on = !on
            Settings.set('nightlight.on', on)
            apply()
            announce()
        })

        apply()
        announce()
    }
}
