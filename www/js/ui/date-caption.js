// @ts-check
/**
 * @fileoverview A caption under each date box in the app's one date format (F54): the native
 * picker shows the day the device's way ("11/21/2026"), the caption says "21 Nov 2026" (formatDay,
 * in the app language). Two date boxes side by side (From – To) share one caption at the end of
 * their row. The bill forms' Date boxes are left out: their date line already says the day
 * (ui/bill-date-input.js). Kept current on typing, when a script sets the value and on a language change.
 * @module ui/date-caption
 */

import { formatDay } from '../utils/dates.js';
import { getLang, LANG_CHANGE_EVENT } from '../i18n/index.js';

const CAPTION = 'date-caption';
const DATE_INPUT = 'input[type="date"]:not(.bill-date-input):not([data-no-caption])';

/** @param {HTMLInputElement} input */
const dateBoxesOf = (input) => {
    const row = input.parentElement;
    const boxes = row ? /** @type {HTMLInputElement[]} */ ([...row.querySelectorAll(`:scope > ${DATE_INPUT}`)]) : [];
    return boxes.length > 1 ? boxes : [input];
};

/**
 * The caption text for one box, or for a From – To pair ('' when no day is set).
 * @param {Array<string>} values YYYY-MM-DD
 * @param {string} [lang]
 * @returns {string}
 */
export function dateCaptionText(values, lang = getLang()) {
    const days = values.map(v => formatDay(v, { lang }));
    if (!days.some(Boolean)) return '';
    return days.length > 1 ? days.map(d => d || '…').join(' – ') : days[0];
}

/** @param {HTMLInputElement} input */
function captionFor(input) {
    const boxes = dateBoxesOf(input);
    if (boxes.length > 1) {
        const row = /** @type {HTMLElement} */ (input.parentElement);
        let cap = /** @type {?HTMLElement} */ (row.querySelector(`:scope > .${CAPTION}`));
        if (!cap) {
            cap = document.createElement('span');
            row.appendChild(cap);
        }
        return { cap, boxes };
    }
    let cap = /** @type {?HTMLElement} */ (input.nextElementSibling);
    if (!cap?.classList.contains(CAPTION)) {
        cap = document.createElement('span');
        input.insertAdjacentElement('afterend', cap);
    }
    return { cap, boxes };
}

const VALUE = typeof HTMLInputElement === 'undefined' ? undefined : Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

/**
 * A script setting `input.value` fires no event: the box redraws its caption itself.
 * @param {HTMLInputElement} input
 */
function watchValue(input) {
    if (!VALUE?.get || !VALUE.set || Object.prototype.hasOwnProperty.call(input, 'value')) return;
    const { get, set } = VALUE;
    Object.defineProperty(input, 'value', {
        configurable: true,
        get() { return get.call(this); },
        set(v) {
            set.call(this, v);
            renderDateCaption(this);
        }
    });
}

/**
 * Draws (or adds) the caption of one date box.
 * @param {HTMLInputElement} input
 */
export function renderDateCaption(input) {
    if (!input?.matches?.(DATE_INPUT)) return;
    watchValue(input);
    const { cap, boxes } = captionFor(input);
    const text = dateCaptionText(boxes.map(b => b.value));
    const cls = `${CAPTION}${boxes.length > 1 ? ` ${CAPTION}--range` : ''}`;
    if (cap.className !== cls) cap.className = cls;
    if (cap.getAttribute('aria-hidden') !== 'true') cap.setAttribute('aria-hidden', 'true');
    if (cap.textContent !== text) cap.textContent = text;
    if (cap.hidden !== !text) cap.hidden = !text;
}

/** @param {ParentNode} root */
export function renderDateCaptions(root = document) {
    root.querySelectorAll(DATE_INPUT).forEach(el => renderDateCaption(/** @type {HTMLInputElement} */ (el)));
}

let installed = false;

/** Captions every date box now and as pages and dialogs add them. */
export function installDateCaptions(doc = document) {
    if (installed) return;
    installed = true;
    const onEdit = (/** @type {Event} */ e) => renderDateCaption(/** @type {HTMLInputElement} */ (e.target));
    doc.addEventListener('input', onEdit);
    doc.addEventListener('change', onEdit);
    window.addEventListener(LANG_CHANGE_EVENT, () => renderDateCaptions(doc));
    renderDateCaptions(doc);
    if (typeof MutationObserver !== 'function') return;
    let queued = false;
    new MutationObserver((records) => {
        if (queued || !records.some(r => [...r.addedNodes].some(n => n.nodeType === 1 && !(/** @type {Element} */ (n)).classList?.contains(CAPTION)))) return;
        queued = true;
        queueMicrotask(() => { queued = false; renderDateCaptions(doc); });
    }).observe(doc.documentElement, { subtree: true, childList: true });
}
