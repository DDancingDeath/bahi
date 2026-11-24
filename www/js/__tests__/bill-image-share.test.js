/**
 * @fileoverview WhatsApp share of a bill as its receipt picture: one layout with the print,
 * the share path (WhatsApp chat, share sheet, Web Share, download), the text fallback, the
 * caption, the shared text format and press-and-hold for text.
 */
jest.mock('../services/usage.js', () => ({ track: jest.fn() }));

import { PrinterService, loadReceiptDrawing } from '../services/printer.js';
import { renderBillImage, shareBill, shareBillImage } from '../services/bill-image-share.js';
import { SHARE_DOTS } from '../utils/printer-settings.js';
import { billPhone, buildBillShareCaption, buildBillShareText, buildDraftShareText, buildReprintPayload } from '../utils/bill-share.js';
import { installActions } from '../ui/actions.js';
import { UIManager } from '../ui/ui-manager.js';
import { AppState } from '../utils/state.js';
import { setLang } from '../i18n/index.js';

beforeAll(() => loadReceiptDrawing());

let log;
let getContext;
let toBlob;

function fakeContext(canvas) {
    return {
        canvas,
        font: '',
        fillStyle: '',
        textAlign: 'left',
        scale: (x, y) => log.push(['scale', canvas.width, x, y]),
        fillRect: () => {},
        fillText: (s, x, y) => log.push(['text', String(s), x, y]),
        drawImage: () => {},
        measureText: (s) => ({ width: String(s).length * 9 }),
        createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: () => {},
        getImageData: (x, y, w, h) => { log.push(['pixels']); return { data: new Uint8ClampedArray(w * h * 4).fill(255) }; }
    };
}

const BILL = {
    id: 'p1', billNumber: 'P20261125-001', type: 'purchase', isPurchase: true,
    customerName: 'Hitesh - 9876543210', date: '2026-11-24T18:44:00.000Z', timestamp: new Date(2026, 10, 25, 0, 14).getTime(),
    items: [{ itemId: 'm1', name: 'Mahua', rate: 55, qty: 20, total: 1100 }],
    billTotal: 1100, laborCharges: 0, grandTotal: 1100, amountPayable: 1100,
    payment: { cash: 600, online: 0, due: 500 }
};

const texts = () => log.filter(e => e[0] === 'text');

beforeEach(() => {
    log = [];
    localStorage.clear();
    PrinterService.setSharedReceipt(null);
    setLang('en');
    AppState.items = [{ id: 'm1', name: 'Mahua', hindiName: 'महुआ' }];
    getContext = HTMLCanvasElement.prototype.getContext;
    toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.getContext = function () { return fakeContext(this); };
    HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new Blob(['png'], { type: 'image/png' })); };
    URL.createObjectURL = jest.fn(() => 'blob:x');
    URL.revokeObjectURL = jest.fn();
    jest.spyOn(UIManager, 'showToast').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    HTMLCanvasElement.prototype.getContext = getContext;
    HTMLCanvasElement.prototype.toBlob = toBlob;
    setLang('en');
});

describe('one receipt layout for the print and the WhatsApp picture', () => {
    test.each([['en'], ['hi']])('same drawing, same lines and places for the same bill (receipt %s)', async (lang) => {
        PrinterService.updateSettings?.({ receiptLang: lang });
        if (lang === 'hi') setLang('hi');
        const manager = PrinterService.manager;
        const draw = jest.spyOn(manager, '_drawBill');
        const payload = buildReprintPayload(BILL, 'purchase');

        manager.billBytes(payload, 384, PrinterService.receiptOptions());
        const printed = texts();
        expect(log.some(e => e[0] === 'pixels')).toBe(true);
        log = [];
        const canvas = await renderBillImage(payload);
        const shared = texts();

        expect(draw).toHaveBeenCalledTimes(2);
        expect(draw.mock.calls[1][1]).toBe(draw.mock.calls[0][1]);
        expect(draw.mock.calls[1][2]).toEqual(draw.mock.calls[0][2]);
        expect(shared).toEqual(printed);
        expect(shared.map(e => e[1])).toEqual(expect.arrayContaining(['Bill: P20261125-001'.replace('Bill', lang === 'hi' ? 'बिल नं.' : 'Bill')].filter(() => lang === 'en')));
        if (lang === 'hi') expect(shared.map(e => e[1]).join(' ')).toMatch(/महुआ/);
        // the picture: 2× on white with a margin, never turned into printer dots
        expect(log).toContainEqual(['scale', SHARE_DOTS, 2, 2]);
        expect(log.some(e => e[0] === 'pixels')).toBe(false);
        expect(canvas.width).toBe(SHARE_DOTS + 64);
    });

    test('a draft is marked on the picture', async () => {
        await renderBillImage({ ...buildReprintPayload(BILL, 'purchase'), isCopy: false, isDraft: true });
        expect(texts().map(e => e[1])).toContain('DRAFT, not saved');
    });
});

