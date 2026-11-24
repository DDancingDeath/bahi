// @ts-check
/**
 * @fileoverview Printer test (photo and test page): picture → 1-bit dots → ESC/POS bytes, in
 * chunks a cheap printer's buffer can take. Pure (no DOM, no plugin); ui/printer-test.js draws
 * and sends. A chunk is a whole GS v 0 band, so stopping between chunks leaves the printer clean.
 * @module utils/escpos-image
 */

/** Tallest photo printed, in dots (15 cm on 8 dots/mm paper). */
export const PHOTO_MAX_ROWS = 1200;
/** Largest chunk written at once (bytes, band header included). */
export const CHUNK_BYTES = 1024;
/** Pause after each chunk, so the printer prints before the next one arrives. */
export const CHUNK_DELAY_MS = 60;

export const DITHERS = Object.freeze(['atkinson', 'floyd']);

const ESC = 0x1B;
const GS = 0x1D;
/** ESC @ (reset), ESC a 1 (center). */
export const JOB_START = Object.freeze([ESC, 0x40, ESC, 0x61, 0x01]);
/** ESC d 3 (feed 3 lines), GS V A 3 (partial cut; ignored without a cutter). */
export const JOB_END = Object.freeze([ESC, 0x64, 0x03, GS, 0x56, 0x41, 0x03]);
/** Sent after Cancel: feed, so the paper can be torn off. */
export const CANCEL_TAIL = Object.freeze([ESC, 0x64, 0x03]);

/**
 * The picture's size on paper: as wide as the paper, as tall as the aspect gives, at most
 * maxRows (then narrower, centred). Rows and offsets are whole dots.
 * @param {number} srcWidth
 * @param {number} srcHeight
 * @param {number} dots paper width in dots (384 = 58 mm, 576 = 80 mm)
 * @param {number} [maxRows]
 * @returns {{width: number, height: number, drawWidth: number, left: number, capped: boolean}}
 */
export function fitToPaper(srcWidth, srcHeight, dots, maxRows = PHOTO_MAX_ROWS) {
    const w = Math.max(1, Number(srcWidth) || 1);
    const h = Math.max(1, Number(srcHeight) || 1);
    const full = Math.max(1, Math.round(h * dots / w));
    if (full <= maxRows) return { width: dots, height: full, drawWidth: dots, left: 0, capped: false };
    const drawWidth = Math.max(1, Math.round(w * maxRows / h));
    return { width: dots, height: maxRows, drawWidth, left: Math.floor((dots - drawWidth) / 2), capped: true };
}

/**
 * Brightness / contrast (-100…100 each) applied to RGBA pixels, as grey 0 (black) … 255 (white).
 * See-through pixels count as white paper.
 * @param {ArrayLike<number>} rgba
 * @param {number} width
 * @param {number} height
 * @param {{brightness?: number, contrast?: number}} [adjust]
 * @returns {Float32Array}
 */
export function toGray(rgba, width, height, { brightness = 0, contrast = 0 } = {}) {
    const c = Math.max(-100, Math.min(100, Number(contrast) || 0)) * 2.55;
    const factor = (259 * (c + 255)) / (255 * (259 - c));
    const b = Math.max(-100, Math.min(100, Number(brightness) || 0)) * 2.55;
    const out = new Float32Array(width * height);
    for (let i = 0, p = 0; i < out.length; i++, p += 4) {
        const a = rgba[p + 3] === undefined ? 1 : rgba[p + 3] / 255;
        const lum = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
        const onWhite = lum * a + 255 * (1 - a);
        out[i] = Math.max(0, Math.min(255, (onWhite - 128) * factor + 128 + b));
    }
    return out;
}

/** Error spread to the neighbours: [dx, dy, share]. */
const KERNELS = {
    floyd: [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]],
    // Atkinson spreads 6/8 of the error: lighter, crisper on thermal paper
    atkinson: [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]]
};

/**
 * Error-diffusion dithering to 1 bit.
 * @param {Float32Array} gray from toGray (not changed)
 * @param {number} width
 * @param {number} height
 * @param {'atkinson'|'floyd'} [method]
 * @returns {Uint8Array} one byte per dot, 1 = black
 */
export function dither(gray, width, height, method = 'atkinson') {
    const kernel = KERNELS[method] || KERNELS.atkinson;
    const g = Float32Array.from(gray);
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const black = g[i] < 128;
            out[i] = black ? 1 : 0;
            const err = g[i] - (black ? 0 : 255);
            for (const [dx, dy, share] of kernel) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < width && ny < height) g[ny * width + nx] += err * share;
            }
        }
    }
    return out;
}

