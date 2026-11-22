/**
 * @fileoverview Bill details split the money the way Today's "By bill type" does
 * (#141, T18): paid at save, paid later, written off and still due, adding up to
 * the total, so tapping a row on Today shows matching parts.
 */
jest.mock('../firebase/firestore-service.js', () => ({
    FirebaseService: { db: null, voidedBills: jest.fn(() => []), loadBillEdits: jest.fn(async () => []), calculateStock: jest.fn(async () => ({})) }
}));
jest.mock('../services/printer.js', () => ({ PrinterService: {} }));
jest.mock('../services/audit.js', () => ({ AuditService: { log: jest.fn(async () => {}), ACTIONS: {} } }));
jest.mock('../ui/infinite-scroll.js', () => ({ attachOlderHistoryScroll: jest.fn() }));

import fs from 'fs';
import path from 'path';
import { AppState } from '../utils/state.js';
import { HistoryManager } from '../modules/history.js';
import { setLang } from '../i18n/index.js';

const MODALS = fs.readFileSync(path.resolve(__dirname, '../../templates/modals.html'), 'utf8');
const NOW = Date.now();
const sale = (extra) => ({
    id: 'w1', billNumber: 'W-1', type: 'wholesale', userId: 'u1', createdAt: NOW, timestamp: NOW, date: new Date(NOW).toISOString(),
    customerName: 'Trader', items: [{ name: 'Maize', qty: 200, rate: 25, total: 5000 }], total: 5000, ...extra
});
const lines = () => {
    const h3 = [...document.querySelectorAll('#billDetailsContent h3')].find(h => h.textContent === 'Payment details');
    return [...h3.parentElement.children].slice(1).map(d => d.textContent.replace(/\s+/g, ' ').trim());
};

beforeEach(() => {
    setLang('en');
    document.body.innerHTML = MODALS;
    AppState.currentUser = { uid: 'u1' };
    AppState.userRole = 'owner';
    AppState.settings = {};
});

test('U-67: money first (party, total, Paid / Due chips), bill no and times folded at the end, Void last', async () => {
    AppState.salesHistory = [sale({
        payment: { cash: 2500, online: 500, due: 2000, total: 5000 },
        payments: [{ id: 'p1', cash: 1500, online: 500, at: NOW }]
    })];
    await HistoryManager.viewBill('id:w1', 'wholesale');
    const head = document.querySelector('#billDetailsContent .bill-view-head');
    expect(head.textContent.replace(/\s+/g, ' ')).toMatch(/₹5,000.*Paid ₹3,000.*Due ₹2,000/);
    expect(document.querySelector('#billDetailsContent .bill-view-more .bill-view-no').textContent).toBe('#W-1');
    expect(document.querySelector('#billDetailsContent .bill-view-more').open).toBe(false);
    const actions = [...document.querySelectorAll('.bill-details-footer button')].map(b => b.id);
    expect(actions.indexOf('billVoidBtn')).toBeGreaterThan(actions.indexOf('billEditBtn'));
});

test('paid later: save-time cash/online, then the later payments, then the due', async () => {
    AppState.salesHistory = [sale({
        payment: { cash: 2500, online: 500, due: 2000, total: 5000 },
        payments: [{ id: 'p1', cash: 1500, online: 500, at: NOW }]
    })];
    await HistoryManager.viewBill('id:w1', 'wholesale');
    expect(lines()).toEqual(['Cash at save ₹1,000', 'Paid later cash ₹1,500 · online ₹500 ₹2,000', 'Due ₹2,000']);
});

test('no later payment: plain Cash / Online labels, as before', async () => {
    AppState.salesHistory = [sale({ payment: { cash: 4000, online: 1000, due: 0, total: 5000 } })];
    await HistoryManager.viewBill('id:w1', 'wholesale');
    expect(lines()).toEqual(['Online ₹1,000', 'Cash ₹4,000']);
});

test('written off later', async () => {
    AppState.salesHistory = [sale({ cleared: true, payment: { cash: 3000, online: 0, due: 2000, total: 5000 }, payments: [{ id: 'p2', kind: 'writeOff', amount: 2000, at: NOW }] })];
    await HistoryManager.viewBill('id:w1', 'wholesale');
    expect(lines()).toEqual(['Cash at save ₹3,000', 'Written off ₹2,000']);
});

test('a voided bill still shows what was paid', async () => {
    AppState.salesHistory = [sale({ voided: true, voidReason: 'Entered twice', payment: { cash: 4500, online: 500, due: 0, total: 5000 } })];
    await HistoryManager.viewBill('id:w1', 'wholesale');
    expect(lines()).toEqual(['Online ₹500', 'Cash ₹4,500']);
});

