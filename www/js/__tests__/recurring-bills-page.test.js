/**
 * Recurring bills (#437): the owner, managers and members (Roles & access) see it and pay; the owner and
 * managers keep the items. Read once per open; a payment is saved with its one expense (RB-12; cash /
 * online always picked) or linked to one already in Expenses; an unusual bill asks once and never
 * blocks; Today's figure (RB-11) is kept without another read.
 */
jest.mock('../firebase/repos/recurring-bills.js', () => ({
    loadBillItems: jest.fn(),
    addBillItem: jest.fn(),
    updateBillItem: jest.fn(),
    addEntry: jest.fn(),
    removeEntry: jest.fn(),
    payWrite: jest.fn((id, entry) => ({ payWrite: id, entry })),
    linkedWrite: jest.fn((id, payId) => ({ linkedWrite: id, payId }))
}));

import * as repo from '../firebase/repos/recurring-bills.js';
import { RecurringBillsManager as R } from '../modules/recurring-bills.js';
import { AppState } from '../utils/state.js';
import { UIManager } from '../ui/ui-manager.js';
import { FirebaseService } from '../firebase/firestore-service.js';
import * as billStatus from '../ui/bill-status.js';
import { monthKeyOf, addMonthKey } from '../utils/recurring-bills.js';
import { billsDueReminder } from '../utils/pay-reminder.js';
import { todayLocalISO } from '../utils/dates.js';

const NOW = monthKeyOf(new Date());
const TODAY = todayLocalISO();
const PREV = addMonthKey(NOW, -1);
// Monthly water bill due on the 1st, started last month: last month's ₹400 was paid; this month's ₹450 is entered, ₹200 paid
const water = () => ({ id: 'b1', name: 'Water', cadence: 1, dueDay: 1, startMonth: PREV, expected: 0, active: true, endMonth: '', note: '', entries: [
    { id: 'x1', kind: 'bill', period: PREV, date: `${PREV}-01`, amount: 400 },
    { id: 'x2', kind: 'pay', period: PREV, date: `${PREV}-02`, amount: 400, mode: 'cash' },
    { id: 'x3', kind: 'bill', period: NOW, date: `${NOW}-01`, amount: 450 },
    { id: 'x4', kind: 'pay', period: NOW, date: `${NOW}-01`, amount: 200, mode: 'online' }
] });
const body = () => document.getElementById('recurringBody');
const tag = () => body().querySelector('[data-rbill="b1"] [data-rb-state]');
const card = (id) => body().querySelector(`[data-rb="${id}"]`).textContent;