/**
 * One byte per dot (1 = black) packed 8 dots per byte, MSB = leftmost (the GS v 0 layout).
 * @param {Uint8Array} bits
 * @param {number} width
 * @param {number} height
 * @returns {{raster: Uint8Array, bytesPerLine: number}}
 */
export function packBits(bits, width, height) {
    const bytesPerLine = (width + 7) >> 3;
    const raster = new Uint8Array(bytesPerLine * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (bits[y * width + x]) raster[y * bytesPerLine + (x >> 3)] |= 0x80 >> (x & 7);
        }
    }
    return { raster, bytesPerLine };
}

/**
 * A raster as GS v 0 bands of whole rows, each at most maxBytes with its 8-byte header
 * (at least one row per band). Each band is its own Uint8Array: bluetoothSerial.write sends
 * `data.buffer`, so a view into a bigger buffer would send all of it.
 * @param {Uint8Array} raster
 * @param {number} bytesPerLine
 * @param {number} height
 * @param {number} [maxBytes]
 * @returns {Uint8Array[]}
 */
export function rasterBands(raster, bytesPerLine, height, maxBytes = CHUNK_BYTES) {
    const rowsPer = Math.max(1, Math.min(0xFFFF, Math.floor((maxBytes - 8) / bytesPerLine)));
    const bands = [];
    for (let top = 0; top < height; top += rowsPer) {
        const rows = Math.min(rowsPer, height - top);
        const band = new Uint8Array(8 + rows * bytesPerLine);
        band.set([GS, 0x76, 0x30, 0x00, bytesPerLine & 0xFF, bytesPerLine >> 8, rows & 0xFF, rows >> 8]);
        band.set(raster.subarray(top * bytesPerLine, (top + rows) * bytesPerLine), 8);
        bands.push(band);
    }
    return bands;
}

/**
 * A line in the printer's own font: ASCII only (other characters become "?"; printer fonts have
 * no Hindi, so Hindi is printed as a picture), then LF.
 * @param {string} text
 * @returns {Uint8Array}
 */
export function escposText(text) {
    const s = String(text ?? '');
    const out = new Uint8Array(s.length + 1);
    for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        out[i] = code >= 0x20 && code < 0x7F ? code : 0x3F;
    }
    out[s.length] = 0x0A;
    return out;
}

/**
 * The chunks of a print: start (with any printer-font lines), the raster bands, the end.
 * @param {{raster: Uint8Array, bytesPerLine: number, height: number}} image
 * @param {{textLines?: string[], maxBytes?: number}} [options]
 * @returns {Uint8Array[]}
 */
export function rasterJobChunks({ raster, bytesPerLine, height }, { textLines = [], maxBytes = CHUNK_BYTES } = {}) {
    const text = textLines.map(escposText);
    const start = new Uint8Array(JOB_START.length + text.reduce((n, l) => n + l.length, 0));
    start.set(JOB_START);
    let at = JOB_START.length;
    text.forEach((l) => { start.set(l, at); at += l.length; });
    return [start, ...rasterBands(raster, bytesPerLine, height, maxBytes), Uint8Array.from(JOB_END)];
}

/**
 * Bytes split into standalone chunks of at most `size` bytes.
 * @param {Uint8Array} bytes
 * @param {number} [size]
 * @returns {Uint8Array[]}
 */
export function chunkBytes(bytes, size = CHUNK_BYTES) {
    const step = Math.max(1, Math.floor(size));
    const out = [];
    for (let i = 0; i < bytes.length; i += step) out.push(bytes.slice(i, i + step));
    return out;
}

/**
 * Whole percent of chunks sent (0 when there are none).
 * @param {number} sent
 * @param {number} count
 * @returns {number}
 */
export function percentSent(sent, count) {
    return count > 0 ? Math.round((sent * 100) / count) : 0;
}

/**
 * RGBA pixels → print chunks: grey with the sliders, dithered, packed, banded.
 * @param {ArrayLike<number>} rgba
 * @param {number} width
 * @param {number} height
 * @param {{brightness?: number, contrast?: number, method?: 'atkinson'|'floyd', maxBytes?: number}} [options]
 * @returns {{bits: Uint8Array, raster: Uint8Array, bytesPerLine: number, chunks: Uint8Array[]}}
 */
export function photoToEscPos(rgba, width, height, { brightness = 0, contrast = 0, method = 'atkinson', maxBytes = CHUNK_BYTES } = {}) {
    const bits = dither(toGray(rgba, width, height, { brightness, contrast }), width, height, method);
    const { raster, bytesPerLine } = packBits(bits, width, height);
    return { bits, raster, bytesPerLine, chunks: rasterJobChunks({ raster, bytesPerLine, height }, { maxBytes }) };
}