test('the dialog is titled with the bill number and party; amounts are in ink, an old due is a toned tag', async () => {
    const old = NOW - 45 * 86400000;
    AppState.salesHistory = [sale({ date: new Date(old).toISOString(), createdAt: old, timestamp: old, payment: { cash: 3000, online: 0, due: 2000, total: 5000 } })];
    await HistoryManager.viewBill('id:w1', 'wholesale');
    expect(document.getElementById('billDetailsTitle').textContent).toBe('Bill #W-1');
    expect(document.getElementById('billDetailsParty').textContent).toBe('Trader');
    expect(document.getElementById('billDetailsParty').hidden).toBe(false);
    const panel = [...document.querySelectorAll('#billDetailsContent h3')].find(h => h.textContent === 'Payment details').parentElement;
    expect([...panel.querySelectorAll('.tag')].map(t => [t.className, t.textContent])).toEqual([['tag warn', '₹2,000']]);
    expect(panel.querySelector('.row-amt').textContent).toBe('₹3,000');
});

test('NEW-13: a note is a plain row in the sheet, not a warning; the party is named once (the title line)', async () => {
    AppState.salesHistory = [sale({ comments: '8340570373', payment: { cash: 5000, online: 0, due: 0, total: 5000 } })];
    await HistoryManager.viewBill('id:w1', 'wholesale');
    const content = document.getElementById('billDetailsContent');
    expect(content.querySelector('.notice.warn')).toBeNull();
    const note = content.querySelector('.bill-view-sheet .bill-view-note');
    expect(note.textContent.replace(/\s+/g, ' ').trim()).toBe('Comments 8340570373');
    expect(document.getElementById('billDetailsParty').textContent).toBe('Trader');
    expect(content.textContent.split('Trader')).toHaveLength(1);
});
const css = (file) => fs.readFileSync(path.resolve(__dirname, '../../css', file), 'utf8').replace(/\r\n/g, '\n');
const rule = (file, selector) => {
    const m = css(file).match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
    return m ? m[1] : null;
};

test('F58: item names follow the item-name language (Hindi), by item id or by the stored name', async () => {
    AppState.items = [{ id: 'i1', name: 'Wheat', hindiName: 'गेहूँ' }, { id: 'i2', name: 'Maize', hindiName: 'मक्का' }];
    AppState.settings = { showHindi: true };
    AppState.salesHistory = [sale({ items: [
        { itemId: 'i1', name: 'Wheat', qty: 70, rate: 25, total: 1750, weights: [35, 35] },
        { name: 'Maize', qty: 130, rate: 25, total: 3250 },
        { name: 'Bajra', qty: 0, rate: 0, total: 0 }
    ] })];
    await HistoryManager.viewBill('id:w1', 'wholesale');
    const names = [...document.querySelectorAll('#billDetailsContent .bill-view-items tbody tr td:first-child')].map(td => td.textContent);
    expect(names).toEqual(['गेहूँ', 'मक्का', 'Bajra']);
    expect(document.querySelector('#billDetailsContent .bill-view-weight .row-title').textContent).toMatch(/^गेहूँ \(/);

    AppState.settings = { showHindi: false };
    await HistoryManager.viewBill('id:w1', 'wholesale');
    expect(document.querySelector('#billDetailsContent .bill-view-items td').textContent).toBe('Wheat');
    AppState.items = [];
});

test('F49: one panel; Paid / Due are plain text, not tags; "Labour" in ink; each weight kept whole', async () => {
    AppState.purchaseHistory = [{
        id: 'p1', billNumber: 'P-1', type: 'purchase', createdAt: NOW, timestamp: NOW, date: new Date(NOW).toISOString(), customerName: 'Farmer',
        items: [{ name: 'Wheat', qty: 79.6, rate: 20, total: 1592, weights: [39.8, 39.8] }], labour: 12, total: 1580, totalPackets: 2,
        payment: { cash: 500, online: 0, due: 1080, total: 1580 }
    }];
    await HistoryManager.viewBill('id:p1', 'purchase');
    const view = document.querySelector('#billDetailsContent .bill-view');
    expect(view.querySelectorAll('.panel:not(details)')).toHaveLength(1);
    const head = view.querySelector('.bill-view-head');
    expect(head.querySelector('.tag')).toBeNull();
    expect(head.querySelector('.bill-view-paid').textContent).toBe('Paid ₹500 · Due ₹1,080');
    const labour = [...view.querySelectorAll('.bill-view-total')].find(r => r.querySelector('.row-main').textContent === 'Labour');
    expect(labour).toBeTruthy();
    expect(labour.querySelector('.row-amt').className).toBe('row-amt');
    expect([...view.querySelectorAll('.bill-view-weights .bill-view-w')].map(s => s.textContent)).toEqual(['39.8', '39.8']);
    expect(rule('history.css', '.bill-view-w')).toMatch(/white-space:\s*nowrap/);
    expect(rule('history.css', '.bill-view-weights')).not.toMatch(/overflow-wrap:\s*anywhere/);
});

test('N1 / F19: controls inherit the app font; the bill no. has no underline; the pay label sits above its inputs', () => {
    expect(rule('variables.css', 'button,\ninput,\nselect,\ntextarea')).toMatch(/font-family:\s*inherit/);
    expect(rule('outstanding.css', '.due-bill-link')).toMatch(/text-decoration:\s*none/);
    expect(rule('outstanding.css', '.due-bill-pay > label')).toMatch(/flex:\s*0 0 100%/);
    expect(rule('outstanding.css', '.due-bill-due')).toMatch(/margin-left:\s*auto/);
});
