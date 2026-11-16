// @ts-check
/**
 * @fileoverview Photo of weights (#374, spec PW-1 in docs/calculations.md): the request sent to the
 * model and what its answer means. The answer is only ever shown for checking; nothing here saves.
 * Pure, no DOM.
 * @module utils/photo-weights
 */

import { heavyBag, sumWeights } from './calc/billing.js';

/** Firebase AI Logic model (Gemini Developer API). Change it here when Google retires it. */
export const PHOTO_WEIGHTS_MODEL = 'gemini-3.5-flash-lite';
/** Long side of the photo sent, in px (JPEG). */
export const PHOTO_MAX_SIDE = 1600;
export const PHOTO_JPEG_QUALITY = 0.8;
/** Below this confidence a reading is shown as not clear. */
export const UNCLEAR_BELOW = 0.8;
export const READ_TIMEOUT_MS = 25000;

/** The prompt that read 15/15 weights on the 3 sample sheets (accuracy spike, 15 Nov 2026). */
export const PHOTO_WEIGHTS_PROMPT = `You are reading a photo of a handwritten sheet of bag weights (kilograms) from an Indian grain/produce trader.

Rules:
- The photo may be rotated 0, 90, 180 or 270 degrees. Work out the rotation first and report rotation_degrees as the clockwise rotation needed to make the writing upright.
- Read ONLY the individual bag weights. Do not include a written total or bag count as an entry; report them separately in written_total / written_count (null if absent). Usually there is no total.
- A sheet may have any number of columns. Read column by column: the leftmost column first, top to bottom, then the next column to the right, and so on (orientation as upright).
- A dash is often used as the decimal point: "23-0" means 23.0 and "94-6" means 94.6. A dot may also be used. A comma may also be a decimal point.
- Ignore stray tick marks, check marks or underlines written after numbers; they are not digits.
- Crossed-out or overwritten entries must NOT be in weights; list them in crossed_out instead.
- raw_text is exactly what is written (e.g. "94-6"); value is the number in kg.
- Do not guess. If a digit is unclear, give your best reading with a low confidence (0-1).
- column and row are 1-based in the upright orientation.
- box is [ymin, xmin, ymax, xmax] normalised 0-1000 on the image AS GIVEN (not rotated).
`;

const ENTRY_SCHEMA = {
    type: 'object',
    properties: {
        value: { type: 'number' },
        raw_text: { type: 'string' },
        confidence: { type: 'number' },
        column: { type: 'integer' },
        row: { type: 'integer' },
        box: { type: 'array', items: { type: 'integer' } }
    },
    required: ['value', 'raw_text', 'confidence', 'column', 'row', 'box'],
    propertyOrdering: ['value', 'raw_text', 'confidence', 'column', 'row', 'box']
};

/** Structured output schema (the spike's, in the SDK's lower-case form). */
export const PHOTO_WEIGHTS_SCHEMA = {
    type: 'object',
    properties: {
        rotation_degrees: { type: 'integer' },
        columns: { type: 'integer' },
        weights: { type: 'array', items: ENTRY_SCHEMA },
        written_total: { type: 'number', nullable: true },
        written_count: { type: 'integer', nullable: true },
        crossed_out: { type: 'array', items: ENTRY_SCHEMA },
        notes: { type: 'string' }
    },
    required: ['rotation_degrees', 'columns', 'weights', 'written_total', 'written_count', 'crossed_out'],
    propertyOrdering: ['rotation_degrees', 'columns', 'weights', 'written_total', 'written_count', 'crossed_out', 'notes']
};

/**
 * @typedef {[number, number, number, number]} Box [ymin, xmin, ymax, xmax], 0–1000
 * @typedef {{value: ?number, text: string, confidence: number, box: ?Box, unclear: boolean, heavy: boolean}} PhotoEntry
 * @typedef {{rotation: 0|90|180|270, entries: PhotoEntry[], crossedOut: PhotoEntry[], writtenTotal: ?number, writtenCount: ?number}} PhotoReading
 */

const DEVANAGARI_ZERO = 0x0966;
const grams = (/** @type {number} */ n) => Math.round(n * 1000) / 1000;

/**
 * PW-1: a handwritten weight as a number of kg: "94-6" and "94,6" are 94.6, "48½" is 48.5,
 * Devanagari digits count, a tick or letter after the number is ignored. null when it is not one number.
 * @param {*} raw
 * @returns {?number}
 */
