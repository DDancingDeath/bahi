/**
 * Oracle (#437 RB-12, #373 WP-12): a recurring-bill payment or a worker's pay counts once, through its one expense,
 * in Money (M4, M13), Today (T4, T8, T9) and the drawer (C3, Expected cash). Only cash moves the drawer; an
 * online payment never changes Expected cash, C3 or T8. The same whether the app saved the expense with the
 * payment or the payment was linked to an expense already in Expenses.
 */
import { billExpense, salaryExpense, payFromExpense, linkCandidates, payExpenseId, BILLS_TYPE, SALARIES_TYPE } from '../../www/js/utils/linked-expense.js';
import { expenseDateFields } from '../../www/js/utils/expense-entry.js';
import { moneySummary } from '../../www/js/utils/business-metrics.js';
import { todaySummary } from '../../www/js/utils/calc/today.js';
import { drawerDay, expectedCash } from '../../www/js/utils/calc/cash.js';

const DAY = '2026-11-20';
const NOW = new Date(2026, 10, 20, 11, 0, 0);
const MONTH = { from: new Date(2026, 10, 1).getTime(), to: new Date(2026, 11, 1).getTime() };
const SESSION = { openingBalance: 1000, date: DAY };
const item = { id: 'b1', name: 'Electricity' };
const pay = (mode) => ({ id: `p-${mode}`, amount: 1240, date: DAY, mode, period: '2026-11' });
// Typed into Expenses by hand before the payment was recorded ("Already entered in Expenses")
const byHand = (mode) => ({ id: `e-${mode}`, type: 'Electricity bill', amount: 1240, category: 'business', paymentMode: mode, ...expenseDateFields(DAY, NOW), timestamp: NOW.getTime() });
const tea = { id: 't1', type: 'Tea', amount: 60, category: 'business', paymentMode: 'cash', ...expenseDateFields(DAY, NOW), timestamp: NOW.getTime() };

function figures(expenses) {
    const m = moneySummary({ expenses }, MONTH);
    const t = todaySummary({ expenses, today: NOW });
    const c = drawerDay({ date: DAY, expenses, session: SESSION });
    return {
        M4: m.M4.total, bills: (m.M4.byCategory.find(x => x.category === BILLS_TYPE) || { total: 0 }).total,
        salaries: (m.M4.byCategory.find(x => x.category === SALARIES_TYPE) || { total: 0 }).total,
        M13cash: m.M13.cash, M13online: m.M13.online,
        T4: t.businessExpenses, T8: t.cashOut, T9: t.onlineOut,
        C3: c.businessExpenses, expected: expectedCash(SESSION, c)
    };
}

const base = figures([tea]);

describe('a payment saved with its expense (Add a new expense)', () => {
    test('cash: counted once in M4 (Bills), M13 cash, T4, T8 and C3; Expected cash goes down by it', () => {
        const exp = billExpense(item, pay('cash'), { uid: 'u1', now: NOW });
        expect(exp).toMatchObject({ type: 'Bills', category: 'business', paymentMode: 'cash', amount: 1240, day: DAY, recurringBillId: 'b1', recurringPayId: 'p-cash', remarks: 'Electricity' });
        const f = figures([tea, exp]);
        expect(f).toEqual({
            ...base, M4: base.M4 + 1240, bills: 1240, M13cash: base.M13cash + 1240,
            T4: base.T4 + 1240, T8: base.T8 + 1240, C3: base.C3 + 1240, expected: base.expected - 1240
        });
    });

    test('online: the same amount changes M4, M13 online and T9 only; Expected cash, C3 and T8 stay as they were', () => {
        const f = figures([tea, billExpense(item, pay('online'), { uid: 'u1', now: NOW })]);
        expect(f).toEqual({ ...base, M4: base.M4 + 1240, bills: 1240, M13online: base.M13online + 1240, T4: base.T4 + 1240, T9: base.T9 + 1240 });
        expect([f.expected, f.C3, f.T8]).toEqual([base.expected, base.C3, base.T8]);
    });

    test('voided (VOID-EXP): counted nowhere', () => {
        const exp = { ...billExpense(item, pay('cash'), { now: NOW }), voided: true };
        expect(figures([tea, exp])).toEqual(base);
    });
});