describe('share path', () => {
    const native = (plugins) => ({
        Capacitor: { isNativePlatform: () => true, Plugins: plugins },
        open: jest.fn(),
        navigator: {}
    });
    const fs = () => ({ rmdir: jest.fn().mockResolvedValue(), writeFile: jest.fn().mockResolvedValue({ uri: 'file:///cache/bill-share/x.png' }) });
    const payload = () => buildReprintPayload(BILL, 'purchase');
    const text = buildBillShareText(BILL, 'purchase');

    test('Android: straight to the customer\'s WhatsApp chat with the picture and caption', async () => {
        const AppShell = { shareToWhatsApp: jest.fn().mockResolvedValue({ opened: true }) };
        const Share = { share: jest.fn() };
        const win = native({ Filesystem: fs(), AppShell, Share });
        expect(await shareBillImage(payload(), { type: 'purchase', text, win })).toBe('whatsapp');
        expect(AppShell.shareToWhatsApp).toHaveBeenCalledWith({
            uri: 'file:///cache/bill-share/x.png', phone: '919876543210', text: buildBillShareCaption(payload(), 'purchase')
        });
        expect(win.Capacitor.Plugins.Filesystem.writeFile).toHaveBeenCalledWith(expect.objectContaining({ path: 'bill-share/purchase_bill_P20261125-001_copy.png', directory: 'CACHE' }));
        expect(Share.share).not.toHaveBeenCalled();
    });

    test('Android: the share sheet when WhatsApp is not there or the APK has no method', async () => {
        const Share = { share: jest.fn().mockResolvedValue({}) };
        const notThere = native({ Filesystem: fs(), AppShell: { shareToWhatsApp: jest.fn().mockResolvedValue({ opened: false }) }, Share });
        expect(await shareBillImage(payload(), { type: 'purchase', text, win: notThere })).toBe('sheet');
        const older = native({ Filesystem: fs(), AppShell: {}, Share });
        expect(await shareBillImage(payload(), { type: 'purchase', text, win: older })).toBe('sheet');
        expect(Share.share).toHaveBeenCalledWith(expect.objectContaining({ files: ['file:///cache/bill-share/x.png'], text: expect.stringContaining('#P20261125-001') }));
    });

    test('browser: Web Share with the file, else a download and the text', async () => {
        const share = jest.fn().mockResolvedValue();
        const web = { navigator: { canShare: () => true, share }, open: jest.fn() };
        expect(await shareBillImage(payload(), { type: 'purchase', text, win: web })).toBe('web');
        expect(share.mock.calls[0][0].files[0].name).toBe('purchase_bill_P20261125-001_copy.png');
        expect(share.mock.calls[0][0].text).toContain('Due: ₹500');

        const plain = { navigator: {}, open: jest.fn(() => ({})) };
        expect(await shareBillImage(payload(), { type: 'purchase', text, win: plain })).toBe('download');
        expect(URL.createObjectURL).toHaveBeenCalled();
        expect(plain.open.mock.calls[0][0]).toBe(`https://wa.me/919876543210?text=${encodeURIComponent(text)}`);
    });

    test('a failure sends the text with a toast; closing the sheet does not', async () => {
        const failing = native({ Filesystem: fs(), AppShell: {}, Share: { share: jest.fn().mockRejectedValue(new Error('boom')) } });
        expect(await shareBillImage(payload(), { type: 'purchase', text, win: failing })).toBe('text');
        expect(UIManager.showToast).toHaveBeenCalledWith('The bill picture could not be shared, so the bill went as text.', 'warning');
        expect(failing.open).toHaveBeenCalledWith(`https://wa.me/919876543210?text=${encodeURIComponent(text)}`, '_system');

        UIManager.showToast.mockClear();
        const closed = native({ Filesystem: fs(), AppShell: {}, Share: { share: jest.fn().mockRejectedValue(new Error('Share canceled')) } });
        expect(await shareBillImage(payload(), { type: 'purchase', text, win: closed })).toBe('cancelled');
        expect(UIManager.showToast).not.toHaveBeenCalled();
        expect(closed.open).not.toHaveBeenCalled();

        HTMLCanvasElement.prototype.getContext = () => null;
        const web = { navigator: { canShare: () => true, share: jest.fn() }, open: jest.fn(() => ({})) };
        expect(await shareBillImage(payload(), { type: 'purchase', text, win: web })).toBe('text');
        expect(web.navigator.share).not.toHaveBeenCalled();
    });

    test('share as text (held) skips the picture', async () => {
        const web = { navigator: { canShare: () => true, share: jest.fn() }, open: jest.fn(() => ({})) };
        expect(await shareBill(payload(), { type: 'purchase', text, asText: true, win: web })).toBe('text');
        expect(web.navigator.share).not.toHaveBeenCalled();
        expect(web.open.mock.calls[0][0]).toContain('https://wa.me/919876543210?text=');
    });
});

