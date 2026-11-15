// @ts-check
/**
 * @fileoverview Worker pay and recurring-bill payments in Money (U-22, docs/calculations.md M22–M24):
 * money paid out from the Workers and Recurring bills pages in a period, by the entry's `date`
 * (as WP-8 and RB-9), split cash / online. They are kept outside Business expenses (M4) and are
 * shown as their own lines next to profit, spending and cash. Pure; whole rupees.
 * @module utils/linked-outflows
 */

import { parseLocalDate } from './dates.js';

/** @typedef {{total: number, cash: number, online: number, count: number}} Outflow */

const empty = () => ({ total: 0, cash: 0, online: 0, count: 0 });

/**
 * @param {Outflow} acc
 * @param {{date?: string, amount?: *, mode?: string}} e
 * @param {number} from
 * @param {number} to
 */
function addEntry(acc, e, from, to) {
    const day = parseLocalDate(e?.date);
    const at = day ? day.getTime() : NaN;
    if (!Number.isFinite(at) || at < from || at > to) return;
    const amount = Math.round(Number(e.amount) || 0);
    if (amount <= 0) return;
    acc.total += amount;
    if (e.mode === 'online') acc.online += amount;
    else acc.cash += amount;
    acc.count += 1;
}

/**
 * M22 worker pay (pay and advances), M23 recurring-bill payments (`kind: 'pay'` only; a bill
 * amount is not money out), M24 = M22 + M23, for entries dated within [from, to] (local days).
 * @param {Array<{entries?: Array<*>}>|null} workers
 * @param {Array<{entries?: Array<*>}>|null} billItems
 * @param {number} from ms, start of the first day
 * @param {number} to ms, end of the period
 * @returns {{workerPay: Outflow, bills: Outflow, total: Outflow}}
 */
export function linkedOutflows(workers, billItems, from, to) {
    const workerPay = empty();
    const bills = empty();
    (workers || []).forEach(w => (w?.entries || []).forEach(e => addEntry(workerPay, e, from, to)));
    (billItems || []).forEach(b => (b?.entries || []).forEach(e => {
        if (e?.kind === 'pay') addEntry(bills, e, from, to);
    }));
    const total = {
        total: workerPay.total + bills.total,
        cash: workerPay.cash + bills.cash,
        online: workerPay.online + bills.online,
        count: workerPay.count + bills.count
    };
    return { workerPay, bills, total };
}

/** M25 = M6 − M24 and M26 = M14 − M24: a figure after worker pay and bills. */
export const afterLinked = (/** @type {number} */ value, /** @type {{total: Outflow}} */ out) => (Number(value) || 0) - (out?.total?.total || 0);

/**
 * The last workers / recurring-bill items loaded on this phone (the Workers and Recurring bills
 * pages set them on every load; Money loads them itself when they are missing or old).
 * @type {{workers: ?Array<*>, billItems: ?Array<*>, at: number}}
 */
const source = { workers: null, billItems: null, at: 0 };

/** @param {'workers'|'billItems'} kind @param {Array<*>} list @param {number} [at] */
export function setLinkedSource(kind, list, at = Date.now()) {
    source[kind] = Array.isArray(list) ? list : [];
    source.at = at;
}

export const linkedSource = () => source;
