// @ts-check
/**
 * @fileoverview Info tip (docs/design-system.md §3): the one way to put help or an explanation behind an ⓘ, so a screen
 * keeps one short line. A `details.menu.info-tip` whose ⓘ `<summary>` opens a small floating `.panel.menu-list.info-pop`;
 * ui/menus.js closes it on a tap elsewhere, Esc or Tab out and keeps it in the window.
 * @module ui/info-tip
 */

import { icon } from './icons.js';
import { t } from '../i18n/index.js';
import { Helpers } from '../utils/helpers.js';

const esc = (/** @type {*} */ s) => Helpers.escapeHtml(String(s ?? ''));

/**
 * @param {string} text plain text (escaped here); empty gives ''
 * @param {{label?: string}} [o] label: the ⓘ's accessible name (default "More info")
 * @returns {string}
 */
export function infoTipHtml(text, o = {}) {
    if (!String(text ?? '').trim()) return '';
    const label = o.label || t('ui.common.more_info');
    return '<details class="menu info-tip">'
        + `<summary class="btn btn-ghost btn-icon info-tip-btn" aria-label="${esc(label)}" title="${esc(label)}">${icon('info', 'i-sm')}</summary>`
        + `<div class="panel menu-list info-pop" role="note">${esc(text)}</div></details>`;
}

/**
 * The same as an element, for code that builds the DOM.
 * @param {string} text
 * @param {{label?: string, cls?: string}} [o]
 * @returns {?HTMLElement}
 */
export function infoTipEl(text, o = {}) {
    const html = infoTipHtml(text, o);
    if (!html) return null;
    const box = document.createElement('div');
    box.innerHTML = html;
    return /** @type {HTMLElement} */ (box.firstElementChild);
}
