/**
 * @fileoverview A lighter Billing form: what shows only when it is needed. The rest row only
 * while the split is off, the date line with "Change date" for the owner, notes behind "Add note",
 * Drafts only with drafts, the bill's lines only with lines, labour's working only when it is on.
 * Runs on the real billing.html.
 */
import fs from 'fs';
import path from 'path';
import { BillingManager } from '../modules/billing.js';
import { PurchaseManager } from '../modules/purchase.js';
import { RetailSaleManager } from '../modules/retail-sale.js';
import * as BillDrafts from '../firebase/repos/bill-drafts.js';
import { UIManager } from '../ui/ui-manager.js';
import { AppState } from '../utils/state.js';
import { Helpers } from '../utils/helpers.js';
import { backdatedText, prepareBillDate, renderBillDateLine, resetBillDate, revealBillDate } from '../ui/bill-date-input.js';
import { addLocalDays, formatDate, toLocalISODate } from '../utils/dates.js';
import { validatePaymentSplit } from '../utils/calc/billing.js';

jest.mock('../firebase/repos/bill-drafts.js', () => ({
    getAutoSave: jest.fn(),
    saveAutoSave: jest.fn().mockResolvedValue(undefined),
    deleteAutoSave: jest.fn().mockResolvedValue(undefined),
    saveDraft: jest.fn().mockResolvedValue(undefined),
    countDrafts: jest.fn().mockResolvedValue(0)
}));

const TEMPLATES = path.join(__dirname, '..', '..', 'templates');
const BILLING = fs.readFileSync(path.join(TEMPLATES, 'billing.html'), 'utf8');
const WHOLESALE = fs.readFileSync(path.join(TEMPLATES, 'wholesale-sales.html'), 'utf8');

const $ = (id) => document.getElementById(id);
const rice = (kg = 10, rate = 25) => ({ name: 'Rice', itemId: 'rice', qty: kg, rate, total: kg * rate, weights: [kg] });
const typeIn = (id, value) => { $(id).value = String(value); };

beforeEach(() => {
    document.body.innerHTML = `<main>${BILLING}</main><div id="modalOverlay"></div>`;
    global.firebase = { auth: () => ({ currentUser: { uid: 'u1' } }) };
    jest.spyOn(UIManager, 'showToast').mockImplementation(() => {});
    jest.spyOn(UIManager, 'hapticFeedback').mockImplementation(() => {});
    window.matchMedia = jest.fn(() => ({ matches: false }));
    AppState.currentUser = { uid: 'u1' };
    AppState.userRole = 'owner';
    AppState.settings = {};
    AppState.items = [];
    AppState.purchaseHistory = [];
    AppState.retailSalesHistory = [];
    BillingManager.init();
    BillingManager.currentMode = 'purchase';
    BillingManager.editingBillIndex = undefined;
});

afterEach(() => {
    jest.restoreAllMocks();
    PurchaseManager.setBillItems([]);
    PurchaseManager.setPendingBill(null);
    RetailSaleManager.setSaleItems([]);
    RetailSaleManager.setPendingBill(null);
    BillingManager.editingBillIndex = undefined;
    delete global.firebase;
});

describe('1. "Not split yet" shows only while some of the bill is not split', () => {
    const restRow = (id) => $(id).closest('.pay-rest');

    test('purchase: hidden at ₹0 left, shown with the amount left or over, live as amounts change', () => {
        expect(restRow('purchaseSplitRemaining').hidden).toBe(true);
        PurchaseManager.setBillItems([rice(10, 25)]);
        PurchaseManager.renderBill();
        expect(restRow('purchaseSplitRemaining').hidden).toBe(false);
        expect($('purchaseSplitRemaining').textContent).toContain('250');

        typeIn('cashPayment', 200);
        PurchaseManager.updatePaymentTotal();
        expect(restRow('purchaseSplitRemaining').hidden).toBe(false);
        expect($('purchaseSplitRemaining').textContent).toContain('50');

        typeIn('dueAmount', 50);
        PurchaseManager.updatePaymentTotal();
        expect(restRow('purchaseSplitRemaining').hidden).toBe(true);

        typeIn('onlinePayment', 10);
        PurchaseManager.updatePaymentTotal();
        expect(restRow('purchaseSplitRemaining').hidden).toBe(false);
        expect($('purchaseSplitRemaining').dataset.split).toBe('off');
    });

    test('labour changes the payable, and the row follows it', () => {
        PurchaseManager.setBillItems([rice(10, 25)]);
        PurchaseManager.renderBill();
        typeIn('cashPayment', 250);
        PurchaseManager.updatePaymentTotal();
        expect(restRow('purchaseSplitRemaining').hidden).toBe(true);
        $('manualLaborCharges').dataset.manuallySet = 'true';
        typeIn('manualLaborCharges', 20);
        PurchaseManager.updateTotals();
        expect(restRow('purchaseSplitRemaining').hidden).toBe(false);
        expect($('amountPayable').textContent).toBe('230');
    });

    test('retail sale: the same rule', () => {
        RetailSaleManager.setSaleItems([rice(4, 30)]);
        RetailSaleManager.renderSalesBill();
        expect(restRow('saleSplitRemaining').hidden).toBe(false);
        typeIn('saleOnlinePayment', 120);
        RetailSaleManager.updateSalePaymentTotal();
        expect(restRow('saleSplitRemaining').hidden).toBe(true);
    });

    test('wholesale shares the row and the rule', () => {
        document.body.innerHTML = WHOLESALE;
        const row = restRow('wholesaleSplitRemaining');
        expect(row.hidden).toBe(true);
        Helpers.showSplitRemaining('wholesaleSplitRemaining', validatePaymentSplit(500, { cash: 100 }));
        expect(row.hidden).toBe(false);
        Helpers.showSplitRemaining('wholesaleSplitRemaining', validatePaymentSplit(500, { cash: 100, due: 400 }));
        expect(row.hidden).toBe(true);
    });
});

