// @ts-check
/**
 * @fileoverview The one expense that counts a recurring-bill payment (#437, docs/calculations.md RB-12)
 * or a worker's pay or advance (#373, WP-12) in Money and Today: built here, or an expense already
 * entered by hand picked instead. The payment carries `expenseId`; the expense carries the link back. Pure.
 * @module utils/linked-expense
 */

import { isActiveExpense, isPersonalExpense, expenseMode } from './money.js';
import { personalDayKey } from './personal-expenses.js';
import { expenseDateFields } from './expense-entry.js';
import { addLocalDays, parseLocalDate, toLocalISODate } from './dates.js';

/** Stored expense types (one value in every language; shown with expenseTypeLabelKey). */
export const BILLS_TYPE = 'Bills';
export const SALARIES_TYPE = 'Salaries';
/** "Already in Expenses" lists expenses this many days either side of the payment's date. */
export const LINK_DAYS = 3;

/** @param {*} type @returns {?string} the i18n key a stored system type is shown with */
export const expenseTypeLabelKey = (type) => (type === BILLS_TYPE ? 'ui.expenses.type_bills' : type === SALARIES_TYPE ? 'ui.expenses.type_salaries' : null);

/** @param {*} e @returns {string} 'YYYY-MM-DD' or '' */
export const expenseDayOf = (e) => (e?.day || personalDayKey(e?.date) || '');

/** @param {*} e the expense already pays a bill (or anything else linked) */
export const isLinkedExpense = (e) => !!(e?.recurringBillId || e?.workerId);

/**
 * RB-12, WP-12: the payment counts in Money: it was saved with its expense, or the owner added one later.
 * @param {{linked?: Object<string, string>}} item
 * @param {{id: string, expenseId?: string}} entry
 */
export const payExpenseId = (item, entry) => entry?.expenseId || item?.linked?.[entry?.id] || '';

/**
 * "Already in Expenses": active business expenses not linked yet, within LINK_DAYS of `day`; the
 * same amount first, then the nearest day, then the newest.
 * @param {Array<*>} expenses
 * @param {{day: string, amount?: number}} want
 * @returns {Array<*>}
 */
export function linkCandidates(expenses, { day, amount }) {
    const from = toLocalISODate(/** @type {Date} */ (addLocalDays(day, -LINK_DAYS)));
    const to = toLocalISODate(/** @type {Date} */ (addLocalDays(day, LINK_DAYS)));
    const at = (/** @type {string} */ d) => parseLocalDate(d)?.getTime() || 0;
    const gap = (/** @type {string} */ d) => Math.abs(at(d) - at(day));
    return (expenses || [])
        .filter(e => e && e.id && isActiveExpense(e) && !isPersonalExpense(e) && !isLinkedExpense(e)
            && Number(e.amount) > 0 && Number.isInteger(Number(e.amount)) && expenseDayOf(e) >= from && expenseDayOf(e) <= to)
        .map(e => ({ e, same: Math.round(Number(e.amount)) === Math.round(Number(amount)) ? 0 : 1, gap: gap(expenseDayOf(e)) }))
        .sort((a, b) => a.same - b.same || a.gap - b.gap || (Number(b.e.timestamp) || 0) - (Number(a.e.timestamp) || 0))
        .map(x => x.e);
}

/**
 * The payment as recorded from a picked expense: its amount, day and mode are the expense's.
 * @param {*} expense
 */
export const payFromExpense = (expense) => ({ amount: Math.round(Number(expense.amount)), date: expenseDayOf(expense), mode: expenseMode(expense), expenseId: String(expense.id) });

/**
 * The expense a new payment creates: business, type "Bills", the payment's amount, mode and day,
 * the bill's name in the remarks, linked both ways (`expenseId` is set on the payment when saved).
 * @param {{id: string, name: string}} item
 * @param {{id: string, amount: number, date: string, mode: string, note?: string}} pay
 * @param {{uid?: string, name?: string, now?: Date}} who
 */
export function billExpense(item, pay, { uid = 'unknown', name = '', now = new Date() } = {}) {
    return {
        type: BILLS_TYPE,
        personName: '',
        amount: pay.amount,
        remarks: [item.name, pay.note].filter(Boolean).join(' · ').slice(0, 200),
        category: 'business',
        paymentMode: pay.mode,
        ...expenseDateFields(pay.date, now),
        timestamp: now.getTime(),
        createdBy: uid,
        createdByName: name,
        recurringBillId: String(item.id),
        recurringPayId: String(pay.id)
    };
}

/**
 * WP-12: the expense a worker's pay or advance creates: business, type "Salaries", the worker's name as
 * the person, the entry's amount, mode and day, linked both ways (`workerId` + `workerPayId`).
 * @param {{id: string, name: string}} worker
 * @param {{id: string, amount: number, date: string, mode: string, kind?: string, month?: string, note?: string}} pay
 * @param {{uid?: string, name?: string, now?: Date, kindText?: string}} who kindText: "Advance" in the app's language for an advance
 */
export function salaryExpense(worker, pay, { uid = 'unknown', name = '', now = new Date(), kindText = '' } = {}) {
    return {
        type: SALARIES_TYPE,
        personName: String(worker.name || '').slice(0, 100),
        amount: pay.amount,
        remarks: [pay.month, kindText, pay.note].filter(Boolean).join(' · ').slice(0, 200),
        category: 'business',
        paymentMode: pay.mode,
        ...expenseDateFields(pay.date, now),
        timestamp: now.getTime(),
        createdBy: uid,
        createdByName: name,
        workerId: String(worker.id),
        workerPayId: String(pay.id)
    };
}