export function parseWeightText(raw) {
    if (typeof raw !== 'string' || raw.includes('?')) return null;
    let s = raw.replace(/[\u0966-\u096F]/g, (d) => String(d.charCodeAt(0) - DEVANAGARI_ZERO));
    const half = /½/.test(s);
    s = s.replace(/½/g, '').replace(/[^0-9.,-]/g, ' ').trim();
    const parts = s.split(/\s+/).filter(p => /\d/.test(p));
    if (parts.length !== 1) return null;
    const num = parts[0].replace(/^[.,-]+|[.,-]+$/g, '').replace(/[-,]/g, '.');
    if (!/^\d+(\.\d+)?$/.test(num)) return null;
    const n = Number(num) + (half ? 0.5 : 0);
    return n > 0 ? grams(n) : null;
}

/** @param {*} v @returns {?Box} */
function cleanBox(v) {
    if (!Array.isArray(v) || v.length !== 4 || !v.every(n => typeof n === 'number' && Number.isFinite(n))) return null;
    const [y0, x0, y1, x1] = v.map(n => Math.min(1000, Math.max(0, n)));
    if (y1 <= y0 || x1 <= x0) return null;
    return [y0, x0, y1, x1];
}

/**
 * PW-1: one reading. The written text wins over the model's number (it catches a missed
 * decimal point); when they disagree, or the confidence is low, it is not clear.
 * @param {*} e
 * @param {number} [unclearBelow]
 * @returns {PhotoEntry & {column: number, row: number}}
 */
function cleanEntry(e, unclearBelow = UNCLEAR_BELOW) {
    const text = typeof e?.raw_text === 'string' ? e.raw_text.trim() : '';
    const fromText = parseWeightText(text);
    const modelValue = typeof e?.value === 'number' && Number.isFinite(e.value) && e.value > 0 ? grams(e.value) : null;
    const value = fromText ?? modelValue;
    const confidence = typeof e?.confidence === 'number' && Number.isFinite(e.confidence) ? Math.min(1, Math.max(0, e.confidence)) : 0;
    const disagree = (fromText !== null && modelValue !== null && fromText !== modelValue) || (text !== '' && fromText === null);
    return {
        value,
        text: text || (value !== null ? String(value) : ''),
        confidence,
        box: cleanBox(e?.box),
        unclear: value === null || disagree || confidence < unclearBelow,
        heavy: value !== null && heavyBag(value),
        column: Number.isInteger(e?.column) && e.column > 0 ? e.column : 0,
        row: Number.isInteger(e?.row) && e.row > 0 ? e.row : 0
    };
}

/** Column by column, top to bottom; the model's order when it gave no column / row. */
function readingOrder(/** @type {Array<PhotoEntry & {column: number, row: number}>} */ list) {
    if (!list.every(e => e.column && e.row)) return list;
    return list.map((e, i) => ({ e, i }))
        .sort((a, b) => a.e.column - b.e.column || a.e.row - b.e.row || a.i - b.i)
        .map(x => x.e);
}

const strip = (/** @type {PhotoEntry & {column: number, row: number}} */ e) => ({
    value: e.value, text: e.text, confidence: e.confidence, box: e.box, unclear: e.unclear, heavy: e.heavy
});

/**
 * PW-1: the model's answer (the spike's schema) as entries to check, in reading order.
 * Crossed-out entries are kept apart and are never added unless the user puts one back.
 * @param {*} raw - the parsed JSON
 * @param {{unclearBelow?: number}} [opts]
 * @returns {PhotoReading}
 */
export function normaliseReading(raw, { unclearBelow = UNCLEAR_BELOW } = {}) {
    const list = (/** @type {*} */ v) => (Array.isArray(v) ? v : []).map(e => cleanEntry(e, unclearBelow));
    const total = raw?.written_total;
    const count = raw?.written_count;
    return {
        rotation: normaliseRotation(raw?.rotation_degrees),
        entries: readingOrder(list(raw?.weights)).map(strip),
        crossedOut: readingOrder(list(raw?.crossed_out)).map(strip),
        writtenTotal: typeof total === 'number' && Number.isFinite(total) && total > 0 ? grams(total) : null,
        writtenCount: Number.isInteger(count) && count > 0 ? count : null
    };
}

/**
 * @param {*} deg
 * @returns {0|90|180|270}
 */
export function normaliseRotation(deg) {
    const n = Number(deg);
    if (!Number.isFinite(n)) return 0;
    const r = ((Math.round(n / 90) * 90) % 360 + 360) % 360;
    return /** @type {0|90|180|270} */ (r);
}

