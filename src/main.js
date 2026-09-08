const savedTheme = Settings.get('theme.current', THEME_DEFAULT)
Theme.apply(Theme.names().includes(savedTheme) ? savedTheme : THEME_DEFAULT)

document.addEventListener('omarchy:restart', () => {
    location.reload()
})

document.addEventListener('omarchy:factory-reset', () => {
    try {
        localStorage.removeItem('omarchy')
    } catch {
    }
    location.reload()
})

const appRoot = document.querySelector('#app')
if (!appRoot) {
    throw new Error('main: #app element not found')
}

mount(appRoot, new App())
