/**
 * @fileoverview Live red/amber highlighting (#188) and the save gate (#37):
 * marks fields/rows with class + aria + reason text, shows the banner, colours
 * the card, blocks Save, debounces typing, and asks only at save time.
 */
jest.mock('../services/audit.js', () => ({ AuditService: { log: jest.fn(async () => {}), ACTIONS: { OVERRIDE_CHECK: 'OVERRIDE_CHECK' } } }));

import { BillChecksUI, CHECK_DEBOUNCE_MS, clearFieldError, readTypedNumber, showFieldError, BILL_CHECKS_BLOCKING_POLICY, AUTO_ROLLBACK_REASON } from '../ui/bill-highlight.js';
import { tip } from '../tip/index.js';
import { UIManager } from '../ui/ui-manager.js';
import { AuditService } from '../services/audit.js';
import { AppState } from '../utils/state.js';

const DOM = `
  <div id="testSection">
    <div class="bill-form-field"><label>Customer</label><input id="party"></div>
    <div class="bill-form-field"><label>Rate</label><input id="rate"></div>
    <table id="testTable"><tbody></tbody></table>
    <div class="pay-line"><input id="cash"></div>
    <div class="pay-line"><input id="due"></div>
    <div class="pay-line"><strong id="remaining"></strong></div>
    <button id="saveBtn" data-i18n="ui.common.save">Save</button><button id="printBtn">Print</button>
  </div>`;

let state;

function renderRows() {
    document.querySelector('#testTable tbody').innerHTML = state.items.map(i => `<tr><td>${i.name}</td><td>${i.rate}</td><td>${i.qty}</td><td>${i.total}</td><td></td></tr>`).join('');
}

beforeAll(() => {
    BillChecksUI.register('test', {
        sectionId: 'testSection',
        tableSelector: '#testTable',
        saveButtons: '#saveBtn, #printBtn',
        getDraft: () => ({
            kind: 'wholesale',
            isEdit: false,
            id: 'n1',
            items: state.items,
            total: state.items.reduce((s, i) => s + i.total, 0),
            payment: { cash: readTypedNumber('cash') || 0, due: readTypedNumber('due') || 0 },
            partyName: document.getElementById('party').value,
            entry: { itemId: 'rice', name: 'Rice', rate: readTypedNumber('rate'), qty: null }
        }),
        fields: {
            party: { inputs: ['party'] },
            payment: { inputs: ['cash', 'due'], anchor: 'remaining' },
            'entry.rate': { inputs: ['rate'] }
        }
    });
});

beforeEach(() => {
    document.body.innerHTML = DOM;
    AppState.items = [{ id: 'rice', name: 'Rice', wholesaleRates: [40] }];
    AppState.stock = { rice: { quantity: 100, rate: 30 } };
    AppState.stockReady = true;
    AppState.salesHistory = [];
    AppState.settings = {};
    AppState.userRole = 'staff';
    AppState.currentUser = { uid: 'u1' };
    state = { items: [{ itemId: 'rice', name: 'Rice', rate: 40, qty: 10, total: 400 }] };
    renderRows();
});

afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

const $ = (id) => document.getElementById(id);
const banner = () => document.querySelector('#testSection > .bill-check-notice');

