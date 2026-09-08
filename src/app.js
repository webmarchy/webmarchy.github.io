/**
 * @extends {Component}
 */
class App extends Component {
    static template = `
        <div data-ref="shell"></div>
        <main class="app-layer" hidden data-ref="apps"></main>
    `

    /** @param {DocumentFragment} root */
    script(root) {
        const shell = $(root, '[data-ref="shell"]')
        mount(shell, new Background())
        mount(shell, new Bar())
        mount(shell, new SystemPower())
        mount(shell, new Screensaver())
        mount(shell, new ImagePicker())
        mount(shell, new Keybindings())
        mount(shell, new Nightlight())
        mount(shell, new Reminders())
        mount(shell, new Emojis())
        mount(shell, new ClipboardManager())
        mount(shell, new SpeedtestPanel())
        mount(shell, new DiskSpeedtestPanel())
        mount(shell, new WifiQrPanel())
        mount(shell, new Menu())
        mount(shell, new LockScreen())
        AppLibrary.attach($(root, '[data-ref="apps"]'))
    }
}