describe('caption, number and text', () => {
    test('caption: title with mark, bill number, total, due only when owed', () => {
        expect(buildBillShareCaption(buildReprintPayload(BILL, 'purchase'))).toBe('*Purchase bill* (COPY)\nBill: #P20261125-001\nTotal: ₹1,100\nDue: ₹500');
        expect(buildBillShareCaption({ ...BILL, payment: { cash: 1100, online: 0, due: 0 } })).toBe('*Purchase bill*\nBill: #P20261125-001\nTotal: ₹1,100');
        expect(buildBillShareCaption({ type: 'retail', isDraft: true, total: 400, items: [] })).toBe('*Sale bill* (DRAFT, not saved)\nTotal: ₹400');
    });

    test('the customer\'s number from the bill', () => {
        expect(billPhone(BILL)).toBe('919876543210');
        expect(billPhone({ customerName: '9876543210' })).toBe('919876543210');
        expect(billPhone({ customerName: 'Ram', customerPhone: '09876543210' })).toBe('919876543210');
        expect(billPhone({ customerName: 'Ram Traders' })).toBe('');
        expect(billPhone({ customerName: 'Shop 12345' })).toBe('');
    });

    test('text: the app\'s date style, "20 kg", one money style', () => {
        const text = buildBillShareText(BILL, 'purchase', { copy: false });
        expect(text).toBe([
            '*Purchase bill*', '', 'Bill: #P20261125-001', 'Date: 25 Nov 2026, 12:14 am', 'Customer: Hitesh - 9876543210',
            '', '*Items:*', 'Mahua', '  ₹55.00 × 20 kg = ₹1,100', '', '*Total: ₹1,100*', 'Paid: ₹600', 'Due: ₹500'
        ].join('\n'));
        const draft = buildDraftShareText({ kind: 'purchase', customer: 'Hitesh', date: new Date(2026, 10, 25, 0, 14), items: BILL.items, total: 1100 });
        expect(draft).toContain('Date: 25 Nov 2026, 12:14 am');
        expect(draft).toContain('\n  ₹55.00 × 20 kg = ₹1,100\n');
    });
});

describe('press and hold', () => {
    test('data-onhold runs instead of the click', () => {
        jest.useFakeTimers();
        const calls = [];
        window.app = { t: { tap: () => calls.push('tap'), hold: (x) => calls.push(`hold:${x}`) } };
        document.body.innerHTML = '<button data-onclick="t.tap()" data-onhold="t.hold(true)"><span>wa</span></button>';
        installActions(document);
        const span = document.querySelector('span');
        span.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
        jest.advanceTimersByTime(600);
        span.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
        span.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(calls).toEqual(['hold:true']);
        span.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
        span.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
        span.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(calls).toEqual(['hold:true', 'tap']);
        jest.useRealTimers();
    });
});
