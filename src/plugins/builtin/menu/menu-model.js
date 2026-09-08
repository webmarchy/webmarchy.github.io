/**
 * @typedef {Object} MenuItem
 * @property {string} [icon]
 * @property {string} label
 * @property {string} [title]
 * @property {string} [target]
 * @property {string} [action]
 * @property {string} [provider]
 * @property {string[]} [aliases]
 */

/** @type {Record<string, MenuItem>} */
const MENU_ITEMS = {
    'apps': { icon: '\u{f003b}', label: 'Apps', aliases: ['app', 'applications'], provider: 'apps' },
    'learn': { icon: '\u{f09d1}', label: 'Learn' },
    'trigger': { icon: '\u{f0463}', label: 'Trigger' },
    'style': { icon: '\u{e22b}', label: 'Style' },
    'setup': { icon: '\u{f0493}', label: 'Setup' },
    'about': { icon: '\u{f05a}', label: 'About', aliases: ['fastfetch'], action: 'omarchy:app-launch about' },
    'system': { icon: '\u{f011}', label: 'System', aliases: ['power-menu'] },

    'learn.keybindings': { icon: '\u{f030c}', label: 'Keybindings', aliases: ['hotkeys', 'shortcuts'], action: 'omarchy:keybindings' },
    'learn.omarchy': { icon: '\u{f05a}', label: 'Omarchy', target: 'https://omarchy.org/manual/' },
    'learn.hyprland': { icon: '\u{f35e}', label: 'Hyprland', target: 'https://wiki.hypr.land/' },
    'learn.arch': { icon: '\u{f08c7}', label: 'Arch', target: 'https://wiki.archlinux.org/title/Main_page' },
    'learn.community': { icon: '\u{f066f}', label: 'Community', aliases: ['discord'], target: 'https://discord.gg/tXFUdasqhY' },

    'trigger.emoji': { icon: '', label: 'Emoji', aliases: ['emoji', 'emojis'], action: 'omarchy:emojis-toggle' },
    'trigger.reminder': { icon: '\u{f088c}', label: 'Reminder', aliases: ['reminder'] },
    'trigger.reminder.set': { icon: '\u{f088c}', label: 'Set one', aliases: ['reminder-set', 'remind'], action: 'omarchy:reminders-toggle' },
    'trigger.reminder.show': { icon: '\u{f088c}', label: 'Show all', action: 'omarchy:reminders-show' },
    'trigger.reminder.clear': { icon: '\u{f088c}', label: 'Clear all', action: 'omarchy:reminders-clear' },
    'trigger.toggle': { icon: '\u{f0521}', label: 'Toggle' },
    'trigger.toggle.screensaver': { icon: '\u{f1104}', label: 'Screensaver', action: 'omarchy:screensaver' },
    'trigger.toggle.top-bar': { icon: '\u{f035c}', label: 'Menu Bar', action: 'omarchy:bar-toggle' },
    'trigger.toggle.idle-lock': { icon: '\u{f0176}', label: 'Stay Awake', action: 'omarchy:idle-toggle' },
    'trigger.toggle.nightlight': { icon: '\u{f050e}', label: 'Nightlight', action: 'omarchy:nightlight-toggle' },
    'trigger.toggle.gaps': { icon: '\u{f0521}', label: 'Window Gaps', aliases: ['gaps'], action: 'omarchy:gaps-toggle' },
    'trigger.tests': { icon: '\u{f04c5}', label: 'Speed Test' },
    'trigger.tests.network-speedtest': { icon: '\u{f04c5}', label: 'Network Speed Test', action: 'omarchy:speedtest-toggle' },
    'trigger.tests.disk-speedtest': { icon: '\u{f02ca}', label: 'Disk Speed Test', action: 'omarchy:disk-speedtest-toggle' },

    'style.theme': { icon: '\u{f0e0c}', label: 'Theme', aliases: ['theme', 'themes'], action: 'omarchy:theme-picker' },
    'style.background': { icon: '\u{f03e}', label: 'Background', aliases: ['background', 'wallpaper'], action: 'omarchy:background-picker' },
    'style.font': { icon: '\u{f031d}', label: 'Font', aliases: ['fonts', 'typeface'], provider: 'fonts' },
    'style.unlock': { icon: '\u{f033e}', label: 'Unlock', aliases: ['lock-screen', 'branding'], action: 'omarchy:unlock-picker' },
    'style.bar': { icon: '\u{f035c}', label: 'Menu Bar' },
    'style.bar.position': { icon: '\u{eb81}', label: 'Position' },
    'style.bar.position.top': { icon: '\u{f005d}', label: 'Top', action: 'omarchy:bar-position top' },
    'style.bar.position.bottom': { icon: '\u{f0045}', label: 'Bottom', action: 'omarchy:bar-position bottom' },
    'style.bar.position.left': { icon: '\u{f004d}', label: 'Left', action: 'omarchy:bar-position left' },
    'style.bar.position.right': { icon: '\u{f0054}', label: 'Right', action: 'omarchy:bar-position right' },
    'style.bar.transparency': { icon: '\u{f00b5}', label: 'Transparency', action: 'omarchy:bar-transparency toggle' },

    'setup.audio': { icon: '\u{f057e}', label: 'Audio', aliases: ['volume', 'sound'], action: 'omarchy:audio-toggle' },
    'setup.bluetooth': { icon: '\u{f00af}', label: 'Bluetooth', action: 'omarchy:bluetooth-toggle' },
    'setup.power': { icon: '\u{f0079}', label: 'Power', aliases: ['battery'], action: 'omarchy:power-toggle' },
    'setup.monitors': { icon: '\u{f0379}', label: 'Monitors', aliases: ['display'], action: 'omarchy:monitor-toggle' },
    'setup.network': { icon: '\u{f06f3}', label: 'Network', aliases: ['network'] },
    'setup.network.panel': { icon: '\u{f06f3}', label: 'Panel', aliases: ['ethernet', 'wifi'], action: 'omarchy:network-toggle' },
    'setup.network.qr': { icon: '\u{f0432}', label: 'QR Code', aliases: ['wifi-qr'], action: 'omarchy:wifiqr-toggle' },
    'setup.reset': { icon: '\u{f0453}', label: 'Reset Computer', aliases: ['factory-reset'], action: 'omarchy:factory-reset' },

    'system.screensaver': { icon: '\u{f1104}', label: 'Screensaver', action: 'omarchy:screensaver' },
    'system.lock': { icon: '\u{f033e}', label: 'Lock', action: 'omarchy:lock' },
    'system.suspend': { icon: '\u{f04b2}', label: 'Suspend', action: 'omarchy:suspend' },
    'system.hibernate': { icon: '\u{f0901}', label: 'Hibernate', action: 'omarchy:hibernate' },
    'system.logout': { icon: '\u{f0343}', label: 'Logout', action: 'omarchy:logout' },
    'system.reboot': { icon: '\u{f0709}', label: 'Reboot', action: 'omarchy:reboot' },
    'system.shutdown': { icon: '\u{f0425}', label: 'Shutdown', action: 'omarchy:shutdown' },
}