/**
 * The model's answer text as JSON (a ```json fence is allowed). Throws when it is not an object.
 * @param {string} text
 * @returns {Object}
 */
export function parseModelJson(text) {
    const body = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const data = JSON.parse(body);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object');
    return data;
}

/**
 * PW-2, PW-3: count and total of the weights that will be added, and the check against
 * a total / bag count written on the sheet. A mismatch only warns.
 * @param {number[]} values - the kept weights (each > 0)
 * @param {{writtenTotal?: ?number, writtenCount?: ?number}} [sheet]
 * @returns {{count: number, total: number, heavy: number,
 *   totalCheck: ?{sheet: number, read: number, ok: boolean}, countCheck: ?{sheet: number, read: number, ok: boolean}}}
 */
export function reviewSummary(values, { writtenTotal = null, writtenCount = null } = {}) {
    const kept = values.filter(v => typeof v === 'number' && v > 0);
    const total = grams(sumWeights(kept));
    const tolerance = Math.max(0.1, 0.05 * kept.length);
    return {
        count: kept.length,
        total,
        heavy: kept.filter(heavyBag).length,
        totalCheck: writtenTotal ? { sheet: writtenTotal, read: total, ok: Math.abs(total - writtenTotal) <= tolerance + 1e-9 } : null,
        countCheck: writtenCount ? { sheet: writtenCount, read: kept.length, ok: kept.length === writtenCount } : null
    };
}

/**
 * A box on the photo as given, moved onto the photo turned `deg` clockwise.
 * @param {Box} box
 * @param {0|90|180|270} deg
 * @returns {Box}
 */
export function rotateBox([y0, x0, y1, x1], deg) {
    if (deg === 90) return [x0, 1000 - y1, x1, 1000 - y0];
    if (deg === 180) return [1000 - y1, 1000 - x1, 1000 - y0, 1000 - x0];
    if (deg === 270) return [1000 - x1, y0, 1000 - x0, y1];
    return [y0, x0, y1, x1];
}

/**
 * Size of the photo sent: the long side at most `max`, never enlarged.
 * @param {number} width
 * @param {number} height
 * @param {number} [max]
 * @returns {{width: number, height: number}}
 */
export function fitWithin(width, height, max = PHOTO_MAX_SIDE) {
    const scale = Math.min(1, max / Math.max(width, height, 1));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Is this the model's free daily limit (HTTP 429 / RESOURCE_EXHAUSTED)?
 * @param {*} err
 * @returns {boolean}
 */
export function isQuotaError(err) {
    const status = err?.customErrorData?.status ?? err?.status;
    if (status === 429) return true;
    return /RESOURCE_EXHAUSTED|\b429\b|quota/i.test(String(err?.message || ''));
}

/** Waits before the automatic retries when Gemini is overloaded (500 / 503): at most 2 retries. */
export const OVERLOAD_RETRY_DELAYS_MS = [1500, 4000];

/**
 * Is Gemini only busy for a moment (500 "high demand" / 503 UNAVAILABLE)? Those are retried;
 * the daily limit (429), other 4xx and a cancel never are.
 * @param {*} err
 * @returns {boolean}
 */
export function isOverloadError(err) {
    if (!err || err.name === 'AbortError' || isQuotaError(err)) return false;
    const status = err?.customErrorData?.status ?? err?.status;
    if (typeof status === 'number') return status === 500 || status === 503;
    return /high demand|overloaded|\bUNAVAILABLE\b|\[50[03]\b/i.test(String(err?.message || ''));
}

/**
 * The message (msg.photo_weights.*) for a photo that could not be read (after any overload retries).
 * @param {*} err
 * @param {{online?: boolean}} [opts]
 * @returns {'msg.photo_weights.offline'|'msg.photo_weights.limit'|'msg.photo_weights.unavailable'|'msg.photo_weights.failed'}
 */
export function photoErrorKey(err, { online = true } = {}) {
    if (!online) return 'msg.photo_weights.offline';
    if (isQuotaError(err)) return 'msg.photo_weights.limit';
    const status = err?.customErrorData?.status ?? err?.status;
    const code = String(err?.code || '');
    if ([401, 403, 404].includes(status) || /api-not-enabled|no-api-key|no-project-id|no-app-id|app-check/i.test(code)
        || /app.?check|PERMISSION_DENIED|API_KEY|not been used|disabled/i.test(String(err?.message || ''))) {
        return 'msg.photo_weights.unavailable';
    }
    return 'msg.photo_weights.failed';
}
