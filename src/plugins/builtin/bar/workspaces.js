class WorkspacesWidget extends Component {
    static template = `
        <div class="bar-workspaces" data-ref="strip" role="tablist"
             aria-label="Workspaces"></div>
    `

    /** @param {DocumentFragment} root */
    script(root) {
        const strip = $(root, '[data-ref="strip"]')

        function render() {
            const state = AppLibrary.workspaceState()
            strip.textContent = ''
            state.occupied.forEach((occupied, i) => {
                const n = i + 1
                const cell = document.createElement('button')
                cell.type = 'button'
                cell.className = 'bar-workspace'
                cell.setAttribute('role', 'tab')
                cell.setAttribute('aria-label', `Workspace ${n}`)
                cell.setAttribute('aria-selected', String(n === state.active))
                if (n === state.active) {
                    cell.classList.add('bar-workspace-active')
                } else {
                    cell.textContent = String(n)
                    if (occupied) cell.classList.add('bar-workspace-occupied')
                }
                cell.addEventListener('click', () => {
                    document.dispatchEvent(new CustomEvent('omarchy:workspace-switch', {
                        detail: n,
                    }))
                })
                strip.appendChild(cell)
            })
        }

        strip.addEventListener('wheel', event => {
            event.preventDefault()
            document.dispatchEvent(new CustomEvent('omarchy:workspace-step', {
                detail: event.deltaY > 0 || event.deltaX > 0 ? 1 : -1,
            }))
        }, { passive: false })

        document.addEventListener('omarchy:workspaces-changed', render)
        render()
    }
}

BAR_WIDGETS['omarchy.workspaces'] = WorkspacesWidget