describe('2. the date line: "Today" and, for the owner only, "Change date"', () => {
    const field = (id) => $(id).closest('.bill-date');

    test('owner: Today · Change date; the box unfolds on tap; another day shows formatted; reset folds it', () => {
        prepareBillDate('billDate');
        expect($('billDateText').textContent).toBe('Today');
        expect($('billDateChange').hidden).toBe(false);
        expect(field('billDate').hidden).toBe(true);

        revealBillDate('billDate');
        expect(field('billDate').hidden).toBe(false);
        expect($('billDateChange').hidden).toBe(true);

        const yesterday = toLocalISODate(addLocalDays(new Date(), -1));
        $('billDate').value = yesterday;
        $('billDate').dispatchEvent(new Event('change'));
        expect($('billDateText').textContent).toBe(backdatedText(yesterday));

        expect(backdatedText('2026-11-12', new Date(2026, 10, 15))).toBe('Back-dated: 12 Nov');
        expect(backdatedText('2025-12-31', new Date(2026, 0, 2))).toBe('Back-dated: 31 Dec 2025');

        resetBillDate('billDate');
        expect(field('billDate').hidden).toBe(true);
        expect($('billDateText').textContent).toBe('Today');
        expect($('billDate').value).toBe(toLocalISODate(new Date()));
    });

    test.each(['manager', 'staff', 'member'])('%s: the day only, no Change date, the box stays folded', (role) => {
        AppState.userRole = role;
        prepareBillDate('saleDate');
        expect($('saleDateText').textContent).toBe('Today');
        expect($('saleDateChange').hidden).toBe(true);
        revealBillDate('saleDate');
        expect(field('saleDate').hidden).toBe(true);
    });

    test('an edited bill shows its own day; its date is locked, so no Change date even for the owner', () => {
        const day = addLocalDays(new Date(), -3);
        prepareBillDate('billDate', { timestamp: day.getTime() });
        expect($('billDateText').textContent).toBe(backdatedText(toLocalISODate(day)));
        expect($('billDateChange').hidden).toBe(true);
        expect(field('billDate').hidden).toBe(true);
    });

    test('a picked day is still what the bill is saved on when the box is folded', () => {
        prepareBillDate('billDate');
        revealBillDate('billDate');
        const yesterday = toLocalISODate(addLocalDays(new Date(), -1));
        $('billDate').value = yesterday;
        $('billDate').dispatchEvent(new Event('change'));
        delete $('billDate').dataset.open;
        renderBillDateLine('billDate');
        expect(field('billDate').hidden).toBe(true);
        expect($('billDate').value).toBe(yesterday);
        expect($('billDateText').textContent).toBe(backdatedText(yesterday));
    });
});

describe('3. notes and "Print in bill" behind "Add note"', () => {
    const notes = (id) => $(id).closest('.bill-notes');

    test('folded at first; Add note unfolds them', () => {
        expect(notes('billComments').hidden).toBe(true);
        expect($('billNoteToggle').hidden).toBe(false);
        BillingManager.showNotes('billComments');
        expect(notes('billComments').hidden).toBe(false);
        expect($('billNoteToggle').hidden).toBe(true);
    });

    test('a draft with a note opens them, with the note and its print choice kept; Clear folds them again', () => {
        BillingManager.applyDraft({ mode: 'purchase', items: [rice()], comments: 'GPay Ramesh', printComments: true });
        expect(notes('billComments').hidden).toBe(false);
        expect($('billComments').value).toBe('GPay Ramesh');
        expect($('billPrintComments').checked).toBe(true);
        PurchaseManager.clearBill();
        expect(notes('billComments').hidden).toBe(true);
        expect($('billNoteToggle').hidden).toBe(false);
    });

    test('retail: a draft with a note opens them too; one without stays folded', () => {
        BillingManager.applyDraft({ mode: 'sale', items: [rice()], comments: 'paid by son' });
        expect(notes('saleComments').hidden).toBe(false);
        RetailSaleManager.clearSale();
        BillingManager.applyDraft({ mode: 'sale', items: [rice()] });
        expect(notes('saleComments').hidden).toBe(true);
    });
});

