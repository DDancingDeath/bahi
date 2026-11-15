/**
 * @fileoverview "A bill with a doubtful rate affects these numbers" (U-01, REC-01): a notice on Stock
 * and Money (Profit, Worth) while a loaded bill has a line at least 5× (or at most ⅕ of) today's
 * Rates-page rate (calc/billing.js doubtfulRateBills), with a button that opens that bill. Nothing
 * is changed: the owner corrects the bill (Edit) or confirms it.
 * @module ui/doubtful-rates
 */

import { AppState } from '../utils/state.js';
import { doubtfulRateBills } from '../utils/calc/billing.js';
import { Helpers } from '../utils/helpers.js';
import { formatRate } from '../utils/money.js';
import { t, tn } from '../i18n/index.js';
import { icon } from './icons.js';

const HISTORY = { purchase: 'purchaseHistory', retail: 'retailSalesHistory', wholesale: 'salesHistory' };

/**
 * Loaded bills of these kinds with a doubtful rate, newest first.
 * @param {Array<'purchase'|'retail'|'wholesale'>} kinds
 * @returns {Array<{id: string, billNumber: ?string, kind: string, item: string, rate: number, todayRate: number}>}
 */
export function doubtfulBills(kinds) {
    return kinds.flatMap(kind => doubtfulRateBills(AppState[HISTORY[kind]], AppState.items, kind));
}

/**
 * The notice, or '' when no loaded bill has a doubtful rate.
 * @param {Array<'purchase'|'retail'|'wholesale'>} [kinds]
 * @returns {string}
 */
export function doubtfulRatesNoticeHtml(kinds = ['purchase']) {
    const list = doubtfulBills(kinds);
    if (!list.length) return '';
    const first = list[0];
    const esc = Helpers.escapeHtml;
    const text = tn('ui.doubtful.notice', list.length, {
        item: first.item, rate: formatRate(first.rate), today: formatRate(first.todayRate)
    });
    const open = `<button type="button" class="btn btn-ghost btn-sm" data-onclick="history.viewBill('id:${Helpers.escapeJsAttr(first.id)}', '${Helpers.escapeJsAttr(first.kind)}')">${esc(t('ui.doubtful.open', { no: first.billNumber || '' }))} ›</button>`;
    return `<div class="notice warn doubtful-rates" role="status">${icon('triangle', 'i-sm')}<span class="grow">${esc(text)}</span>${open}</div>`;
}
