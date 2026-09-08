/**
 * @param {() => boolean} opened
 * @param {() => void} close
 * @param {(target: Node) => boolean} isInside
 */
function dismissOnOutsideClick(opened, close, isInside) {
    document.addEventListener('mousedown', event => {
        if (!opened()) return
        const target = event.target
        if (!(target instanceof Node) || isInside(target)) return
        close()
    }, { capture: true })
}