let saved;
beforeEach(() => {
    document.body.innerHTML = '<div id="recurring" class="tab active"><div id="recurringBody"></div></div><div id="toast"></div>';
    AppState.userRole = 'owner';
    AppState.currentUser = { uid: 'o1' };
    AppState.settings = {};
    AppState.expensesHistory = [];
    localStorage.clear();
    jest.clearAllMocks();
    R.reset();
    repo.loadBillItems.mockResolvedValue([water()]);
    jest.spyOn(UIManager, 'showToast').mockImplementation(() => {});
    saved = [];
    jest.spyOn(FirebaseService, 'startSaveExpense').mockImplementation((expense, opts) => {
        const record = { id: `exp${saved.length + 1}`, ...expense };
        saved.push({ expense, opts, record });
        return { record, committed: Promise.resolve(), stored: Promise.resolve(true) };
    });
    jest.spyOn(FirebaseService, 'linkExpense').mockResolvedValue(undefined);
    jest.spyOn(FirebaseService, 'voidExpense').mockResolvedValue({});
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => { AppState.currentUser = null; });

/** Opens the payment form of the water bill, with cash or online picked (none is picked for you). */
async function payForm(mode) {
    await R.init();
    R.open('b1');
    R.showForm('pay');
    if (mode) R.pick('mode', mode);
}

test('a role with Recurring bills switched off in Roles & access gets no read and no data', async () => {
    AppState.settings = { roleAccess: { manager: { recurringBills: false }, staff: { recurringBills: false } } };
    for (const role of ['manager', 'staff']) {
        AppState.userRole = role;
        await R.init();
        expect(body().textContent).toMatch(/can't see this page/);
    }
    expect(repo.loadBillItems).not.toHaveBeenCalled();
    expect(await R.refreshBillsDue()).toBe(false);
    expect(repo.loadBillItems).not.toHaveBeenCalled();
});

test('by default managers and members see the page; members record payments but never add, edit, stop or enter bills', async () => {
    for (const role of ['manager', 'staff']) {
        AppState.userRole = role;
        await R.init();
        R.open('b1');
        const buttons = [...body().querySelectorAll('button')].map(b => b.getAttribute('data-onclick'));
        expect(buttons).toContain("recurring.showForm('pay')");
        const keeps = ["recurring.showForm('add')", "recurring.showForm('edit')", "recurring.showForm('bill')", "recurring.showForm('stop')"];
        keeps.forEach(k => expect(buttons.includes(k)).toBe(role === 'manager'));
        R.open('b1');
    }
    expect(repo.loadBillItems).toHaveBeenCalledTimes(2);
});

test('the owner reads once per open; the period is overdue (past the 1st) with its cards', async () => {
    await R.init();
    await R.init();
    expect(repo.loadBillItems).toHaveBeenCalledTimes(2);
    const day1 = TODAY.endsWith('-01');
    expect(tag().textContent).toBe(day1 ? 'Part-paid, ₹200 of ₹450' : 'Overdue, ₹250');
    expect([card('RB-8'), card('RB-9'), card('RB-5')]).toEqual(['₹250', '₹200', '₹0']);
});

test('paying the rest saves one expense with the payment in one batch, and the bill shows paid; nothing is saved without cash / online or with a bad amount', async () => {
    await payForm();
    expect(document.getElementById('rbAmount').value).toBe('250');
    expect(document.getElementById('rbPeriod').value).toBe(NOW);
    expect(body().querySelectorAll('[data-rb-seg="mode"] [aria-pressed="true"]')).toHaveLength(0);
    await R.savePay();
    expect(UIManager.showToast).toHaveBeenLastCalledWith('Choose Cash or Online.', 'warning');
    R.pick('mode', 'online');
    document.getElementById('rbAmount').value = '12.5';
    await R.savePay();
    expect(FirebaseService.startSaveExpense).not.toHaveBeenCalled();
    document.getElementById('rbAmount').value = '250';
    await R.savePay();
    expect(repo.addEntry).not.toHaveBeenCalled();
    expect(saved).toHaveLength(1);
    const entry = repo.payWrite.mock.calls[0][1];
    expect(entry).toMatchObject({ kind: 'pay', period: NOW, date: TODAY, amount: 250, mode: 'online' });
    expect(saved[0].expense).toMatchObject({ type: 'Bills', category: 'business', amount: 250, paymentMode: 'online', day: TODAY, remarks: 'Water', recurringBillId: 'b1', recurringPayId: entry.id, createdBy: 'o1' });
    expect(saved[0].opts.withBatch).toBe(repo.payWrite.mock.results[0].value);
    expect(tag().textContent).toBe('Paid');
    expect(body().querySelector(`[data-entry="${entry.id}"] [data-rb-not-in-money]`)).toBeNull();
});

test('"Already entered in Expenses": the expense picked (same amount first, within 3 days) is linked; no new expense', async () => {
    AppState.expensesHistory = [
        { id: 'far', type: 'Water', amount: 250, category: 'business', paymentMode: 'cash', day: '2000-01-01', date: '1/1/2000, 10:00:00 am' },
        { id: 'tea', type: 'Tea', amount: 40, category: 'business', paymentMode: 'cash', day: TODAY },
        { id: 'w', type: 'Water bill', amount: 250, category: 'business', paymentMode: 'online', day: TODAY }
    ];
    await payForm();
    R.pick('inExp', 'have');
    const offered = [...body().querySelectorAll('input[name="rbExpense"]')].map(i => i.value);
    expect(offered).toEqual(['w', 'tea']);
    await R.savePay();
    expect(UIManager.showToast).toHaveBeenLastCalledWith('Pick the expense this payment is.', 'warning');
    R.pick('expenseId', 'w');
    await R.savePay();
    expect(FirebaseService.startSaveExpense).not.toHaveBeenCalled();
    expect(FirebaseService.linkExpense).toHaveBeenCalledTimes(1);
    const [id, fields, write] = FirebaseService.linkExpense.mock.calls[0];
    const entry = repo.payWrite.mock.calls[0][1];
    expect([id, fields, write]).toEqual(['w', { recurringBillId: 'b1', recurringPayId: entry.id }, repo.payWrite.mock.results[0].value]);
    expect(entry).toMatchObject({ amount: 250, date: TODAY, mode: 'online' });
    expect(tag().textContent).toBe('Paid');
});

test('cash on an earlier day: refused for a member (as noBackdatedCash), allowed for the owner; online is fine', async () => {
    const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
    AppState.userRole = 'staff';
    await payForm('cash');
    document.getElementById('rbDate').value = yesterday;
    document.getElementById('rbPeriod').value = document.getElementById('rbPeriod').options[0].value;
    await R.savePay();
    expect(FirebaseService.startSaveExpense).not.toHaveBeenCalled();
    expect(UIManager.showToast).toHaveBeenLastCalledWith(expect.stringMatching(/Only the owner can record cash on an earlier day/), 'warning');
    R.pick('mode', 'online');
    await R.savePay();
    expect(saved).toHaveLength(1);
    expect(saved[0].expense).toMatchObject({ paymentMode: 'online', day: yesterday });
});

test('a bill over 3× the last one asks "Yes, it\'s right" once and is saved after it; a correction is a new entry', async () => {
    const item = { ...water(), entries: water().entries.slice(0, 2) };
    repo.loadBillItems.mockResolvedValue([item]);
    await R.init();
    R.open('b1');
    R.showForm('bill');
    expect(document.getElementById('rbPeriod').value).toBe(NOW);
    document.getElementById('rbAmount').value = '4500';
    await R.saveBill();
    expect(repo.addEntry).not.toHaveBeenCalled();
    expect(document.getElementById('rbUnusual').textContent).toContain('₹400');
    await R.saveBill(true);
    expect(repo.addEntry).toHaveBeenCalledTimes(1);
    expect(repo.addEntry.mock.calls[0][1]).toMatchObject({ kind: 'bill', period: NOW, amount: 4500 });
    R.showForm('bill');
    document.getElementById('rbPeriod').value = NOW;
    document.getElementById('rbAmount').value = '450';
    await R.saveBill();
    expect(repo.addEntry).toHaveBeenCalledTimes(2);
    expect(body().querySelector(`tr[data-period="${NOW}"]`).textContent).toContain('₹450');
});

test('adding an item, editing it (schedule fixed once there are entries) and stopping it', async () => {
    repo.loadBillItems.mockResolvedValue([]);
    repo.addBillItem.mockResolvedValue('n1');
    await R.init();
    R.showForm('add');
    document.getElementById('rbName').value = 'Electricity';
    document.getElementById('rbCadence').value = '2';
    document.getElementById('rbDueDay').value = '29';
    await R.saveItem();
    expect(repo.addBillItem).not.toHaveBeenCalled();
    document.getElementById('rbDueDay').value = '10';
    await R.saveItem();
    expect(repo.addBillItem).toHaveBeenCalledWith({ name: 'Electricity', cadence: 2, dueDay: 10, startMonth: NOW, expected: 0, note: '' });
    R.showForm('edit');
    expect(document.getElementById('rbCadence').disabled).toBe(false);
    document.getElementById('rbExpected').value = '1200';
    await R.saveEdit();
    expect(repo.updateBillItem).toHaveBeenLastCalledWith('n1', { name: 'Electricity', cadence: 2, dueDay: 10, startMonth: NOW, expected: 1200, note: '' });
    R.showForm('stop');
    await R.saveStop();
    expect(repo.updateBillItem).toHaveBeenLastCalledWith('n1', { active: false, endMonth: NOW });

    repo.loadBillItems.mockResolvedValue([water()]);
    await R.init();
    R.open('b1');
    R.showForm('edit');
    expect(document.getElementById('rbCadence').disabled).toBe(true);
    document.getElementById('rbName').value = 'Jal';
    await R.saveEdit();
    expect(repo.updateBillItem).toHaveBeenLastCalledWith('b1', { name: 'Jal', dueDay: 1, expected: 0, note: '' });
});

test('stopping before a month that already has a bill asks first; No writes nothing', async () => {
    const it = { ...water(), entries: [...water().entries, { id: 'x5', kind: 'bill', period: addMonthKey(NOW, 1), date: TODAY, amount: 500 }] };
    repo.loadBillItems.mockResolvedValue([it]);
    const modal = jest.spyOn(UIManager, 'showModal').mockResolvedValue(false);
    await R.init();
    R.open('b1');
    R.showForm('stop');
    document.getElementById('rbLastMonth').value = NOW;
    await R.saveStop();
    expect(modal.mock.calls[0][0]).toMatch(/A bill is already entered for .* Stop anyway\?/);
    expect(repo.updateBillItem).not.toHaveBeenCalled();
    modal.mockResolvedValue(true);
    await R.saveStop();
    expect(repo.updateBillItem).toHaveBeenCalledWith('b1', { active: false, endMonth: NOW });
});

test('an older payment (not in Money): marked; the owner adds it to Money or removes it, exactly as loaded; others do neither', async () => {
    jest.spyOn(UIManager, 'showModal').mockResolvedValue(true);
    AppState.userRole = 'manager';
    await R.init();
    R.open('b1');
    expect(body().querySelectorAll('[data-rb-not-in-money]')).toHaveLength(2);
    expect(body().querySelector('[data-onclick^="recurring.addToMoney"]')).toBeNull();
    await R.removeEntry('b1', 'x4');
    await R.addToMoney('b1', 'x4');
    expect(repo.removeEntry).not.toHaveBeenCalled();
    expect(FirebaseService.startSaveExpense).not.toHaveBeenCalled();

    AppState.userRole = 'owner';
    await R.init();
    R.open('b1');
    await R.removeEntry('b1', 'x3');
    expect(repo.removeEntry).not.toHaveBeenCalled();
    await R.addToMoney('b1', 'x2');
    expect(saved[0].expense).toMatchObject({ type: 'Bills', amount: 400, paymentMode: 'cash', day: `${PREV}-02`, recurringBillId: 'b1', recurringPayId: 'x2' });
    expect(repo.linkedWrite).toHaveBeenCalledWith('b1', 'x2');
    expect(body().querySelector('[data-entry="x2"] [data-rb-not-in-money]')).toBeNull();
    await R.removeEntry('b1', 'x4');
    expect(repo.removeEntry).toHaveBeenCalledWith('b1', water().entries[3]);
});

test('a payment in Money is taken off only by voiding its expense (VOID-EXP), by whoever may void that expense', async () => {
    const item = { ...water(), entries: [...water().entries.slice(0, 3), { ...water().entries[3], expenseId: 'e4' }] };
    repo.loadBillItems.mockResolvedValue([item]);
    AppState.expensesHistory = [{ id: 'e4', amount: 200, category: 'business', paymentMode: 'online', userId: 's1', timestamp: Date.now(), day: TODAY, recurringBillId: 'b1', recurringPayId: 'x4' }];
    jest.spyOn(billStatus, 'askReason').mockResolvedValue('wrong bill');
    AppState.userRole = 'staff';
    AppState.currentUser = { uid: 's2' };
    await R.init();
    R.open('b1');
    expect(body().querySelector('[data-entry="x4"] button')).toBeNull();
    await R.removeEntry('b1', 'x4');
    expect(FirebaseService.voidExpense).not.toHaveBeenCalled();

    AppState.currentUser = { uid: 's1' };
    await R.init();
    expect(body().querySelector('[data-entry="x4"] button').textContent).toBe('Void');
    await R.removeEntry('b1', 'x4');
    expect(FirebaseService.voidExpense).toHaveBeenCalledWith('e4', 'wrong bill');
    expect(repo.removeEntry).not.toHaveBeenCalled();
    expect(body().querySelector('[data-entry="x4"]')).toBeNull();
    AppState.currentUser = { uid: 'o1' };
});

test('"Link to a recurring bill" from an expense opens the payment form with it picked', async () => {
    AppState.expensesHistory = [{ id: 'w', type: 'Water bill', amount: 250, category: 'business', paymentMode: 'cash', day: TODAY }];
    await R.init();
    R.linkFrom('w');
    R.render();
    expect(body().querySelector('#rbLinkPick').textContent).toContain('₹250');
    R.open('b1');
    expect(body().querySelector('#rbPayForm')).not.toBeNull();
    expect(body().querySelector('input[name="rbExpense"][value="w"]').checked).toBe(true);
    await R.savePay();
    expect(FirebaseService.linkExpense).toHaveBeenCalledWith('w', expect.objectContaining({ recurringBillId: 'b1' }), expect.anything());
});

test('Today\'s bills due (RB-11) is kept when the page loads and saves, with no other read; the daily refresh reads once', async () => {
    await R.init();
    expect(billsDueReminder(localStorage, 'o1', TODAY)).toMatchObject({ count: 1, due: 250, nobill: 0 });
    R.open('b1');
    R.showForm('pay');
    R.pick('mode', 'cash');
    await R.savePay();
    expect(billsDueReminder(localStorage, 'o1', TODAY)).toBeNull();
    expect(repo.loadBillItems).toHaveBeenCalledTimes(1);

    localStorage.clear();
    R.reset();
    repo.loadBillItems.mockResolvedValue([water()]);
    expect(await R.refreshBillsDue()).toBe(true);
    expect(repo.loadBillItems).toHaveBeenCalledTimes(2);
    expect(billsDueReminder(localStorage, 'o1', TODAY)).toMatchObject({ count: 1, due: 250 });
});

test('a background refresh still in flight when the page loads and saves never overwrites the page\'s newer figure', async () => {
    let answer;
    repo.loadBillItems.mockReturnValueOnce(new Promise(r => { answer = r; }));
    const refresh = R.refreshBillsDue();
    await R.init();
    R.open('b1');
    R.showForm('pay');
    R.pick('mode', 'cash');
    await R.savePay();
    expect(billsDueReminder(localStorage, 'o1', TODAY)).toBeNull();
    answer([water()]);
    expect(await refresh).toBe(false);
    expect(billsDueReminder(localStorage, 'o1', TODAY)).toBeNull();
});

test('F63/F39: a skeleton while loading; then Add bill sits on the right of the counts, above the list', async () => {
    let done;
    repo.loadBillItems.mockReturnValue(new Promise(r => { done = r; }));
    const open = R.init();
    expect(body().querySelector('.skel-list[role="status"] .skel')).not.toBeNull();
    expect(body().querySelector('p.empty')).toBeNull();
    done([water()]);
    await open;
    const head = body().querySelector('.rb-list-head');
    expect(head.querySelector('.rb-counts')).not.toBeNull();
    expect(head.lastElementChild.matches('button.rb-add[data-onclick="recurring.showForm(\'add\')"]')).toBe(true);
    expect(head.nextElementSibling.classList.contains('rb-list')).toBe(true);
});
