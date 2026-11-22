/**
 * @fileoverview Number boxes on the bill and payment forms (U-84, U-29):
 * - a Hindi keyboard's digits (०–९) go in as 0–9 instead of emptying the box;
 * - amount boxes (`data-money`, text boxes with the number keypad) show Indian grouping
 *   (1,25,000) when left, and plain digits again while typed in.
 * Values are read with Helpers.getInputNumber (utils/number-text.js), which reads both.
 * - a rate box with a list of rates (`data-pick-list`) opens that list when tapped anywhere: its chevron
 *   is drawn at the right edge like a select's, not the browser's own list button.
 * @module ui/number-input
 */

import { groupIndianText, hasDevanagariDigit, normalizeNumberText } from '../utils/number-text.js';

const isNumberBox = (/** @type {*} */ el) => typeof HTMLInputElement !== 'undefined' && el instanceof HTMLInputElement
    && (el.type === 'number' || el.inputMode === 'decimal' || el.inputMode === 'numeric' || el.hasAttribute('data-money'));

const isMoneyBox = (/** @type {*} */ el) => typeof HTMLInputElement !== 'undefined' && el instanceof HTMLInputElement && el.hasAttribute('data-money');

/**
 * Puts an amount in an amount box as it is shown when not being typed in.
 * @param {?HTMLInputElement} input
 * @param {*} value
 */
export function showAmount(input, value) {
    if (!input) return;
    input.value = isMoneyBox(input) && document.activeElement !== input ? groupIndianText(value) : String(value ?? '');
}

/**
 * Inserts text at the caret (a number box has no caret API: at the end).
 * @param {HTMLInputElement} el
 * @param {string} text
 */
function insertText(el, text) {
    if (el.type === 'number') {
        el.value = `${el.value}${text}`;
    } else {
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? start;
        el.setRangeText(text, start, end, 'end');
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Installs the listeners once (document level, so boxes put in later are covered too). */
export function installNumberInputs() {
    if (typeof document === 'undefined' || document.documentElement.dataset.numberInputs) return;
    document.documentElement.dataset.numberInputs = '1';
    document.addEventListener('beforeinput', (e) => {
        const el = e.target;
        if (!isNumberBox(el)) return;
        const data = e.data ?? e.dataTransfer?.getData('text') ?? '';
        if (!hasDevanagariDigit(data)) return;
        e.preventDefault();
        insertText(/** @type {HTMLInputElement} */ (el), normalizeNumberText(data));
    }, true);
    // Keyboards that skip beforeinput: a text box is cleaned after the fact
    document.addEventListener('input', (e) => {
        const el = /** @type {HTMLInputElement} */ (e.target);
        if (!isNumberBox(el) || el.type === 'number' || !hasDevanagariDigit(el.value)) return;
        el.value = el.value.replace(/[\u0966-\u096F]/g, (d) => normalizeNumberText(d));
    }, true);
    document.addEventListener('focusin', (e) => {
        const el = /** @type {HTMLInputElement} */ (e.target);
        if (isMoneyBox(el) && el.value.includes(',')) el.value = normalizeNumberText(el.value);
    });
    document.addEventListener('focusout', (e) => {
        const el = /** @type {HTMLInputElement} */ (e.target);
        if (isMoneyBox(el) && el.value) el.value = groupIndianText(el.value);
    });
    document.addEventListener('click', (e) => {
        const el = /** @type {HTMLInputElement} */ (e.target);
        if (!(el instanceof HTMLInputElement) || !el.hasAttribute('data-pick-list') || el.disabled || el.readOnly) return;
        try { el.showPicker?.(); } catch { /* no list picker here: typing still shows the list */ }
    });
}

installNumberInputs();
