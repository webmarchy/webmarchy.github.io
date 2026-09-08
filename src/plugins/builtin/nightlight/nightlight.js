/**
 * Nightlight plugin — the blue-light filter, the web analog of upstream
 * `omarchy.nightlight` (`shell/services/nightlight` + the
 * `omarchy-toggle-nightlight` bin): where upstream drives hyprsunset
 * between 6500K (off) and 4000K (on), this port lays a warm
 * multiply-blended overlay over the whole shell — every pixel's
 * channels scale toward a 4000K white point, the same color-temperature
 * math a gamma ramp applies, covering wallpaper, windows, and chrome
 * alike.
 *
 * `omarchy:nightlight-toggle` flips it, silently — upstream sends no
 * confirmation either; the bar's NightLight indicator is the read-out —
 * persisted as `nightlight.on` (the analog of the temperature
 * hyprsunset holds across shell restarts). Every change (and mount) is
 * announced as `omarchy:nightlight-changed` with the on-state as
 * detail, which is what the indicator listens for. Toggled from the
 * indicator and the menu's Trigger → Toggle → Nightlight entry.
 *
 * Owns the `nightlight.*` settings namespace (`nightlight.on`) and the
 * `omarchy:nightlight-toggle` action event.
 * @extends {Component}
 */
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
