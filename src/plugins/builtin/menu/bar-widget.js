/** @extends {Component} */
class MenuBarWidget extends Component {
    static template = `
        <button type="button" class="menu-bar-widget" title="Omarchy menu"
                aria-haspopup="dialog" aria-expanded="false"></button>
    `

    /** @param {DocumentFragment} root */
    script(root) {
        const button = $(root, 'button')
        button.textContent = ''
        button.addEventListener('click', () => {
            button.blur()
            document.dispatchEvent(new CustomEvent('omarchy:menu-toggle'))
        })
    }
}

BAR_WIDGETS['omarchy.menu'] = MenuBarWidget
