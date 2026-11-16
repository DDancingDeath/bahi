// @ts-check
/**
 * @fileoverview Reading and showing numbers typed in the bill forms (U-84, U-29): one reader
 * for every number box, so a Hindi keyboard's digits (०–९) and Indian commas (1,25,000) read
 * the same as 125000. Pure: no DOM.
 * @module utils/number-text
 */

const DEVANAGARI_ZERO = 0x0966;

/**
 * Devanagari digits as 0–9; commas, spaces and ₹ dropped.
 * @param {*} text
 * @returns {string}
 */
export function normalizeNumberText(text) {
    return String(text ?? '')
        .replace(/[\u0966-\u096F]/g, (d) => String(d.charCodeAt(0) - DEVANAGARI_ZERO))
        .replace(/[,\s₹]/g, '');
}

/**
 * The number typed, NaN when there is none.
 * @param {*} text
 * @returns {number}
 */
export function parseNumberText(text) {
    const s = normalizeNumberText(text);
    return s === '' ? NaN : parseFloat(s);
}

/**
 * True when the text has a Devanagari digit.
 * @param {*} text
 * @returns {boolean}
 */
export const hasDevanagariDigit = (text) => /[\u0966-\u096F]/.test(String(text ?? ''));

/**
 * An amount box's text with Indian grouping (1,25,000.5), as typed otherwise: a blank or
 * unreadable box is left as it is, and decimals are kept as typed.
 * @param {*} text
 * @returns {string}
 */
export function groupIndianText(text) {
    const s = normalizeNumberText(text);
    const m = /^(-?)(\d+)(\.\d*)?$/.exec(s);
    if (!m) return String(text ?? '');
    const [, sign, whole, frac = ''] = m;
    const int = whole.replace(/^0+(?=\d)/, '');
    const last3 = int.slice(-3);
    const rest = int.slice(0, -3);
    const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
    return `${sign}${grouped}${frac}`;
}
