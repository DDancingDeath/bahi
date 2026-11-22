// @ts-check
/**
 * @fileoverview Every date box shows its day in the app's one format (F54): "21 Nov 2026" (formatDay, in the
 * app language), never the device's "11/21/2026". The native input stays the control, so its label, the
 * phone's picker, the keyboard, scripts and tests use it as before: it is wrapped in a `.date-field`, its own
 * text is hidden and a `.date-field-text` drawn over it says the day. A click opens the picker on a desktop
 * (showPicker), Enter or Space opens it from the keyboard; typing digits shows the native fields until the
 * box loses focus. A box with `data-native-date` is left as it is.
 * @module ui/date-field
 */

import { formatDay } from '../utils/dates.js';
import { getLang, LANG_CHANGE_EVENT, t } from '../i18n/index.js';

const FIELD = 'date-field';
const DATE_INPUT = 'input[type="date"]:not([data-native-date])';

/**
 * What the box shows: the day, or '' when none is set.
 * @param {string} value YYYY-MM-DD
 * @param {string} [lang]
 * @returns {string}
 */
export function dateFieldText(value, lang = getLang()) {
    return formatDay(value, { lang });
}

/** @param {HTMLInputElement} input */
function openPicker(input) {
    if (input.disabled || input.readOnly) return;
    try {
        input.showPicker?.();
    } catch (_) {
        // No picker without a user gesture or in an older WebView: the box still takes typing
    }
}

/** @param {HTMLInputElement} input */
function wrap(input) {
    const box = document.createElement('span');
    box.className = FIELD;
    const text = document.createElement('span');
    text.className = 'date-field-text';
    text.setAttribute('aria-hidden', 'true');
    input.before(box);
    box.append(input, text);
    input.addEventListener('click', () => {
        if (typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches) openPicker(input);
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPicker(input);
        } else if (/^\d$/.test(e.key)) {
            box.classList.add('date-field--typing');
        }
    });
    input.addEventListener('blur', () => box.classList.remove('date-field--typing'));
    return box;
}

const VALUE = typeof HTMLInputElement === 'undefined' ? undefined : Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

/**
 * A script setting `input.value` fires no event: the box redraws itself.
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
            renderDateField(this);
        }
    });
}

/**
 * Draws (or sets up) the day shown over one date box.
 * @param {HTMLInputElement} input
 */
export function renderDateField(input) {
    if (!input?.matches?.(DATE_INPUT)) return;
    watchValue(input);
    const parent = /** @type {?HTMLElement} */ (input.parentElement);
    const box = parent?.classList.contains(FIELD) ? parent : wrap(input);
    const text = /** @type {HTMLElement} */ (box.querySelector(':scope > .date-field-text'));
    const day = dateFieldText(input.value);
    const shown = day || t('ui.date_field.empty');
    if (text.textContent !== shown) text.textContent = shown;
    text.classList.toggle('date-field-empty', !day);
    // The text sits where the box writes its own: after its border and padding, in its size
    const css = typeof getComputedStyle === 'function' ? getComputedStyle(input) : null;
    if (css) {
        const pad = `calc(${css.borderLeftWidth || '0px'} + ${css.paddingLeft || '0px'})`;
        if (box.style.getPropertyValue('--date-pad') !== pad) box.style.setProperty('--date-pad', pad);
        if (css.fontSize && box.style.getPropertyValue('--date-fs') !== css.fontSize) box.style.setProperty('--date-fs', css.fontSize);
    }
}

/** @param {ParentNode} root */
export function renderDateFields(root = document) {
    root.querySelectorAll(DATE_INPUT).forEach(el => renderDateField(/** @type {HTMLInputElement} */ (el)));
}

let installed = false;

/** Every date box now and as pages and dialogs add them. */
export function installDateFields(doc = document) {
    if (installed) return;
    installed = true;
    const onEdit = (/** @type {Event} */ e) => renderDateField(/** @type {HTMLInputElement} */ (e.target));
    doc.addEventListener('input', onEdit);
    doc.addEventListener('change', onEdit);
    window.addEventListener(LANG_CHANGE_EVENT, () => renderDateFields(doc));
    renderDateFields(doc);
    if (typeof MutationObserver !== 'function') return;
    let queued = false;
    new MutationObserver((records) => {
        if (queued || !records.some(r => [...r.addedNodes].some(n => n.nodeType === 1 && !(/** @type {Element} */ (n)).classList?.contains(FIELD)))) return;
        queued = true;
        queueMicrotask(() => { queued = false; renderDateFields(doc); });
    }).observe(doc.documentElement, { subtree: true, childList: true });
}
