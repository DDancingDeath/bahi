/**
 * @fileoverview A bill line's first cell on Purchase, Retail sale and Wholesale (U-18, U-59): the item
 * and, under it in one small line, its bag / packet weights, so each line shows once.
 * @module ui/bill-line
 */

import { Helpers } from '../utils/helpers.js';
import { formatKg } from '../utils/money.js';
import { tn } from '../i18n/index.js';

/**
 * @param {string} label - the item's name as shown
 * @param {*} [weights] - the line's weights; two or more are listed
 * @returns {string} HTML
 */
export function lineNameHtml(label, weights) {
    const list = Array.isArray(weights) && weights.length >= 2 ? weights : null;
    const name = `<span class="bill-line-name">${Helpers.escapeHtml(label)}</span>`;
    if (!list) return name;
    const text = tn('ui.billing.line_packets', list.length, { list: list.map(w => formatKg(w)).join(' · ') });
    return `${name}<span class="bill-line-weights">${Helpers.escapeHtml(text)}</span>`;
}
