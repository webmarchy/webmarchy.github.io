/**
 * Disk speedtest plugin — the disk speed test, mirroring upstream
 * `omarchy.disk-speedtest` (`shell/plugins/panels/disk-speedtest/`, a
 * standalone summonable panel): the shared gauge cluster
 * ({@link SpeedTestOverlay}) dressed with read and write dials in
 * MB/s, upstream's larger NVMe-ready scale stops.
 *
 * Where upstream shells out to `omarchy-disk-speedtest` (direct disk
 * I/O, titled with the disk model), this port measures the storage a
 * browser actually has: the Origin Private File System. A run streams
 * 8 MB chunks into a scratch OPFS file for five seconds reporting
 * MB/s, then streams it back for the read phase, and deletes the
 * scratch file after itself — upstream's "cleans up after itself".
 * The title reads "Browser storage" since no disk model is visible.
 * Note the phase order is write-then-read (nothing exists to read
 * until it's written), while the dials keep upstream's READ | WRITE
 * arrangement.
 *
 * Owns the `omarchy:disk-speedtest-toggle` action event (menu:
 * Trigger → Speed Test → Disk Speed Test).
 * @extends {Component}
 */
class DiskSpeedtestPanel extends Component {
    static template = `<div class="disk-speedtest-host"></div>`

    /** @param {DocumentFragment} root */
    script(root) {
        const host = $(root, '.disk-speedtest-host')

        const PHASE_MS = 5000
        const CHUNK_BYTES = 8 * 1024 * 1024
        const SCRATCH_NAME = 'omarchy-disk-speedtest.bin'

        let runSeq = 0

        const overlay = mount(host, new SpeedTestOverlay({
            leftLabel: 'READ',
            rightLabel: 'WRITE',
            unit: 'MB/s',
            runAgainTooltip: 'Measure again',
            scaleStops: [500, 1000, 2500, 5000, 10000, 15000],
            onClose: () => close(),
            onRunAgain: () => run(),
        }))

        async function scratchRoot() {
            const storage = /** @type {any} */ (navigator).storage
            if (!storage || typeof storage.getDirectory !== 'function') {
                throw new Error('Browser storage unavailable')
            }
            return storage.getDirectory()
        }

        async function removeScratch() {
            try {
                const dir = await scratchRoot()
                await dir.removeEntry(SCRATCH_NAME)
            } catch {
            }
        }

        /** @param {number} seq */
        async function writePhase(seq) {
            const dir = await scratchRoot()
            const handle = await dir.getFileHandle(SCRATCH_NAME, { create: true })
            const writable = await handle.createWritable()
            const chunk = new Uint8Array(CHUNK_BYTES)
            crypto.getRandomValues(chunk.subarray(0, 65536))
            const started = performance.now()
            let bytes = 0
            try {
                while (performance.now() - started < PHASE_MS && seq === runSeq) {
                    await writable.write(chunk)
                    bytes += chunk.byteLength
                    const elapsed = (performance.now() - started) / 1000
                    if (elapsed > 0.2) overlay.setValue('right', bytes / elapsed / 1e6)
                }
            } finally {
                await writable.close()
            }
            const elapsed = (performance.now() - started) / 1000
            if (seq === runSeq && elapsed > 0) overlay.setValue('right', bytes / elapsed / 1e6)
        }

        /** @param {number} seq */
        async function readPhase(seq) {
            const dir = await scratchRoot()
            const handle = await dir.getFileHandle(SCRATCH_NAME)
            const started = performance.now()
            let bytes = 0
            // Loop full passes over the scratch file until the phase
            // window closes, so fast disks aren't limited by its size.
            while (performance.now() - started < PHASE_MS && seq === runSeq) {
                const file = await handle.getFile()
                const reader = file.stream().getReader()
                for (; ;) {
                    const { done, value } = await reader.read()
                    if (done) break
                    bytes += value.byteLength
                    const elapsed = (performance.now() - started) / 1000
                    if (elapsed > 0.2) overlay.setValue('left', bytes / elapsed / 1e6)
                    if (elapsed * 1000 >= PHASE_MS || seq !== runSeq) {
                        reader.cancel()
                        break
                    }
                }
            }
            const elapsed = (performance.now() - started) / 1000
            if (seq === runSeq && elapsed > 0) overlay.setValue('left', bytes / elapsed / 1e6)
        }

        async function run() {
            const seq = ++runSeq
            overlay.setRunning(true)
            overlay.setValue('left', 0)
            overlay.setValue('right', 0)
            overlay.setLive('right', true)
            overlay.setLive('left', false)
            try {
                await writePhase(seq)
                if (seq !== runSeq) return
                overlay.setLive('right', false)
                overlay.setLive('left', true)
                await readPhase(seq)
                if (seq !== runSeq) return
            } catch (error) {
                if (seq !== runSeq) return
                overlay.setError(error instanceof Error && error.message === 'Browser storage unavailable'
                    ? 'Browser storage unavailable'
                    : 'Disk speed test failed')
            } finally {
                if (seq === runSeq) {
                    overlay.setRunning(false)
                    removeScratch()
                }
            }
        }

        function open() {
            overlay.setTitle('Browser storage')
            overlay.openOverlay()
            run()
        }

        function close() {
            runSeq++
            overlay.setRunning(false)
            overlay.closeOverlay()
            removeScratch()
        }

        document.addEventListener('omarchy:disk-speedtest-toggle', () => {
            if (overlay.openedOverlay()) close()
            else open()
        })
    }
}