describe('live marks', () => {
    test('a payment problem marks cash + due red with aria and one reason under the split row', () => {
        $('cash').value = '100';
        BillChecksUI.run('test');

        for (const id of ['cash', 'due']) {
            expect($(id).classList.contains('bill-check-block')).toBe(true);
            expect($(id).getAttribute('aria-invalid')).toBe('true');
        }
        const msg = $('remaining').closest('.pay-line').nextElementSibling;
        expect(msg.classList.contains('bill-check-msg')).toBe(true);
        expect(msg.textContent).toMatch(/^⛔ Cash \+ Online \+ Due is ₹300 less [^\u0900-\u097F]*$/);
        expect($('cash').getAttribute('aria-describedby')).toBe(msg.id);

        // One message per problem (U-33): no banner for a problem shown at its field; Save says "Fix 1" and still works
        expect(banner().hidden).toBe(true);
        expect($('testSection').classList.contains('bill-checks-block')).toBe(true);
        expect($('saveBtn').hasAttribute('aria-disabled')).toBe(false);
        expect($('saveBtn').textContent).toBe('Fix 1');
        expect($('printBtn').classList.contains('bill-check-save-blocked')).toBe(true);
        expect($('printBtn').textContent).toBe('Print');
        $('cash').value = '400';
        BillChecksUI.run('test');
        expect($('saveBtn').textContent).toBe('Save');
    });

    test('fixing the problem removes every mark', () => {
        $('cash').value = '100';
        BillChecksUI.run('test');
        $('cash').value = '400';
        BillChecksUI.run('test');
        expect(document.querySelectorAll('.bill-check-msg, .bill-check-line, [aria-invalid]')).toHaveLength(0);
        expect(banner().hidden).toBe(true);
        expect($('testSection').className).toBe('');
        expect($('saveBtn').hasAttribute('aria-disabled')).toBe(false);
    });

    test('a rate far from usual shows one short line ("₹10 · usual ₹40"); the sentence is behind the ⓘ', () => {
        $('rate').value = '10';
        BillChecksUI.run('test');
        const msg = $('rate').closest('.bill-form-field').nextElementSibling;
        expect(msg.querySelector(':scope > span').textContent).toBe('⚠️ ₹10 · usual ₹40');
        const more = msg.querySelector('details.info-tip');
        expect(more.open).toBe(false);
        expect(more.querySelector('summary').getAttribute('aria-label')).toBe('More info');
        expect(more.querySelector('.info-pop').textContent).toBe('Rice: ₹10/kg is less than 1/2 of the usual ₹40/kg');
    });

    test('a line warning marks its row amber with a reason row; only warnings → amber card, Save enabled', () => {
        state.items[0] = { itemId: 'rice', name: 'Rice', rate: 90, qty: 10, total: 900 };
        renderRows();
        $('cash').value = '900';
        BillChecksUI.run('test');
        const rows = document.querySelectorAll('#testTable tbody tr');
        expect(rows[0].classList.contains('bill-check-warn')).toBe(true);
        expect(rows[1].className).toBe('bill-check-line');
        expect(rows[1].textContent).toContain('⚠️ ₹90 · usual ₹40');
        expect(rows[1].querySelector('.info-pop').textContent).toBe('Rice: ₹90/kg is 2.3× the usual ₹40/kg');
        expect($('testSection').classList.contains('bill-checks-warn')).toBe(true);
        expect($('saveBtn').hasAttribute('aria-disabled')).toBe(false);
    });

    test('U-01: rate warnings on several lines show as one "Check rates" message; a per-quintal rate gets a one-tap fix', () => {
        const applyRate = jest.fn((i, r) => { state.items[i] = { ...state.items[i], rate: r, total: r * state.items[i].qty }; renderRows(); });
        BillChecksUI.register('test2', {
            sectionId: 'testSection', tableSelector: '#testTable', saveButtons: '#saveBtn',
            getDraft: () => ({ kind: 'wholesale', isEdit: false, id: 'n2', items: state.items, total: 0, payment: {}, partyName: '' }),
            fields: {}, applyRate
        });
        state.items = [
            { itemId: 'rice', name: 'Rice', rate: 4000, qty: 1, total: 4000 },
            { itemId: 'rice', name: 'Rice', rate: 90, qty: 1, total: 90 }
        ];
        renderRows();
        BillChecksUI.run('test2');
        const msgs = document.querySelectorAll('#testTable .bill-check-line');
        expect(msgs).toHaveLength(1);
        expect(msgs[0].textContent).toContain('Check rates');
        expect(msgs[0].querySelectorAll('.bill-check-part')).toHaveLength(2);
        expect(document.querySelectorAll('#testTable tbody tr.bill-check-warn')).toHaveLength(2);
        const fix = msgs[0].querySelector('.bill-check-fix');
        expect(fix.textContent).toBe('Use ₹40/kg');
        fix.click();
        expect(applyRate).toHaveBeenCalledWith(0, 40);
        expect(document.querySelectorAll('#testTable .bill-check-part')).toHaveLength(0);
    });

    test('the rate left in the box after Add to bill is warned once, on its line (U-01, U-18)', () => {
        state.items[0] = { itemId: 'rice', name: 'Rice', rate: 90, qty: 10, total: 900 };
        renderRows();
        $('cash').value = '900';
        $('rate').value = '90';
        BillChecksUI.run('test');
        expect($('rate').classList.contains('bill-check-warn')).toBe(false);
        expect(banner().hidden).toBe(true);
        expect(document.querySelectorAll('#testSection .bill-check-msg')).toHaveLength(1);
        expect(document.querySelector('#testTable tbody tr').classList.contains('bill-check-warn')).toBe(true);
    });

    test('bill-level problems (duplicate) are listed in the banner', () => {
        AppState.salesHistory = [{ id: 'old', customerName: '', timestamp: Date.now() - 5000, total: 400, items: [{ itemId: 'rice', rate: 40, quantity: 10 }] }];
        $('cash').value = '400';
        BillChecksUI.run('test');
        expect(banner().querySelector('li').textContent).toMatch(/^⚠️ Same bill was saved \d+ s ago/);
    });

    test('a typed rate is flagged on its own box; banner tap scrolls/focuses the first problem', () => {
        $('cash').value = '400';
        $('rate').value = '0';
        BillChecksUI.run('test');
        expect($('rate').classList.contains('bill-check-block')).toBe(true);
        expect($('saveBtn').textContent).toBe('Save'); // the typed line is not on the bill yet
        expect(banner().hidden).toBe(true);
    });

    test('typing is debounced: nothing until the user pauses, no popups', () => {
        jest.useFakeTimers();
        const modal = jest.spyOn(UIManager, 'showModal');
        const toast = jest.spyOn(UIManager, 'showToast');
        $('cash').value = '400';
        BillChecksUI.run('test'); // clean; binds the input listener
        $('cash').value = '1';
        $('cash').dispatchEvent(new Event('input', { bubbles: true }));
        jest.advanceTimersByTime(CHECK_DEBOUNCE_MS - 1);
        expect($('cash').classList.contains('bill-check-block')).toBe(false);
        jest.advanceTimersByTime(1);
        expect($('cash').classList.contains('bill-check-block')).toBe(true);
        expect(modal).not.toHaveBeenCalled();
        expect(toast).not.toHaveBeenCalled();
    });
});

