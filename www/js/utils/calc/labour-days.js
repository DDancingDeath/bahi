// @ts-check
/**
 * @fileoverview Labour day by day (docs/calculations.md T-LAB-1..5, LH1–LH3): the Today Labour card's figures
 * for one day, and the same figures for every day of a period (Money › Labour). Today and the history both
 * call `labourForDay`, so a day shows the same numbers on both. Pure: no DOM, no AppState, no Firestore.
 * @module utils/calc/labour-days
 */

import { activeExpenses, activityBills, isPersonalExpense, round2 } from '../money.js';
import { parseAnyBillDate, toLocalISODate } from '../dates.js';
import { labourGap, labourPaid, labourPaidGap, labourSummary } from '../labour.js';
import { billDayTime } from './cash.js';

/**
 * One day's labour: T-LAB-1 deducted, T-LAB-2 estimate and T-LAB-4 paid, with T-LAB-3 / T-LAB-5 gaps.
 * @param {Array<?Bill|undefined>} purchaseBills the day's purchase bills (BILL-TIME)
 * @param {Expense[]} businessExpenses the day's business expenses (T4's filter)
 * @param {Rec} [settings] laborRate, labourPackageKg
 */
export function labourForDay(purchaseBills, businessExpenses, settings = {}) {
    const labour = labourSummary(purchaseBills, settings);
    const paid = labourPaid(businessExpenses);
    return {
        ...labour,
        gap: labourGap(labour.difference),
        packets: labour.rows.reduce((sum, r) => sum + r.packets, 0),
        paid,
        paidGap: labourPaidGap(paid.amount, labour.deducted.amount)
    };
}

/**
 * LH3: estimate − paid, to paise. Positive: still owed to labour; negative: paid more than the estimate.
 * @param {number} toPay
 * @param {number} paid
 * @returns {{difference: number, amount: number, kind: 'same'|'owed'|'extra'}} within 50 paise: same
 */
export function labourBalance(toPay, paid) {
    const difference = round2(toPay - paid);
    const amount = Math.abs(difference);
    return { difference, amount, kind: amount < 0.5 ? 'same' : difference > 0 ? 'owed' : 'extra' };
}

/**
 * LH1–LH3: each local day in [from, to) with a purchase bill or a labour payment, newest first, and the period's totals.
 * Bills by BILL-TIME and expenses by their date, as Today picks them; a day's figures are labourForDay's.
 * @param {Object} src
 * @param {Array<?Bill|undefined>} [src.purchases]
 * @param {?Expense[]} [src.expenses]
 * @param {Rec} [src.settings]
 * @param {number} src.from ms, inclusive
 * @param {number} src.to ms, exclusive
 */
export function labourDays({ purchases = [], expenses = [], settings = {}, from, to }) {
    const inRange = (/** @type {number} */ t) => Number.isFinite(t) && t >= from && t < to;
    /** @type {Map<string, {bills: Bill[], expenses: Expense[]}>} */
    const byDay = new Map();
    const slot = (/** @type {string} */ key) => {
        if (!byDay.has(key)) byDay.set(key, { bills: [], expenses: [] });
        return /** @type {{bills: Bill[], expenses: Expense[]}} */ (byDay.get(key));
    };
    activityBills(purchases).forEach(b => {
        const t = billDayTime(b);
        if (inRange(t)) slot(toLocalISODate(new Date(t))).bills.push(/** @type {Bill} */ (b));
    });
    activeExpenses(expenses).forEach(e => {
        if (isPersonalExpense(e)) return;
        const d = parseAnyBillDate(e.date);
        if (d && inRange(d.getTime())) slot(toLocalISODate(d)).expenses.push(e);
    });
    const days = [...byDay.entries()]
        .map(([key, v]) => {
            const day = labourForDay(v.bills, v.expenses, settings);
            const labourExpenses = v.expenses.filter(e => labourPaid([e]).count > 0);
            return { key, ...day, labourExpenses, balance: labourBalance(day.toPay.amount, day.paid.amount) };
        })
        .filter(d => d.rows.length > 0 || d.paid.count > 0)
        .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
    let deducted = 0, toPay = 0, paid = 0;
    days.forEach(d => {
        deducted += d.deducted.amount;
        toPay += d.toPay.amount;
        paid += d.paid.amount;
    });
    const totals = { deducted: round2(deducted), toPay: round2(toPay), paid: round2(paid) };
    return { days, totals: { ...totals, balance: labourBalance(totals.toPay, totals.paid) } };
}
