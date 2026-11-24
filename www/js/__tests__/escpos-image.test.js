/**
 * @fileoverview Printer test bytes (utils/escpos-image.js): picture → dithered dots → GS v 0
 * bands, fitted to the paper and capped in height, in chunks a cheap printer can take.
 */
import {
    CHUNK_BYTES, JOB_END, JOB_START, PHOTO_MAX_ROWS, chunkBytes, dither, escposText, fitToPaper,
    packBits, photoToEscPos, rasterBands, rasterJobChunks, toGray
} from '../utils/escpos-image.js';

const rgba = (...greys) => Uint8ClampedArray.from(greys.flatMap(v => [v, v, v, 255]));
const standalone = (a) => a.byteOffset === 0 && a.buffer.byteLength === a.length;

describe('escpos-image', () => {
    test('a 2 × 2 picture gives the exact print bytes', () => {
        const { chunks } = photoToEscPos(rgba(0, 255, 255, 0), 2, 2, { method: 'floyd' });
        expect(chunks.map(c => Array.from(c))).toEqual([
            [0x1B, 0x40, 0x1B, 0x61, 0x01],
            [0x1D, 0x76, 0x30, 0x00, 0x01, 0x00, 0x02, 0x00, 0x80, 0x40],
            [0x1B, 0x64, 0x03, 0x1D, 0x56, 0x41, 0x03]
        ]);
        chunks.forEach(c => expect(standalone(c)).toBe(true));
    });

    test('Floyd–Steinberg spreads the error: a mid grey row alternates', () => {
        expect(Array.from(dither(Float32Array.from([128, 128, 128, 128]), 4, 1, 'floyd'))).toEqual([0, 1, 0, 1]);
    });

    test('a grey patch is about half black; Atkinson is never darker than Floyd–Steinberg', () => {
        const gray = new Float32Array(32 * 32).fill(128);
        const black = (m) => dither(gray, 32, 32, m).reduce((n, b) => n + b, 0);
        expect(black('floyd') / 1024).toBeGreaterThan(0.4);
        expect(black('floyd') / 1024).toBeLessThan(0.6);
        expect(black('atkinson')).toBeLessThanOrEqual(black('floyd'));
    });

    test('brightness and contrast move the grey; see-through pixels are paper', () => {
        expect(toGray(rgba(100), 1, 1, { brightness: 20 })[0]).toBeCloseTo(151, 0);
        expect(toGray(rgba(100), 1, 1, { contrast: 100 })[0]).toBe(0);
        expect(toGray(Uint8ClampedArray.from([0, 0, 0, 0]), 1, 1)[0]).toBe(255);
    });

    test('packs 8 dots per byte, leftmost dot in the high bit, rows padded to whole bytes', () => {
        const bits = Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        const { raster, bytesPerLine } = packBits(bits, 10, 2);
        expect(bytesPerLine).toBe(2);
        expect(Array.from(raster)).toEqual([0x81, 0x80, 0x00, 0x00]);
    });

    test('fits the paper width: 384 dots on 58 mm, 576 on 80 mm, small photos scaled up', () => {
        expect(fitToPaper(1000, 750, 384)).toEqual({ width: 384, height: 288, drawWidth: 384, left: 0, capped: false });
        expect(fitToPaper(1000, 750, 576)).toEqual({ width: 576, height: 432, drawWidth: 576, left: 0, capped: false });
        expect(fitToPaper(100, 50, 384)).toMatchObject({ width: 384, height: 192 });
    });

    test('caps the height: a tall photo is made smaller and centred', () => {
        expect(PHOTO_MAX_ROWS).toBe(1200);
        expect(fitToPaper(300, 3000, 384)).toEqual({ width: 384, height: 1200, drawWidth: 120, left: 132, capped: true });
        expect(fitToPaper(384, 1200, 384).capped).toBe(false);
        expect(fitToPaper(384, 1201, 384, 1200)).toMatchObject({ height: 1200, capped: true });
    });

    test('bands of whole rows, each within the chunk size, covering every row once', () => {
        const height = 100;
        const raster = new Uint8Array(48 * height).map((_, i) => i & 0xFF);
        const bands = rasterBands(raster, 48, height);
        expect(bands.map(b => b.length)).toEqual([1016, 1016, 1016, 1016, 776]);
        bands.forEach(b => expect(b.length).toBeLessThanOrEqual(CHUNK_BYTES));
        bands.forEach(b => expect(standalone(b)).toBe(true));
        expect(bands.map(b => b[6] | (b[7] << 8))).toEqual([21, 21, 21, 21, 16]);
        expect(Array.from(bands[0].subarray(0, 6))).toEqual([0x1D, 0x76, 0x30, 0x00, 48, 0]);
        const joined = bands.flatMap(b => Array.from(b.subarray(8)));
        expect(joined).toEqual(Array.from(raster));
    });

    test('80 mm rows (72 bytes) give 14 rows per band; a row wider than the chunk still goes one row at a time', () => {
        expect(rasterBands(new Uint8Array(72 * 30), 72, 30).map(b => b[6])).toEqual([14, 14, 2]);
        expect(rasterBands(new Uint8Array(72 * 3), 72, 3, 16).map(b => b.length)).toEqual([80, 80, 80]);
    });

    test('a 1,200-row 58 mm photo goes in about 1 KB chunks', () => {
        const { chunks } = photoToEscPos(new Uint8ClampedArray(384 * 1200 * 4).fill(255), 384, 1200);
        expect(chunks.length).toBe(2 + Math.ceil(1200 / 21));
        expect(Math.max(...chunks.map(c => c.length))).toBeLessThanOrEqual(CHUNK_BYTES);
    });

    test('chunkBytes splits into standalone pieces', () => {
        const parts = chunkBytes(Uint8Array.from({ length: 10 }, (_, i) => i), 4);
        expect(parts.map(p => Array.from(p))).toEqual([[0, 1, 2, 3], [4, 5, 6, 7], [8, 9]]);
        parts.forEach(p => expect(standalone(p)).toBe(true));
    });

    test('printer-font lines are ASCII (Hindi becomes "?", it prints as a picture) and go after the start', () => {
        expect(Array.from(escposText('Hi न'))).toEqual([0x48, 0x69, 0x20, 0x3F, 0x0A]);
        const [start] = rasterJobChunks({ raster: new Uint8Array(1), bytesPerLine: 1, height: 1 }, { textLines: ['OK'] });
        expect(Array.from(start)).toEqual([...JOB_START, 0x4F, 0x4B, 0x0A]);
        const all = rasterJobChunks({ raster: new Uint8Array(1), bytesPerLine: 1, height: 1 });
        expect(Array.from(all[all.length - 1])).toEqual([...JOB_END]);
    });
});
