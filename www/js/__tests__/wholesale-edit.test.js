/**
 * @fileoverview Wholesale bills can be edited after saving (U-30), within the same edit window
 * and with the same edit record as Purchase and Retail: the saved sale opens in the Wholesale form,
 * Save writes it through updateWholesaleSale with a reason, and a sale whose money is unchanged
 * keeps its stored figures.
 */
jest.mock('../firebase/firestore-service.js', () => ({
    FirebaseService: {
        db: null,
        updateWholesaleSale: jest.fn(async () => {}),
        latestBill: jest.fn(async (coll, bill) => ({ bill, changed: false })),
        loadedPaymentSignature: jest.fn(() => 'sig'),
        withLoadedPaymentSignature: jest.fn((b) => b),
        calculateStock: jest.fn(async () => ({})),
        keptServerPayment: jest.fn(() => false),
        savedOnPhoneOnly: jest.fn(() => false),
        saveUnconfirmed: jest.fn(() => false)
    }
}));
jest.mock('../services/audit.js', () => ({
    AuditService: { log: jest.fn(async () => {}), entry: jest.fn((action, details) => ({ action, details })), ACTIONS: { EDIT_SALE: 'EDIT_SALE' } }
}));
jest.mock('../ui/infinite-scroll.js', () => ({ attachOlderHistoryScroll: jest.fn() }));
jest.mock('../ui/bill-status.js', () => ({ ...jest.requireActual('../ui/bill-status.js'), askReason: jest.fn(async () => 'wrong rate') }));

import fs from 'fs';
import path from 'path';
import { FirebaseService } from '../firebase/firestore-service.js';
import { AppState } from '../utils/state.js';
import { WholesaleSalesManager } from '../modules/wholesale-sales.js';
import { BillChecksUI } from '../ui/bill-highlight.js';
import { askReason } from '../ui/bill-status.js';

const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', '..', 'templates', 'wholesale-sales.html'), 'utf8');

const SALE = {
    id: 'w1', billNumber: 'W20261115-001', type: 'wholesale', customerName: 'Shyam',
    items: [{ itemId: 'rice', name: 'Rice', rate: 40, quantity: 10, total: 400 }],
    total: 400, expenses: 0, profit: 100, profitPercent: 25,
    payment: { cash: 400, online: 0, due: 0 }, cashPayment: 400, onlinePayment: 0,
    timestamp: Date.now(), createdBy: 'm1'
};

beforeEach(() => {
    document.body.innerHTML = TEMPLATE;
    AppState.items = [{ id: 'rice', name: 'Rice', wholesaleRates: [40] }];
    AppState.stock = { rice: { quantity: 100, rate: 30 } };
    AppState.stockReady = true;
    AppState.salesHistory = [SALE];
    AppState.settings = {};
    AppState.userRole = 'owner';
    AppState.currentUser = { uid: 'o1' };
    window.app = {};
    jest.spyOn(BillChecksUI, 'confirmSave').mockResolvedValue({ ok: true, flags: [], overrides: [] });
    FirebaseService.updateWholesaleSale.mockClear();
});

afterEach(() => {
    WholesaleSalesManager.cancelEdit();
    jest.restoreAllMocks();
});

test('the saved sale opens in the form with its lines, party and payment; Cancel edit empties it', () => {
    WholesaleSalesManager.openEditor(SALE);
    expect(WholesaleSalesManager.getItems()).toEqual([{ itemId: 'rice', name: 'Rice', rate: 40, qty: 10, total: 400 }]);
    expect(document.getElementById('wholesaleCustomerName').value).toBe('Shyam');
    expect(document.getElementById('wholesaleCashPayment').value).toBe('400');
    expect(document.getElementById('wholesaleEditNotice').hidden).toBe(false);
    expect(document.getElementById('wholesaleEditNoticeText').textContent).toContain('W20261115-001');
    expect(WholesaleSalesManager.getCheckDraft()).toMatchObject({ isEdit: true, id: 'w1', editingBill: SALE });
    WholesaleSalesManager.cancelEdit();
    expect(WholesaleSalesManager.getItems()).toEqual([]);
    expect(document.getElementById('wholesaleEditNotice').hidden).toBe(true);
    expect(WholesaleSalesManager.getEditingSale()).toBeNull();
});

test('a changed rate is saved as an edit with its reason, new total and settled payment', async () => {
    WholesaleSalesManager.openEditor(SALE);
    WholesaleSalesManager.setLineRate(0, 42);
    const saved = await WholesaleSalesManager.completeSale();
    expect(askReason).toHaveBeenCalled();
    expect(FirebaseService.updateWholesaleSale).toHaveBeenCalledTimes(1);
    const [updated, opts] = FirebaseService.updateWholesaleSale.mock.calls[0];
    expect(updated).toMatchObject({ id: 'w1', billNumber: 'W20261115-001', total: 420, editedBy: 'o1' });
    expect(updated.items[0]).toMatchObject({ itemId: 'rice', rate: 42, quantity: 10, total: 420 });
    // Settled on the new total as Billing's edits do (BF-SAVE, #129)
    expect(updated.payment).toMatchObject({ cash: 420, online: 0, due: 0 });
    expect(opts).toMatchObject({ reason: 'wrong rate', audit: { action: 'EDIT_SALE' } });
    expect(saved).toBe(updated);
    expect(WholesaleSalesManager.getEditingSale()).toBeNull();
});

test('an edit that changes no money keeps the stored figures exactly', async () => {
    WholesaleSalesManager.openEditor(SALE);
    document.getElementById('wholesaleCustomerName').value = 'Shyam Traders';
    await WholesaleSalesManager.completeSale();
    const [updated] = FirebaseService.updateWholesaleSale.mock.calls[0];
    expect(updated.customerName).toBe('Shyam Traders');
    expect(updated.items).toBe(SALE.items);
    expect(updated.profit).toBe(100);
});

test('offline: nothing is written and the editor stays open', async () => {
    WholesaleSalesManager.openEditor(SALE);
    const online = jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(await WholesaleSalesManager.completeSale()).toBeUndefined();
    expect(FirebaseService.updateWholesaleSale).not.toHaveBeenCalled();
    expect(WholesaleSalesManager.getEditingSale()).toBe(SALE);
    online.mockRestore();
});
