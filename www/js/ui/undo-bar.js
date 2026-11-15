/**
 * @fileoverview "Removed Wheat 151 kg · Undo" (U-06): a bar above the bill's action row for about
 * 6 s after a bill line, a weight, a draft or the whole bill is removed. Undo puts it back; one bar
 * at a time (a new removal replaces the old bar, whose removal then stays).
 * @module ui/undo-bar
 */

import { t } from '../i18n/index.js';

/** How long Undo is offered. */
export const UNDO_MS = 6000;

let timer = null;
/** @type {?() => void} */
let pending = null;

function bar() {
    let el = document.getElementById('undoBar');
    if (!el) {
        el = document.createElement('div');
        el.id = 'undoBar';
        el.className = 'toast undo-bar';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        const text = document.createElement('span');
        text.className = 'undo-bar-text';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-sm undo-bar-btn';
        button.addEventListener('click', () => {
            const undo = pending;
            hideUndo();
            if (undo) undo();
        });
        el.append(text, button);
        document.body.appendChild(el);
    }
    return el;
}

/** Hides the bar; the last removal stays removed. */
export function hideUndo() {
    clearTimeout(timer);
    pending = null;
    document.getElementById('undoBar')?.classList.remove('show');
}

/**
 * Shows "message · Undo".
 * @param {string} message - what was removed
 * @param {() => void} onUndo - puts it back
 * @param {number} [ms]
 */
export function showUndo(message, onUndo, ms = UNDO_MS) {
    if (typeof document === 'undefined') return;
    const el = bar();
    /** @type {HTMLElement} */ (el.querySelector('.undo-bar-text')).textContent = message;
    /** @type {HTMLElement} */ (el.querySelector('.undo-bar-btn')).textContent = t('ui.common.undo');
    pending = onUndo;
    el.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(hideUndo, ms);
}
