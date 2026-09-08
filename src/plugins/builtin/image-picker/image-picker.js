/**
 * Image picker plugin — the fullscreen carousel overlay, mirroring
 * upstream `omarchy.image-picker` (kind `overlay`, `keepLoaded: true`)
 * with its exact geometry from ImagePicker.qml: the selected image is a
 * flat centered rectangle (`expandedWidth` 768 × `expandedHeight` 475,
 * 3px accent border), while unselected images render as narrow
 * film-strip slices (`sliceWidth` 108 × `sliceHeight` 432) skewed into
 * parallelograms (`skewOffset` 28px over the slice height), overlapping
 * by `sliceSpacing` −30 (step 78px), dimmed by a 42%-alpha background
 * wash, 1px faint border, stacked toward the center. Upstream reuses
 * one picker for both the background switcher and the theme switcher;
 * this port does the same, with the two summon paths folded in as event
 * handlers.
 *
 * Summons (see menu-model.js for the action-string contract):
 * - `omarchy:background-picker` — the active theme's wallpapers;
 *   applying dispatches `omarchy:background-set <url>`.
 * - `omarchy:theme-picker` — every registered theme's `preview.png`
 *   with its name as label; applying dispatches
 *   `omarchy:theme-set <name>`.
 *
 * Keys: `Left`/`Right` move the selection (wrapping), `Home`/`End` jump
 * to first/last, `Enter` applies, `Escape` cancels. Clicking a slice
 * centers it; clicking the centered image applies it (upstream's
 * MouseArea behavior).
 * @extends {Component}
 */
class ImagePicker extends Component {
    static template = `
        <div class="image-picker" hidden data-ref="picker"
             role="dialog" aria-modal="true" aria-label="Image picker">
            <div class="image-picker-track" data-ref="track"></div>
            <p class="image-picker-label" data-ref="label" aria-live="polite"></p>
        </div>
    `

    /** @param {DocumentFragment} root */
    script(root) {
        const picker = $(root, '[data-ref="picker"]')
        const track = /** @type {HTMLElement} */ ($(root, '[data-ref="track"]'))
        const label = /** @type {HTMLElement} */ ($(root, '[data-ref="label"]'))

        const EXPANDED_W = 768
        const EXPANDED_H = 475
        const SLICE_W = 108
        const SLICE_H = 432
        const STEP = 78

        /** @type {{image: string, value: string, label?: string}[]} */
        let items = []
        let selectedIndex = 0
        let applyEvent = ''

        function render() {
            // innerWidth/innerHeight are visual pixels; the slides are
            // laid out in the SCALE-zoomed space, so divide the zoom
            // back out (--shell-zoom, owned by the monitor plugin).
            const zoom = Number(getComputedStyle(document.documentElement)
                .getPropertyValue('--shell-zoom')) || 1
            const previewX = (window.innerWidth / zoom - EXPANDED_W) / 2
            const topY = (window.innerHeight / zoom - EXPANDED_H) / 2
            const slices = /** @type {HTMLElement[]} */ ([...track.children])
            slices.forEach((slide, index) => {
                const rel = index - selectedIndex
                const selected = rel === 0
                slide.classList.toggle('image-picker-slide-selected', selected)
                if (selected) {
                    slide.style.left = `${previewX}px`
                    slide.style.top = `${topY}px`
                    slide.style.width = `${EXPANDED_W}px`
                    slide.style.height = `${EXPANDED_H}px`
                    slide.style.zIndex = '100'
                } else {
                    slide.style.left = rel < 0
                        ? `${previewX + rel * STEP}px`
                        : `${previewX + EXPANDED_W - 30 + (rel - 1) * STEP}px`
                    slide.style.top = `${topY + (EXPANDED_H - SLICE_H) / 2}px`
                    slide.style.width = `${SLICE_W}px`
                    slide.style.height = `${SLICE_H}px`
                    slide.style.zIndex = String(50 - Math.min(Math.abs(rel), 40))
                }
            })
            label.style.top = `${topY + EXPANDED_H + 24}px`
            label.textContent = items[selectedIndex]?.label ?? ''
        }

        function apply() {
            const item = items[selectedIndex]
            close()
            if (item && applyEvent) {
                document.dispatchEvent(new CustomEvent(applyEvent, { detail: item.value }))
            }
        }

        /**
         * @param {{image: string, value: string, label?: string}[]} nextItems
         * @param {number} startIndex
         * @param {string} nextApplyEvent
         */
        function open(nextItems, startIndex, nextApplyEvent) {
            if (!nextItems.length) return
            items = nextItems
            selectedIndex = Math.max(0, startIndex)
            applyEvent = nextApplyEvent
            track.textContent = ''
            items.forEach((item, index) => {
                const slide = document.createElement('div')
                slide.className = 'image-picker-slide'
                slide.style.backgroundImage = `url("${item.image}")`
                slide.addEventListener('click', () => {
                    if (index === selectedIndex) {
                        apply()
                    } else {
                        selectedIndex = index
                        render()
                    }
                })
                track.appendChild(slide)
            })
            picker.hidden = false
            render()
        }

        function close() {
            picker.hidden = true
        }

        window.addEventListener('resize', () => {
            if (!picker.hidden) render()
        })

        // Clicking the empty scrim cancels; the slides themselves stay
        // interactive (select on click, apply on the centered one).
        dismissOnOutsideClick(() => !picker.hidden, close,
            target => target !== picker && target !== track)

        document.addEventListener('omarchy:background-picker', () => {
            const backgrounds = Theme.backgrounds()
            const current = Settings.get('background.current', backgrounds[0])
            open(
                backgrounds.map(url => ({ image: url, value: url })),
                Math.max(0, backgrounds.indexOf(current)),
                'omarchy:background-set')
        })

        document.addEventListener('omarchy:theme-picker', () => {
            const names = Theme.names()
            open(
                names.map(name => ({
                    image: `./src/themes/${name}/preview.png`,
                    value: name,
                    label: name.split('-')
                        .map(part => part[0].toUpperCase() + part.slice(1))
                        .join(' '),
                })),
                Math.max(0, names.indexOf(Theme.current)),
                'omarchy:theme-set')
        })

        document.addEventListener('keydown', event => {
            if (picker.hidden) return
            event.preventDefault()
            event.stopImmediatePropagation()
            if (event.key === 'Escape') {
                close()
            } else if (event.key === 'ArrowLeft') {
                selectedIndex = (selectedIndex - 1 + items.length) % items.length
                render()
            } else if (event.key === 'ArrowRight') {
                selectedIndex = (selectedIndex + 1) % items.length
                render()
            } else if (event.key === 'Home') {
                selectedIndex = 0
                render()
            } else if (event.key === 'End') {
                selectedIndex = items.length - 1
                render()
            } else if (event.key === 'Enter') {
                apply()
            }
        })
    }
}
