// @ts-check
/**
 * @fileoverview Disclosure (docs/design-system.md §3): a card that shows one compact row and opens
 * to its full content. The row is a button with aria-expanded; the open / closed choice is kept per
 * device (localStorage `happa.open.<key>`), closed by default, so a redraw keeps it.
 * @module ui/disclosure
 */

import { safeSetItem } from '../utils/storage-full.js';
import { icon } from './icons.js';

const PREFIX = 'happa.open.';

/**
 * @param {string} key
 * @param {?Storage} [store]
 * @returns {boolean} true when this device last left it open
 */
export function isDisclosureOpen(key, store) {
    try { return (store || localStorage).getItem(PREFIX + key) === '1'; } catch (_) { return false; }
}

/** @param {string} key @param {boolean} open @param {?Storage} [store] */
export function setDisclosureOpen(key, open, store) {
    safeSetItem(PREFIX + key, open ? '1' : '0', store || undefined);
}

/**
 * The markup. `title`, `summary`, `tools` and `body` are HTML the caller has escaped.
 * @param {{key: string, id: string, title: string, summary?: string, lead?: string, alert?: string,
 *   tools?: string, body: string, open?: boolean}} o - `alert`: screen-reader text for the amber dot (urgent)
 * @returns {string}
 */
export function disclosureHtml(o) {
    const open = o.open ?? isDisclosureOpen(o.key);
    const bodyId = `${o.id}Body`;
    return `<div class="disclosure" data-disclosure="${o.key}">`
        + '<div class="disclosure-head">'
        + `<h3 class="disclosure-heading"><button type="button" class="disclosure-toggle" id="${o.id}Toggle" aria-expanded="${open}" aria-controls="${bodyId}" data-onclick="disclosure.toggle('${o.key}')">`
        + (o.lead || '')
        + '<span class="disclosure-main"><span class="disclosure-title">'
        + o.title
        + (o.alert ? `<span class="disclosure-dot" data-disclosure-alert></span><span class="sr-only">${o.alert}</span>` : '')
        + '</span>'
        + (o.summary ? `<span class="disclosure-summary">${o.summary}</span>` : '')
        + '</span>'
        + `<span class="disclosure-chev">${icon('chevD')}</span>`
        + '</button></h3>'
        + (o.tools || '')
        + '</div>'
        + `<div class="disclosure-body" id="${bodyId}"${open ? '' : ' hidden'}>${o.body}</div>`
        + '</div>';
}

/**
 * After a redraw: gives the focus back to a row that had it before (`id` as in disclosureHtml).
 * @param {string} id
 * @param {boolean} had
 */
export function refocusDisclosure(id, had) {
    if (had && typeof document !== 'undefined') document.getElementById(`${id}Toggle`)?.focus();
}

/**
 * Opens or closes the disclosure(s) with this key on screen and remembers it.
 * @param {string} key
 * @param {boolean} [open] default: the other state
 * @returns {boolean} the new state
 */
export function toggleDisclosure(key, open) {
    const shown = typeof document !== 'undefined' ? document.querySelector(`[data-disclosure="${key}"] .disclosure-toggle`) : null;
    const now = shown ? shown.getAttribute('aria-expanded') === 'true' : isDisclosureOpen(key);
    const next = typeof open === 'boolean' ? open : !now;
    setDisclosureOpen(key, next);
    if (typeof document !== 'undefined') {
        document.querySelectorAll(`[data-disclosure="${key}"]`).forEach(box => {
            box.querySelector('.disclosure-toggle')?.setAttribute('aria-expanded', String(next));
            const body = box.querySelector('.disclosure-body');
            if (body instanceof HTMLElement) body.hidden = !next;
        });
    }
    return next;
}