describe('4. Drafts only with drafts; Save draft and Clear in the ⋯ menu', () => {
    test('Drafts hidden at 0, shown with the count above 0', async () => {
        BillDrafts.countDrafts.mockResolvedValueOnce(0);
        await BillingManager.updateDraftCount();
        expect($('draftsBtn').hidden).toBe(true);
        BillDrafts.countDrafts.mockResolvedValueOnce(2);
        await BillingManager.updateDraftCount();
        expect($('draftsBtn').hidden).toBe(false);
        expect($('draftCount').textContent).toBe('2');
    });

    test('Save draft and Clear sit inside the menu', () => {
        const menu = document.querySelector('.bill-mode-row details.bill-menu');
        expect(menu.contains($('saveDraftBtn'))).toBe(true);
        expect(menu.contains($('clearBillBtn'))).toBe(true);
    });

    test('Clear asks first when the bill has lines; Cancel keeps the bill', async () => {
        PurchaseManager.setBillItems([rice()]);
        const ask = jest.spyOn(UIManager, 'showModal').mockResolvedValueOnce(false);
        await BillingManager.confirmClear();
        expect(ask).toHaveBeenCalledTimes(1);
        expect(PurchaseManager.getBillItems()).toHaveLength(1);
        ask.mockResolvedValueOnce(true);
        await BillingManager.confirmClear();
        expect(PurchaseManager.getBillItems()).toHaveLength(0);
    });

    test('an empty bill clears without asking', async () => {
        const ask = jest.spyOn(UIManager, 'showModal');
        await BillingManager.confirmClear();
        expect(ask).not.toHaveBeenCalled();
    });
});

describe('5. "On this bill" and "Total packets" only with lines', () => {
    test('purchase: hidden, shown with a line, hidden again when the last is removed', () => {
        PurchaseManager.renderBill();
        expect($('purchaseLines').hidden).toBe(true);
        PurchaseManager.setBillItems([rice(), rice(20)]);
        PurchaseManager.renderBill();
        expect($('purchaseLines').hidden).toBe(false);
        expect($('totalPacketsInBill').textContent).toBe('2');
        PurchaseManager.deleteBillItem(0);
        expect($('purchaseLines').hidden).toBe(false);
        PurchaseManager.deleteBillItem(0);
        expect($('purchaseLines').hidden).toBe(true);
    });

    test('retail: the same', () => {
        RetailSaleManager.renderSalesBill();
        expect($('saleLines').hidden).toBe(true);
        RetailSaleManager.setSaleItems([rice()]);
        RetailSaleManager.renderSalesBill();
        expect($('saleLines').hidden).toBe(false);
        RetailSaleManager.setSaleItems([]);
        RetailSaleManager.renderSalesBill();
        expect($('saleLines').hidden).toBe(true);
    });
});

describe('6. labour: off shows only the switch', () => {
    const calc = () => $('laborCalculation');
    const box = () => $('manualLaborCharges').closest('.bill-money');

    test('on (the default): the working and the amount; off: neither, and no labour taken off', () => {
        PurchaseManager.setBillItems([{ ...rice(40, 25), weights: [40] }]);
        PurchaseManager.renderBill();
        expect($('autoLaborCharge').checked).toBe(true);
        expect(calc().hidden).toBe(false);
        expect(box().hidden).toBe(false);
        expect(calc().textContent).not.toBe('');
        const payableOn = $('amountPayable').textContent;

        $('autoLaborCharge').checked = false;
        PurchaseManager.updateTotals();
        expect(calc().hidden).toBe(true);
        expect(box().hidden).toBe(true);
        expect($('amountPayable').textContent).toBe('1,000');
        expect(PurchaseManager.computeTotals().laborCharges).toBe(0);

        $('autoLaborCharge').checked = true;
        PurchaseManager.updateTotals();
        expect(calc().hidden).toBe(false);
        expect(box().hidden).toBe(false);
        expect($('amountPayable').textContent).toBe(payableOn);
    });
});

describe('7. the next bill number hint is marked so the phone layout can leave it out', () => {
    test('"next" for a new bill, "known" once the bill has its number', () => {
        BillingManager.renderBillNumber();
        expect($('purchaseBillNo').dataset.kind).toBe('next');
        PurchaseManager.setPendingBill({ id: 'p1', billNumber: 'P20261115-007' });
        BillingManager.renderBillNumber();
        expect($('purchaseBillNo').dataset.kind).toBe('known');
    });
});
