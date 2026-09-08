/**
 * Minimal QR encoder for the Wi-Fi share panel — the stand-in for the
 * `qrencode` half of upstream's `omarchy-network-qr` (a page can't
 * shell out, and the project takes no dependencies). Byte mode, error
 * correction level M, versions 1–10 (up to 213 payload bytes — a
 * WIFI: string tops out far below that), full ISO 18004 mask selection
 * by penalty score, and a 4-module quiet zone baked into the output
 * matrix the way upstream's generator bakes its own.
 *
 * Everything lives on the single `QrCode` namespace to keep the shared
 * global scope down to one name. Verified module-for-module against a
 * reference encoder at the same version/mask.
 */
const QrCode = {
    // Per version (index 0 = v1), for level M: total codewords, EC
    // codewords per block, and [count, dataCodewords] block groups.
    _VERSIONS: /** @type {[number, number, [number, number][]][]} */ ([
        [26, 10, [[1, 16]]],
        [44, 16, [[1, 28]]],
        [70, 26, [[1, 44]]],
        [100, 18, [[2, 32]]],
        [134, 24, [[2, 43]]],
        [172, 16, [[4, 27]]],
        [196, 18, [[4, 31]]],
        [242, 22, [[2, 38], [2, 39]]],
        [292, 22, [[3, 36], [2, 37]]],
        [346, 26, [[4, 43], [1, 44]]],
    ]),

    /** Alignment pattern centers per version (v1 has none). */
    _ALIGNMENT: /** @type {Record<number, number[]>} */ ({
        2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
        7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
    }),

    /** @type {number[]} */ _EXP: [],
    /** @type {number[]} */ _LOG: [],

    _initTables() {
        if (this._EXP.length) return
        let x = 1
        for (let i = 0; i < 255; i++) {
            this._EXP[i] = x
            this._LOG[x] = i
            x <<= 1
            if (x & 0x100) x ^= 0x11d
        }
        for (let i = 255; i < 512; i++) this._EXP[i] = this._EXP[i - 255]
    },

    /**
     * Reed–Solomon EC codewords for one block.
     * @param {number[]} data @param {number} degree
     */
    _reedSolomon(data, degree) {
        this._initTables()
        // Generator polynomial: the product of (x + α^d), highest
        // degree first.
        let generator = [1]
        for (let d = 0; d < degree; d++) {
            const next = new Array(generator.length + 1).fill(0)
            for (let i = 0; i < generator.length; i++) {
                if (generator[i] === 0) continue
                next[i] ^= generator[i]
                next[i + 1] ^= this._EXP[(this._LOG[generator[i]] + d) % 255]
            }
            generator = next
        }
        const remainder = new Array(degree).fill(0)
        for (const byte of data) {
            const factor = byte ^ remainder.shift()
            remainder.push(0)
            if (factor === 0) continue
            for (let i = 0; i < degree; i++) {
                if (generator[i + 1] === 0) continue
                remainder[i] ^= this._EXP[(this._LOG[generator[i + 1]] + this._LOG[factor]) % 255]
            }
        }
        return remainder
    },

    /** @param {string} text @returns {number[]} UTF-8 bytes. */
    _utf8(text) {
        return [...new TextEncoder().encode(String(text))]
    },

    /**
     * Data codewords: mode + count + payload + terminator + padding.
     * @param {number[]} bytes @param {number} version @param {number} capacity
     */
    _buildCodewords(bytes, version, capacity) {
        /** @type {number[]} */
        const bits = []
        /** @param {number} value @param {number} length */
        const push = (value, length) => {
            for (let i = length - 1; i >= 0; i--) bits.push((value >> i) & 1)
        }
        push(0b0100, 4)
        push(bytes.length, version >= 10 ? 16 : 8)
        for (const byte of bytes) push(byte, 8)
        push(0, Math.min(4, capacity * 8 - bits.length))
        while (bits.length % 8 !== 0) bits.push(0)

        const codewords = []
        for (let i = 0; i < bits.length; i += 8) {
            let byte = 0
            for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i + b]
            codewords.push(byte)
        }
        for (let pad = 0xec; codewords.length < capacity;) {
            codewords.push(pad)
            pad = pad === 0xec ? 0x11 : 0xec
        }
        return codewords
    },

    /**
     * Blocks + EC, interleaved per spec.
     * @param {number[]} codewords @param {number} ecPerBlock
     * @param {[number, number][]} groups
     */
    _interleave(codewords, ecPerBlock, groups) {
        /** @type {number[][]} */
        const blocks = []
        let offset = 0
        for (const [count, size] of groups) {
            for (let i = 0; i < count; i++) {
                blocks.push(codewords.slice(offset, offset + size))
                offset += size
            }
        }
        const ecBlocks = blocks.map(block => this._reedSolomon(block, ecPerBlock))
        const out = []
        const longest = Math.max(...blocks.map(block => block.length))
        for (let i = 0; i < longest; i++) {
            for (const block of blocks) if (i < block.length) out.push(block[i])
        }
        for (let i = 0; i < ecPerBlock; i++) {
            for (const block of ecBlocks) out.push(block[i])
        }
        return out
    },

    /** @param {number} r @param {number} c @param {number} mask */
    _masked(r, c, mask) {
        switch (mask) {
            case 0: return (r + c) % 2 === 0
            case 1: return r % 2 === 0
            case 2: return c % 3 === 0
            case 3: return (r + c) % 3 === 0
            case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0
            case 5: return (r * c) % 2 + (r * c) % 3 === 0
            case 6: return ((r * c) % 2 + (r * c) % 3) % 2 === 0
            default: return ((r + c) % 2 + (r * c) % 3) % 2 === 0
        }
    },

    /**
     * ISO 18004 penalty score — runs, 2×2 blocks, finder-like
     * patterns, dark balance.
     * @param {number[][]} m
     */
    _penalty(m) {
        const size = m.length
        let score = 0
        // N1: runs of five or more, both axes.
        for (let axis = 0; axis < 2; axis++) {
            for (let i = 0; i < size; i++) {
                let run = 1
                let previous = -1
                for (let j = 0; j < size; j++) {
                    const value = axis === 0 ? m[i][j] : m[j][i]
                    if (value === previous) {
                        run++
                        if (run === 5) score += 3
                        else if (run > 5) score += 1
                    } else {
                        previous = value
                        run = 1
                    }
                }
            }
        }
        // N2: 2×2 blocks of one color.
        for (let r = 0; r < size - 1; r++) {
            for (let c = 0; c < size - 1; c++) {
                const value = m[r][c]
                if (m[r][c + 1] === value && m[r + 1][c] === value && m[r + 1][c + 1] === value) score += 40 / 40 * 3
            }
        }
        // N3: finder-like 1011101 with four light modules on a side.
        const P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0]
        const P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]
        for (let axis = 0; axis < 2; axis++) {
            for (let i = 0; i < size; i++) {
                for (let j = 0; j <= size - 11; j++) {
                    let match1 = true
                    let match2 = true
                    for (let k = 0; k < 11; k++) {
                        const value = axis === 0 ? m[i][j + k] : m[j + k][i]
                        if (value !== P1[k]) match1 = false
                        if (value !== P2[k]) match2 = false
                    }
                    if (match1) score += 40
                    if (match2) score += 40
                }
            }
        }
        // N4: dark-module balance.
        let dark = 0
        for (const row of m) for (const value of row) dark += value
        score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10
        return score
    },

    /**
     * Encode text into a module matrix. Returns rows of '0'/'1'
     * strings with a 4-module quiet zone on every side, plus the total
     * size — the shape upstream's Model.js parses out of its
     * generator.
     * @param {string} text
     * @returns {{size: number, rows: string[]}}
     */
    encodeText(text) {
        const bytes = this._utf8(text)
        let version = 0
        let capacity = 0
        for (let v = 1; v <= this._VERSIONS.length; v++) {
            const [total, ecPerBlock, groups] = this._VERSIONS[v - 1]
            void total
            const dataCodewords = groups.reduce((sum, [count, size]) => sum + count * size, 0)
            void ecPerBlock
            const headerBits = 4 + (v >= 10 ? 16 : 8)
            if (bytes.length <= Math.floor((dataCodewords * 8 - headerBits) / 8)) {
                version = v
                capacity = dataCodewords
                break
            }
        }
        if (version === 0) throw new Error('QrCode: payload too long')

        const [, ecPerBlock, groups] = this._VERSIONS[version - 1]
        const codewords = this._interleave(
            this._buildCodewords(bytes, version, capacity), ecPerBlock, groups)

        const size = version * 4 + 17
        /** 0/1 module values; -1 = unset data area. */
        const modules = Array.from({ length: size }, () => new Array(size).fill(-1))
        /** true where a function pattern owns the cell. */
        const reserved = Array.from({ length: size }, () => new Array(size).fill(false))

        /** @param {number} r @param {number} c @param {number} value */
        const set = (r, c, value) => {
            modules[r][c] = value
            reserved[r][c] = true
        }

        // Finders + separators.
        for (const [fr, fc] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
            for (let r = -1; r <= 7; r++) {
                for (let c = -1; c <= 7; c++) {
                    const rr = fr + r
                    const cc = fc + c
                    if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue
                    const inner = r >= 0 && r <= 6 && c >= 0 && c <= 6
                    const dark = inner && (r === 0 || r === 6 || c === 0 || c === 6
                        || (r >= 2 && r <= 4 && c >= 2 && c <= 4))
                    set(rr, cc, dark ? 1 : 0)
                }
            }
        }
        // Alignment first — the spec draws it over the timing tracks,
        // skipping only the three centers that would sit on a finder.
        const centers = this._ALIGNMENT[version] || []
        for (const cr of centers) {
            for (const cc of centers) {
                const onFinder = (cr < 8 && cc < 8) || (cr < 8 && cc > size - 9)
                    || (cr > size - 9 && cc < 8)
                if (onFinder) continue
                for (let r = -2; r <= 2; r++) {
                    for (let c = -2; c <= 2; c++) {
                        set(cr + r, cc + c,
                            Math.max(Math.abs(r), Math.abs(c)) !== 1 ? 1 : 0)
                    }
                }
            }
        }
        // Timing, threading between whatever is already placed.
        for (let i = 8; i < size - 8; i++) {
            if (!reserved[6][i]) set(6, i, i % 2 === 0 ? 1 : 0)
            if (!reserved[i][6]) set(i, 6, i % 2 === 0 ? 1 : 0)
        }
        // Dark module + reserved format areas.
        set(size - 8, 8, 1)
        for (let i = 0; i < 9; i++) {
            if (!reserved[8][i]) set(8, i, 0)
            if (!reserved[i][8]) set(i, 8, 0)
        }
        for (let i = 0; i < 8; i++) {
            if (!reserved[8][size - 1 - i]) set(8, size - 1 - i, 0)
            if (!reserved[size - 1 - i][8]) set(size - 1 - i, 8, 0)
        }
        // Version info (v7+).
        if (version >= 7) {
            let rem = version
            for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25)
            const info = (version << 12) | rem
            for (let i = 0; i < 18; i++) {
                const bit = (info >> i) & 1
                set(Math.floor(i / 3), size - 11 + (i % 3), bit)
                set(size - 11 + (i % 3), Math.floor(i / 3), bit)
            }
        }

        // Zigzag data placement, right to left, skipping column 6.
        {
            let bitIndex = 0
            let upward = true
            const totalBits = codewords.length * 8
            for (let col = size - 1; col >= 1; col -= 2) {
                if (col === 6) col = 5
                for (let step = 0; step < size; step++) {
                    const r = upward ? size - 1 - step : step
                    for (const c of [col, col - 1]) {
                        if (reserved[r][c]) continue
                        const bit = bitIndex < totalBits
                            ? (codewords[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1
                            : 0
                        modules[r][c] = bit
                        bitIndex++
                    }
                }
                upward = !upward
            }
        }

        // Try all eight masks, keep the lowest penalty.
        /** @type {number[][]} */
        let best = []
        let bestMask = 0
        let bestScore = Infinity
        for (let mask = 0; mask < 8; mask++) {
            const candidate = modules.map((row, r) => row.map((value, c) =>
                reserved[r][c] ? value : (this._masked(r, c, mask) ? value ^ 1 : value)))
            this._writeFormat(candidate, size, mask)
            const score = this._penalty(candidate)
            if (score < bestScore) {
                bestScore = score
                best = candidate
                bestMask = mask
            }
        }
        void bestMask

        // Bake the quiet zone.
        const quiet = 4
        const total = size + quiet * 2
        const blank = '0'.repeat(total)
        const rows = []
        for (let i = 0; i < quiet; i++) rows.push(blank)
        for (const row of best) {
            rows.push('0'.repeat(quiet) + row.join('') + '0'.repeat(quiet))
        }
        for (let i = 0; i < quiet; i++) rows.push(blank)
        return { size: total, rows }
    },

    /**
     * Format info for level M + mask, both copies.
     * @param {number[][]} m @param {number} size @param {number} mask
     */
    _writeFormat(m, size, mask) {
        const data = (0b00 << 3) | mask
        let rem = data
        for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537)
        const bits = ((data << 10) | rem) ^ 0x5412
        // Cell sequences in MSB-first order: around the top-left finder,
        // then split across the bottom-left and top-right finders.
        const first = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
            [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]]
        const second = [[size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8],
            [size - 5, 8], [size - 6, 8], [size - 7, 8], [8, size - 8], [8, size - 7],
            [8, size - 6], [8, size - 5], [8, size - 4], [8, size - 3], [8, size - 2],
            [8, size - 1]]
        for (let i = 0; i < 15; i++) {
            const bit = (bits >> (14 - i)) & 1
            m[first[i][0]][first[i][1]] = bit
            m[second[i][0]][second[i][1]] = bit
        }
    },

    /**
     * The WIFI: join string (WPA by default; empty password means an
     * open network). Escapes `\\ ; , : "` per the de-facto spec.
     * @param {string} ssid @param {string} password
     */
    wifiPayload(ssid, password) {
        /** @param {string} value */
        const escape = value => String(value).replace(/([\\;,:"])/g, '\\$1')
        const secured = String(password || '') !== ''
        return 'WIFI:S:' + escape(ssid) + ';T:' + (secured ? 'WPA' : 'nopass')
            + ';P:' + escape(password) + ';;'
    },
}
Object.freeze(QrCode)
