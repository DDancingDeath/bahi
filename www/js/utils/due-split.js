// @ts-check
/**
 * @fileoverview Receive / pay from a party (Outstanding, U-68): the "Full" and "Oldest bill"
 * amounts, and a payment split into cash and online over the bills it settles. Pure.
 * @module utils/due-split
 */

import { round2, sumMoney } from './money.js';

/**
 * "Full" (every due) or "Oldest bill" (the first due), whole rupees up.
 * @param {number[]} dues oldest first
 * @param {'full'|'oldest'} what
 * @returns {number}
 */
export function quickAmount(dues, what) {
    const list = dues || [];
    const amount = what === 'oldest' ? Number(list[0]) || 0 : sumMoney(list, (/** @type {*} */ d) => Number(d) || 0);
    return amount > 0 ? Math.ceil(round2(amount)) : 0;
}

/**
 * The cash typed for a split: 0 when blank, at most the total; null when it is not a number,
 * negative or more than the total.
 * @param {string|number} raw
 * @param {number} total
 * @param {number} [tolerance]
 * @returns {?number}
 */
export function splitCash(raw, total, tolerance = 0.01) {
    const text = String(raw ?? '').trim();
    const cash = text === '' ? 0 : round2(Number(text));
    const max = round2(total);
    if (!Number.isFinite(cash) || cash < 0 || cash > max + tolerance) return null;
    return Math.min(cash, max);
}

/** What is left to pay online after the cash part. */
export const onlineRest = (/** @type {number} */ total, /** @type {number} */ cash) => round2(Math.max(0, total - cash));

/**
 * The cash of each bill's part: the cash fills the bills oldest first, the rest of each part is online.
 * @param {number[]} amounts each bill's part, oldest first
 * @param {number} cash
 * @returns {number[]}
 */
export function splitCashOldestFirst(amounts, cash) {
    let rest = round2(Math.max(0, Number(cash) || 0));
    return (amounts || []).map(a => {
        const part = round2(Math.min(rest, Math.max(0, Number(a) || 0)));
        rest = round2(rest - part);
        return part;
    });
}

/**
 * One bill's payment entry parts.
 * @param {'cash'|'online'|'split'} method
 * @param {number} amount the bill's part
 * @param {?number} [cashPart] split only: its cash
 * @returns {{cash: number, online: number}}
 */
export function paymentParts(method, amount, cashPart = null) {
    if (method === 'split') {
        const cash = round2(Math.min(amount, Number(cashPart) || 0));
        return { cash, online: round2(amount - cash) };
    }
    return method === 'online' ? { cash: 0, online: amount } : { cash: amount, online: 0 };
}