describe('a payment linked to an expense already in Expenses (no new expense)', () => {
    for (const mode of ['cash', 'online']) {
        test(`${mode}: the payment takes the expense's amount, day and mode; linking changes no figure`, () => {
            const exp = byHand(mode);
            expect(linkCandidates([tea, exp], { day: DAY, amount: 1240 })[0]).toBe(exp);
            expect(payFromExpense(exp)).toEqual({ amount: 1240, date: DAY, mode, expenseId: `e-${mode}` });
            const before = figures([tea, exp]);
            const linked = { ...exp, recurringBillId: 'b1', recurringPayId: 'p1' };
            expect(figures([tea, linked])).toEqual(before);
        });
    }

    test('cash lowers Expected cash by its amount once; online leaves Expected cash, C3 and T8 as without it', () => {
        const cash = figures([tea, { ...byHand('cash'), recurringBillId: 'b1', recurringPayId: 'p1' }]);
        const online = figures([tea, { ...byHand('online'), recurringBillId: 'b1', recurringPayId: 'p2' }]);
        expect(cash.expected).toBe(base.expected - 1240);
        expect([cash.C3, cash.T8]).toEqual([base.C3 + 1240, base.T8 + 1240]);
        expect([online.expected, online.C3, online.T8]).toEqual([base.expected, base.C3, base.T8]);
        expect(online.T9).toBe(base.T9 + 1240);
    });

    test('only unlinked business expenses within 3 days are offered, the same amount first', () => {
        const far = { ...byHand('cash'), id: 'far', ...expenseDateFields('2026-11-10', NOW) };
        const linked = { ...byHand('cash'), id: 'l', recurringBillId: 'b9', recurringPayId: 'x' };
        const personal = { ...byHand('cash'), id: 'p', category: 'personal' };
        const near = { ...byHand('online'), id: 'near', amount: 999 };
        expect(linkCandidates([tea, far, linked, personal, near, byHand('cash')], { day: DAY, amount: 1240 }).map(e => e.id)).toEqual(['e-cash', 't1', 'near']);
    });
});

test('a payment recorded before RB-12 is not in Money until the owner adds it (linked map)', () => {
    const old = { id: 'p0', kind: 'pay', amount: 500, date: DAY, mode: 'cash' };
    expect(payExpenseId({ entries: [old] }, old)).toBe('');
    expect(payExpenseId({ entries: [old], linked: { p0: 'e9' } }, old)).toBe('e9');
    expect(payExpenseId({}, { ...old, expenseId: 'e1' })).toBe('e1');
});

describe('worker pay (WP-12): the same rule, type "Salaries"', () => {
    const worker = { id: 'w1', name: 'Ramu' };
    const entry = (mode, kind = 'pay') => ({ id: `w-${mode}`, amount: 6000, date: DAY, mode, kind, month: '2026-11' });

    test('cash pay lowers Expected cash by its amount and counts once in M4 (Salaries), M13 cash, T4, T8 and C3', () => {
        const exp = salaryExpense(worker, entry('cash'), { uid: 'o1', now: NOW });
        expect(exp).toMatchObject({ type: 'Salaries', personName: 'Ramu', category: 'business', paymentMode: 'cash', amount: 6000, day: DAY, workerId: 'w1', workerPayId: 'w-cash' });
        expect(figures([tea, exp])).toEqual({
            ...base, M4: base.M4 + 6000, salaries: 6000, M13cash: base.M13cash + 6000,
            T4: base.T4 + 6000, T8: base.T8 + 6000, C3: base.C3 + 6000, expected: base.expected - 6000
        });
    });

    test('an online advance of the same amount leaves Expected cash, C3 and T8 unchanged', () => {
        const exp = salaryExpense(worker, entry('online', 'advance'), { now: NOW, kindText: 'Advance' });
        expect(exp.remarks).toBe('2026-11 · Advance');
        const f = figures([tea, exp]);
        expect(f).toEqual({ ...base, M4: base.M4 + 6000, salaries: 6000, M13online: base.M13online + 6000, T4: base.T4 + 6000, T9: base.T9 + 6000 });
    });

    test('"Already entered in Expenses": cash lowers Expected cash once, online not at all; linking changes no figure', () => {
        const byHandPay = (mode) => ({ ...byHand(mode), amount: 6000 });
        for (const mode of ['cash', 'online']) {
            const before = figures([tea, byHandPay(mode)]);
            const linked = figures([tea, { ...byHandPay(mode), workerId: 'w1', workerPayId: 'p' }]);
            expect(linked).toEqual(before);
            expect(linked.expected).toBe(mode === 'cash' ? base.expected - 6000 : base.expected);
            expect([linked.C3, linked.T8]).toEqual(mode === 'cash' ? [base.C3 + 6000, base.T8 + 6000] : [base.C3, base.T8]);
        }
        expect(linkCandidates([{ ...byHand('cash'), workerId: 'w1', workerPayId: 'p' }], { day: DAY, amount: 1240 })).toEqual([]);
    });
});