const MENU_PROVIDERS = {
    apps() {
        return AppLibrary.entries().map(app => ({
            id: `apps.${app.id}`,
            icon: app.icon,
            label: app.name,
            action: `omarchy:app-launch ${app.id}`,
        }))
    },
    fonts() {
        const current = Fonts.current()
        return [
            {
                id: 'style.font.default',
                icon: current ? '\u{f031d}' : '\u{f012c}',
                label: 'System Default',
                action: 'omarchy:font-set',
            },
            ...Fonts.available().map(name => ({
                id: `style.font.${name}`,
                icon: name === current ? '\u{f012c}' : '\u{f031d}',
                label: name,
                action: `omarchy:font-set ${name}`,
            })),
        ]
    },
}

function menuParentOf(id) {
    return id.includes('.') ? id.split('.').slice(0, -1).join('.') : 'root'
}

/**
 * @param {string} parentId
 */
function menuChildrenOf(parentId) {
    return Object.entries(MENU_ITEMS)
        .filter(([id]) => menuParentOf(id) === parentId)
        .map(([id, item]) => ({ id, ...item }))
}

/**
 * @param {string} query
 */
function menuSearch(query) {
    const q = query.trim().toLowerCase()
    if (!q) return []

    /** @param {string} id */
    function pathOf(id) {
        const path = []
        for (let p = menuParentOf(id); p !== 'root'; p = menuParentOf(p)) {
            path.unshift(MENU_ITEMS[p]?.label ?? p)
        }
        return path.join(' › ')
    }

    /**
     * @param {string} label @param {string[]} [aliases]
     */
    function rankOf(label, aliases) {
        const lower = label.toLowerCase()
        if (lower.startsWith(q)) return 0
        if (lower.includes(q)) return 1
        if ((aliases ?? []).some(a => a.toLowerCase().includes(q))) return 2
        return -1
    }

    /** @type {(MenuItem & {id: string, detail: string, rank: number})[]} */
    const results = []
    for (const [id, item] of Object.entries(MENU_ITEMS)) {
        const rank = rankOf(item.label, item.aliases)
        if (rank >= 0) results.push({ id, ...item, detail: pathOf(id), rank })
        if (item.provider) {
            for (const row of MENU_PROVIDERS[item.provider]?.() ?? []) {
                const rowRank = rankOf(row.label)
                if (rowRank >= 0) {
                    results.push({ ...row, detail: item.label, rank: rowRank })
                }
            }
        }
    }
    return results
        .map((row, index) => ({ row, index }))
        .sort((a, b) => a.row.rank - b.row.rank || a.index - b.index)
        .map(({ row }) => row)
}