describe('save gate', () => {
    test('a money block stops the save: its message at the field, scrolled to and focused, no toast over the form (U-33), even for the owner', async () => {
        AppState.userRole = 'owner';
        const toast = jest.spyOn(UIManager, 'showToast').mockImplementation(() => {});
        $('due').value = '400';
        $('party').scrollIntoView = jest.fn();
        const result = await BillChecksUI.confirmSave('test');
        expect(result.ok).toBe(false);
        expect(toast).not.toHaveBeenCalled();
        expect($('party').closest('.bill-form-field').nextElementSibling.textContent).toBe('⛔ Enter the name — a bill with Due needs a customer name.');
        expect($('party').scrollIntoView).toHaveBeenCalled();
        expect(document.activeElement).toBe($('party'));
    });

    test('an overridable block stops a member; owner/manager must give a reason, stored as overrides + audit', async () => {
        state.items[0] = { itemId: 'rice', name: 'Rice', rate: 40, qty: 110, total: 4400 };
        $('cash').value = '4400';
        const toast = jest.spyOn(UIManager, 'showToast').mockImplementation(() => {});
        expect((await BillChecksUI.confirmSave('test')).ok).toBe(false);
        expect(toast).not.toHaveBeenCalled();
        expect(document.querySelector('#testTable .bill-check-line').textContent).toContain('Rice: selling 110 kg, only 100 kg');

        AppState.userRole = 'manager';
        BillChecksUI.run('test');
        expect($('saveBtn').classList.contains('bill-check-save-override')).toBe(true);
        expect($('saveBtn').hasAttribute('aria-disabled')).toBe(false);

        const html = jest.spyOn(UIManager, 'showModalWithHtml').mockImplementation(async (body) => {
            document.body.insertAdjacentHTML('beforeend', `<div id="m">${body}</div>`);
            return true;
        });
        expect((await BillChecksUI.confirmSave('test')).ok).toBe(false); // blank reason
        expect(toast).toHaveBeenLastCalledWith('Write a reason to save anyway');

        html.mockImplementation(async (body) => {
            document.getElementById('m')?.remove();
            document.body.insertAdjacentHTML('beforeend', `<div id="m">${body}</div>`);
            $('billCheckOverrideReason').value = ' truck unloading now ';
            return true;
        });
        const ok = await BillChecksUI.confirmSave('test');
        expect(ok).toMatchObject({ ok: true, flags: [] });
        expect(ok.overrides).toEqual([{ rule: 'oversell', reason: 'truck unloading now', by: 'u1', at: expect.any(Number) }]);
        expect(AuditService.log).toHaveBeenCalledWith('OVERRIDE_CHECK', { kind: 'test', rules: ['oversell'], reason: 'truck unloading now' });
        expect(html.mock.calls[1][0]).not.toContain('<script');
    });

    test('warnings need one confirm: one bulleted warn notice, the banner not repeated behind it (F51); accepted ones come back as flags, declined stops', async () => {
        state.items[0] = { itemId: 'rice', name: 'Rice', rate: 90, qty: 10, total: 900 };
        $('cash').value = '900';
        AppState.salesHistory = [{ id: 'old', customerName: '', timestamp: Date.now() - 5000, total: 900, items: [{ itemId: 'rice', rate: 90, quantity: 10 }] }];
        BillChecksUI.run('test');
        expect(banner().hidden).toBe(false);
        let bannerHiddenInDialog = null;
        const modal = jest.spyOn(UIManager, 'showModalWithHtml').mockImplementation(async () => {
            bannerHiddenInDialog = banner().hidden;
            return false;
        });
        expect((await BillChecksUI.confirmSave('test')).ok).toBe(false);
        expect(modal).toHaveBeenCalledWith(expect.any(String), 'Check before saving', true, { confirmLabel: 'Save anyway' });
        const box = document.createElement('div');
        box.innerHTML = modal.mock.calls[0][0];
        const items = [...box.querySelectorAll('.notice.warn ul li')].map(li => li.textContent);
        expect(items).toHaveLength(2);
        expect(items).toEqual(expect.arrayContaining([expect.stringMatching(/^Rice: ₹90\/kg is 2\.3× /), expect.stringMatching(/^Same bill was saved/)]));
        expect(bannerHiddenInDialog).toBe(true);
        expect(banner().hidden).toBe(false); // Cancel: back on the bill
        modal.mockResolvedValue(true);
        const ok = await BillChecksUI.confirmSave('test');
        expect(ok.ok).toBe(true);
        expect(banner().hidden).toBe(false); // back while the save runs (it may still fail)
        expect(ok.flags).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'rate-high', by: 'u1' })]));
        expect(ok.flags.find(f => f.rule === 'rate-high').en).toBe('Rice: ₹90.00/kg is 2.3× the usual ₹40.00/kg');
        expect(modal).toHaveBeenCalledTimes(2);
    });

    test('deferWarnings (an edit, F53): no dialog here, the warnings come back for the one Save changes sheet', async () => {
        state.items[0] = { itemId: 'rice', name: 'Rice', rate: 90, qty: 10, total: 900 };
        $('cash').value = '900';
        const html = jest.spyOn(UIManager, 'showModalWithHtml');
        const modal = jest.spyOn(UIManager, 'showModal');
        const res = await BillChecksUI.confirmSave('test', null, { deferWarnings: true });
        expect(html).not.toHaveBeenCalled();
        expect(modal).not.toHaveBeenCalled();
        expect(res).toMatchObject({ ok: true, warnings: [expect.stringMatching(/^Rice: ₹90\/kg is 2\.3× /)] });
        expect(res.flags).toEqual([expect.objectContaining({ rule: 'rate-high' })]);
        expect(typeof res.accept).toBe('function');
        res.restore();
        expect(document.querySelector('#testTable tbody tr').classList.contains('bill-check-warn')).toBe(true);
    });

    test('OD-02 at Save: an extreme rate not confirmed yet asks "Fix rate" first; confirmed, the one-tap 2× "Save anyway?" is not stacked on it', async () => {
        state.items[0] = { itemId: 'rice', name: 'Rice', rate: 400, qty: 10, total: 4000 };
        renderRows();
        $('cash').value = '4000';
        const toast = jest.spyOn(UIManager, 'showToast').mockImplementation(() => {});
        const modal = jest.spyOn(UIManager, 'showModalWithHtml').mockResolvedValue(true);
        const dialog = () => document.querySelector('.rate-check-sheet');

        const fixed = BillChecksUI.confirmSave('test');
        await Promise.resolve();
        expect(dialog().querySelector('#rateCheckMessage').textContent).toBe('Rice 10 kg × ₹400 = ₹4,000. Today\'s rate ₹40 would give ₹400.');
        expect(document.activeElement.dataset.choice).toBe('fix');
        dialog().querySelector('[data-choice="fix"]').click();
        expect((await fixed).ok).toBe(false);
        expect(toast).toHaveBeenLastCalledWith('Change the rate of Rice on the bill, then save.', 'warning');
        expect(state.items[0]).not.toHaveProperty('rateCheck');

        const confirmed = BillChecksUI.confirmSave('test');
        await Promise.resolve();
        dialog().querySelector('[data-choice="confirm"]').click();
        const result = await confirmed;
        expect(result).toEqual({ ok: true, flags: [], overrides: [] });
        expect(state.items[0].rateCheck).toEqual({ rate: 400, todayRate: 40, by: 'u1', byName: expect.any(String), at: expect.any(Number) });
        expect(modal).not.toHaveBeenCalled();
        // Saved again: confirmed already, nothing asked
        expect(await BillChecksUI.confirmSave('test')).toEqual({ ok: true, flags: [], overrides: [] });
        expect(dialog()).toBeNull();
    });

    test('clean bill saves with no dialog', async () => {
        $('cash').value = '400';
        const modal = jest.spyOn(UIManager, 'showModal');
        expect(await BillChecksUI.confirmSave('test')).toEqual({ ok: true, flags: [], overrides: [] });
        expect(modal).not.toHaveBeenCalled();
    });

    test('auto rollback (#217): members stay blocked; owner/manager get a warning and the override is recorded as auto-rollback', async () => {
        state.items[0] = { itemId: 'rice', name: 'Rice', rate: 40, qty: 110, total: 4400 };
        $('cash').value = '4400';
        const toast = jest.spyOn(UIManager, 'showToast').mockImplementation(() => {});
        const modal = jest.spyOn(UIManager, 'showModalWithHtml').mockResolvedValue(true);
        jest.spyOn(tip, 'isRolledBack').mockReturnValue(true);

        // A member who could not override before is still blocked
        expect((await BillChecksUI.confirmSave('test')).ok).toBe(false);
        expect(toast).not.toHaveBeenCalled();
        expect(document.querySelector('#testTable .bill-check-line').textContent).toContain('Rice: selling 110 kg');
        expect(modal).not.toHaveBeenCalled();

        AppState.userRole = 'manager';
        const ok = await BillChecksUI.confirmSave('test');
        expect(tip.isRolledBack).toHaveBeenCalledWith(BILL_CHECKS_BLOCKING_POLICY);
        expect(modal).toHaveBeenCalledTimes(1); // one "save anyway?" confirm, no reason prompt
        expect(modal.mock.calls[0][0]).not.toContain('billCheckOverrideReason');
        expect(ok).toMatchObject({ ok: true, flags: [] });
        expect(ok.overrides).toEqual([{ rule: 'oversell', reason: AUTO_ROLLBACK_REASON, by: 'u1', at: expect.any(Number) }]);
        expect(AuditService.log).toHaveBeenCalledWith('OVERRIDE_CHECK', { kind: 'test', rules: ['oversell'], reason: AUTO_ROLLBACK_REASON });

        modal.mockResolvedValue(false); // declining the confirm saves nothing and records nothing
        AuditService.log.mockClear();
        expect((await BillChecksUI.confirmSave('test')).ok).toBe(false);
        expect(AuditService.log).not.toHaveBeenCalled();
    });

    test('billFields: flags only when present; overrides are kept across edits', () => {
        expect(BillChecksUI.billFields({ flags: [], overrides: [] })).toEqual({});
        const original = { flags: [{ rule: 'x' }], overrides: [{ rule: 'oversell', reason: 'a' }] };
        expect(BillChecksUI.billFields({ flags: [], overrides: [{ rule: 'oversell', reason: 'b' }] }, original))
            .toEqual({ flags: [], overrides: [{ rule: 'oversell', reason: 'a' }, { rule: 'oversell', reason: 'b' }] });
    });
});

