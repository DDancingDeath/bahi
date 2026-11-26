// @ts-check
/**
 * @fileoverview Worker pay in Money (U-22, docs/calculations.md M22, M25, M26): money paid out from the
 * Workers page in a period, by the entry's `date` (as WP-8), split cash / online. Kept outside Business
 * expenses (M4) and shown as its own line next to profit, spending and cash. Recurring-bill payments are
 * not here: each counts through its expense in M4 (RB-12). Pure; whole rupees.
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
 * M22 worker pay (pay and advances) for entries dated within [from, to] (local days).
 * @param {Array<{entries?: Array<*>}>|null} workers
 * @param {number} from ms, start of the first day
 * @param {number} to ms, end of the period
 * @returns {{workerPay: Outflow}}
 */
export function linkedOutflows(workers, from, to) {
    const workerPay = empty();
    (workers || []).forEach(w => (w?.entries || []).forEach(e => addEntry(workerPay, e, from, to)));
    return { workerPay };
}

/** M25 = M6 − M22 and M26 = M14 − M22: a figure after worker pay. */
export const afterLinked = (/** @type {number} */ value, /** @type {{workerPay: Outflow}} */ out) => (Number(value) || 0) - (out?.workerPay?.total || 0);

/**
 * The last workers loaded on this phone (the Workers page sets them on every load; Money loads them
 * itself when they are missing).
 * @type {{workers: ?Array<*>, at: number}}
 */
const source = { workers: null, at: 0 };

/** @param {'workers'} kind @param {?Array<*>} list null = not loaded on this phone @param {number} [at] */
export function setLinkedSource(kind, list, at = Date.now()) {
    source[kind] = list === null ? null : (Array.isArray(list) ? list : []);
    source.at = at;
}

export const linkedSource = () => source;
