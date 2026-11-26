/**
 * A recurring-bill payment and its one expense (#437, RB-12, VOID-EXP): written together in one batch;
 * an expense already in Expenses is linked with the payment in one batch; voiding the expense takes
 * the payment off its bill in the same transaction.
 */
import { FirebaseService } from '../firebase/firestore-service.js';
import { AppState } from '../utils/state.js';
import { createFakeFirestore } from './__mocks__/fake-firestore.js';
import { payWrite, linkedWrite } from '../firebase/repos/recurring-bills.js';
import { billExpense } from '../utils/linked-expense.js';
import { toLocalISODate } from '../utils/dates.js';

const settle = async (fake, rounds = 10) => {
    for (let i = 0; i < rounds; i++) await fake.settle();
};

describe('recurring-bill payments and their expenses', () => {
    let fake;
    const day = toLocalISODate(new Date());
    const item = { id: 'b1', name: 'Electricity', cadence: 1, dueDay: 10, startMonth: day.slice(0, 7), expected: 0, active: true, endMonth: '', note: '', entries: [] };
    const pay = (id, mode, extra = {}) => ({ id, kind: 'pay', period: day.slice(0, 7), date: day, amount: 1240, mode, ...extra });

    beforeEach(async () => {
        fake = createFakeFirestore();
        global.firebase = fake.firebase;
        fake.seed('items', []);
        fake.seed('recurringBills', [item]);
        AppState.currentUser = { uid: 'u1' };
        AppState.userName = 'U';
        AppState.userRole = 'staff';
        AppState.settings = {};
        jest.spyOn(console, 'info').mockImplementation(() => {});
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        FirebaseService.cleanup();
        await FirebaseService.setupRealtimeListeners();
        await settle(fake);
    });

    afterEach(() => {
        FirebaseService.cleanup();
        jest.restoreAllMocks();
        delete global.firebase;
        AppState.currentUser = null;
        AppState.userRole = null;
    });

    const bill = () => fake.raw('recurringBills').get('b1');

    test('a new payment: the expense and the payment land in one batch, linked both ways', async () => {
        const entry = pay('p1', 'online');
        const batches = jest.spyOn(fake.db, 'batch');
        const { record, committed } = FirebaseService.startSaveExpense(billExpense(item, entry, { uid: 'u1' }), { withBatch: payWrite('b1', entry) });
        await committed;
        await settle(fake);
        expect(batches).toHaveBeenCalledTimes(1);
        expect(fake.raw('expenses').get(record.id)).toMatchObject({ type: 'Bills', amount: 1240, paymentMode: 'online', recurringBillId: 'b1', recurringPayId: 'p1', userId: 'u1' });
        expect(bill().entries).toEqual([{ ...entry, expenseId: record.id }]);
        expect(AppState.expensesHistory.find(e => e.id === record.id)).toBeTruthy();
    });

    test('"Already entered in Expenses": the link fields and the payment in one batch, no new expense', async () => {
        const { record, committed } = FirebaseService.startSaveExpense({ type: 'Bijli', amount: 1240, category: 'business', paymentMode: 'cash', date: new Date().toLocaleString('en-IN'), day });
        await committed;
        await settle(fake);
        const entry = pay('p2', 'cash');
        await FirebaseService.linkExpense(record.id, { recurringBillId: 'b1', recurringPayId: 'p2' }, payWrite('b1', entry));
        await settle(fake);
        expect(fake.raw('expenses').size).toBe(1);
        expect(fake.raw('expenses').get(record.id)).toMatchObject({ type: 'Bijli', recurringBillId: 'b1', recurringPayId: 'p2' });
        expect(bill().entries).toEqual([{ ...entry, expenseId: record.id }]);
    });

    test('voiding a linked expense takes its payment off in the same transaction; an older payment added to Money loses its link too', async () => {
        const entry = pay('p3', 'cash');
        const { record, committed } = FirebaseService.startSaveExpense(billExpense(item, entry, { uid: 'u1' }), { withBatch: payWrite('b1', entry) });
        await committed;
        await settle(fake);
        const voided = await FirebaseService.voidExpense(record.id, 'Wrong bill');
        await settle(fake);
        expect(fake.raw('expenses').get(record.id)).toMatchObject({ voided: true, voidReason: 'Wrong bill' });
        expect(bill().entries).toEqual([]);
        expect(voided.unlinked).toEqual({ coll: 'recurringBills', docId: 'b1', payId: 'p3' });
        expect(Object.keys(voided)).not.toContain('unlinked');

        const old = pay('p0', 'online');
        await fake.db.collection('recurringBills').doc('b1').set({ ...item, entries: [old] });
        AppState.userRole = 'owner';
        const add = FirebaseService.startSaveExpense(billExpense(item, old, { uid: 'u1' }), { withBatch: linkedWrite('b1', 'p0') });
        await add.committed;
        await settle(fake);
        expect(bill().linked).toEqual({ p0: add.record.id });
        await FirebaseService.voidExpense(add.record.id, 'Not ours');
        await settle(fake);
        expect(bill().entries).toEqual([]);
        expect(bill().linked).toEqual({});
    });

    test('an expense with no link is voided as before; its bill is not touched', async () => {
        const { record, committed } = FirebaseService.startSaveExpense({ type: 'Tea', amount: 20, category: 'business', date: new Date().toLocaleString('en-IN'), day });
        await committed;
        await settle(fake);
        const reads = jest.spyOn(fake.db, 'collection');
        await FirebaseService.voidExpense(record.id, 'Twice');
        expect(reads.mock.calls.map(c => c[0])).not.toContain('recurringBills');
        expect(bill().entries).toEqual([]);
    });
});