describe('field error (Field pattern)', () => {
    test('shows the message under the field with aria-invalid / aria-describedby, survives live checks, clears on edit', () => {
        jest.useFakeTimers();
        const rate = document.getElementById('rate');
        expect(showFieldError('rate', 'Please enter a valid rate')).toBe(true);
        const msg = document.getElementById('rate-error');
        expect(msg.textContent).toBe('Please enter a valid rate');
        expect(msg.getAttribute('role')).toBe('alert');
        expect(rate.closest('.bill-form-field').nextElementSibling).toBe(msg);
        expect(rate.getAttribute('aria-invalid')).toBe('true');
        expect(rate.getAttribute('aria-describedby')).toBe('rate-error');
        expect(document.activeElement).toBe(rate);

        document.getElementById('party').dispatchEvent(new Event('input', { bubbles: true }));
        jest.advanceTimersByTime(CHECK_DEBOUNCE_MS + 10);
        expect(document.getElementById('rate-error')).not.toBeNull();

        rate.value = '40';
        rate.dispatchEvent(new Event('input', { bubbles: true }));
        expect(document.getElementById('rate-error')).toBeNull();
        expect(rate.hasAttribute('aria-invalid')).toBe(false);
        expect(rate.hasAttribute('aria-describedby')).toBe(false);
        clearFieldError('rate');
        expect(showFieldError('missing', 'x')).toBe(false);
    });

    test('live checks keep aria-invalid on an input while its field error is shown', () => {
        jest.useFakeTimers();
        const rate = document.getElementById('rate');
        rate.dataset.billCheck = 'warn';
        rate.setAttribute('aria-invalid', 'true');
        showFieldError('rate', 'Please enter a valid rate');
        document.getElementById('party').dispatchEvent(new Event('input', { bubbles: true }));
        jest.advanceTimersByTime(CHECK_DEBOUNCE_MS + 10);
        expect(rate.dataset.billCheck).toBeUndefined();
        expect(rate.getAttribute('aria-invalid')).toBe('true');
        expect(rate.getAttribute('aria-describedby')).toBe('rate-error');
        clearFieldError('rate');
        expect(rate.hasAttribute('aria-invalid')).toBe(false);
    });
});