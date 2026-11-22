/**
 * @fileoverview Whole-bill voice on the Billing page (#498): the check sheet puts the party,
 * lines, labour, payment, note and day on the page only on "Fill bill" (never saves), keeps
 * adding across holds, marks what is unclear and never picks a party when more than one fits;
 * a name said alone opens the party pick list; hold-to-talk with pointer events; the Android app's recogniser and
 * its microphone permission (mocked plugin).
 */
import { BillingManager } from '../modules/billing.js';
import { PurchaseManager } from '../modules/purchase.js';
import { RetailSaleManager } from '../modules/retail-sale.js';
import { UIManager } from '../ui/ui-manager.js';
import { AppState } from '../utils/state.js';
import { VoiceMic, VOICE_KEY, voiceEngine, bindHold } from '../ui/voice-mic.js';
import { VoiceBilling, forgetMicPermission, openSession } from '../modules/voice-billing.js';
import { setLang } from '../i18n/index.js';

jest.mock('../firebase/repos/bill-drafts.js', () => ({
    getAutoSave: jest.fn(),
    saveAutoSave: jest.fn().mockResolvedValue(undefined),
    deleteAutoSave: jest.fn().mockResolvedValue(undefined),
    saveDraft: jest.fn().mockResolvedValue(undefined),
    countDrafts: jest.fn().mockResolvedValue(0)
}));

const DOM = `
  <div id="purchaseSection">
    <div class="bill-party"><input id="customerName"><button data-onclick="billing.pickContact()"></button></div>
    <datalist id="customerOptions"></datalist>
    <button data-voice-mic data-voice-hold="purchase" id="voiceMicPurchase"></button>
    <div class="voice-strip"><p id="voiceTranscriptPurchase" aria-live="polite"></p><button id="voiceUndoPurchase" hidden></button></div>
    <select id="billItem"><option value="0">Rice</option><option value="1">Wheat</option></select>
    <input id="billRate"><datalist id="rateOptions"></datalist><input id="newWeight"><div id="weightsDisplay"></div>
    <span id="totalWeights">0</span><span id="totalPackets">0</span>
    <table id="billTable"><tbody></tbody></table><span id="billTotal">0</span><span id="totalPacketsInBill">0</span>
    <input type="checkbox" id="autoLaborCharge" checked><span id="laborCalculation"></span><input id="manualLaborCharges" value="0">
    <span id="amountPayable">0</span><span id="totalPayment">0</span>
    <input id="onlinePayment"><input id="cashPayment"><input id="dueAmount"><strong id="purchaseSplitRemaining"></strong>
    <input type="checkbox" id="onlineCheckbox"><input type="checkbox" id="cashCheckbox"><input type="checkbox" id="dueCheckbox">
    <div class="bill-notes-date"><button class="bill-note-toggle"></button>
      <div class="bill-notes" hidden><input id="billComments"><input type="checkbox" id="billPrintComments"></div></div>
    <span data-date-line="billDate"><span class="bill-date-text"></span><button class="bill-date-change"></button></span>
    <div class="bill-date" hidden><input type="date" id="billDate"></div>
  </div>
  <div id="saleSection">
    <input id="saleCustomerName">
    <datalist id="saleCustomerOptions"></datalist>
    <button data-voice-mic data-voice-hold="sale" id="voiceMicSale"></button>
    <p id="voiceTranscriptSale"></p><button id="voiceUndoSale" hidden></button>
    <input id="saleOnlinePayment"><input id="saleCashPayment"><input id="saleDueAmount">
    <input type="checkbox" id="saleOnlineCheckbox"><input type="checkbox" id="saleCashCheckbox"><input type="checkbox" id="saleDueCheckbox">
    <input id="saleComments">
  </div>
  <div id="toast"></div>`;

const $ = (id) => document.getElementById(id);
const val = (id) => $(id).value;
const billLines = () => PurchaseManager.getBillItems().map(({ name, qty, rate }) => [name, qty, rate]);
const known = (listId, names) => { $(listId).innerHTML = names.map(n => `<option value="${n}"></option>`).join(''); };
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

/** A browser recogniser that hears `said` once. */
const fakeWebSpeech = (said) => jest.fn().mockImplementation(function Rec() {
    this.start = () => setTimeout(() => {
        this.onresult({ resultIndex: 0, results: [said.map(transcript => ({ transcript }))] });
        this.onend();
    });
    this.abort = jest.fn();
});

/** The check sheet, put in the page; `act` runs while it is open (the user), then it answers. */
const sheet = (answer, act = async () => {}) => jest.spyOn(UIManager, 'showModalWithHtml').mockImplementation(async (html) => {
    $('modalMessage')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div id="modalMessage">${html}</div>`);
    await flush();
    await act();
    return answer;
});

beforeEach(() => {
    document.body.innerHTML = DOM;
    localStorage.clear();
    localStorage.setItem(VOICE_KEY, '1');
    delete window.Capacitor;
    delete window.webkitSpeechRecognition;
    jest.spyOn(UIManager, 'showToast').mockImplementation(() => {});
    jest.spyOn(UIManager, 'hapticFeedback').mockImplementation(() => {});
    AppState.items = [{ id: 'r', name: 'Rice', hindiName: 'चावल', rates: [28, 30] }, { id: 'w', name: 'Wheat', hindiName: 'गेहूं', rates: [24] }];
    AppState.settings = { laborRate: 6, heavyWeightThreshold: 30, showHindi: false };
    AppState.purchaseHistory = [];
    AppState.retailSalesHistory = [];
    AppState.userRole = 'owner';
    BillingManager.init();
    PurchaseManager.setWeights([]);
    PurchaseManager.setBillItems([]);
    VoiceBilling.undo.purchase.clear();
    VoiceBilling.undo.sale.clear();
    VoiceBilling.sheet = null;
    forgetMicPermission();
});

afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    delete window.webkitSpeechRecognition;
    delete window.Capacitor;
    setLang('en');
});

describe('check sheet: the whole page, only on Fill bill', () => {
    test('party, lines, labour, cash, the rest as due and a note fill the page; nothing is saved', async () => {
        window.webkitSpeechRecognition = fakeWebSpeech(['Ramesh se wheat 10 kg 24 aur rice 5 kg 30, labour 20, cash 100, baaki udhaar, note truck wala']);
        const modal = sheet(true);
        const save = jest.spyOn(BillingManager, 'saveBillToHistory');
        const events = [];
        $('customerName').addEventListener('input', () => events.push('input'));
        $('customerName').addEventListener('change', () => events.push('change'));

        await expect(VoiceBilling.listenOnce('purchase', 'web')).resolves.toBe(true);

        const html = modal.mock.calls[0][0];
        expect(html).toContain('Ramesh');
        expect(html).toContain('₹240');
        expect(html).toContain('Rest as due');
        expect(modal.mock.calls[0][3]).toEqual({ confirmLabel: 'Fill bill' });
        expect(val('customerName')).toBe('Ramesh');
        expect(events).toEqual(['input', 'change']);
        expect(billLines()).toEqual([['Wheat', 10, 24], ['Rice', 5, 30]]);
        expect([val('manualLaborCharges'), $('manualLaborCharges').dataset.manuallySet]).toEqual(['20', 'true']);
        // 240 + 150 − 20 labour = 370 payable; 100 cash, the rest (270) as due
        expect([val('cashPayment'), val('dueAmount')]).toEqual(['100', '270']);
        expect(val('billComments')).toBe('truck wala');
        expect(save).not.toHaveBeenCalled();

        // Undo voice takes all of it back
        expect(VoiceBilling.undoLast('purchase')).toBe(true);
        expect([billLines(), val('customerName'), val('cashPayment'), val('dueAmount'), val('billComments')]).toEqual([[], '', '', '', '']);
        expect($('manualLaborCharges').dataset.manuallySet).toBeUndefined();
    });

    test('Cancel changes nothing on the page', async () => {
        window.webkitSpeechRecognition = fakeWebSpeech(['customer Ramesh, wheat 10 kg 24, cash 100, labour band']);
        sheet(false);
        await expect(VoiceBilling.listenOnce('purchase', 'web')).resolves.toBe(false);
        expect([val('customerName'), val('cashPayment'), $('autoLaborCharge').checked, billLines()]).toEqual(['', '', true, []]);
    });

    test('"pura cash" fills the whole bill in cash; "labour off" unticks labour', async () => {
        window.webkitSpeechRecognition = fakeWebSpeech(['wheat 10 kg 24 aur rice 5 kg 30, labour off, pura cash']);
        sheet(true);
        await VoiceBilling.listenOnce('purchase', 'web');
        expect($('autoLaborCharge').checked).toBe(false);
        expect([val('cashPayment'), val('onlinePayment'), val('dueAmount')]).toEqual(['390', '0', '0']);
    });

    test('labour per bag uses the heavy bags on the bill', async () => {
        window.webkitSpeechRecognition = fakeWebSpeech(['wheat bags 40, 45, 20 at 24, labour 5 per bag']);
        const modal = sheet(true);
        await VoiceBilling.listenOnce('purchase', 'web');
        expect(modal.mock.calls[0][0]).toContain('40 + 45 + 20 = 105');
        expect(billLines()).toEqual([['Wheat', 105, 24]]);
        // two bags above 30 kg × ₹5
        expect(val('manualLaborCharges')).toBe('10');
    });

    test('more than one party fits: none is picked, the sheet asks; one sure match is used', async () => {
        known('customerOptions', ['Ramesh Bhai', 'Ramesh Kumar']);
        window.webkitSpeechRecognition = fakeWebSpeech(['customer ramesh, cash 100']);
        let modal = sheet(true);
        await VoiceBilling.listenOnce('purchase', 'web');
        const html = modal.mock.calls[0][0];
        expect(html).toMatch(/<select class="input voice-unclear" id="voicePartyPick"/);
        expect(html).toMatch(/<option value="spoken" selected>/);
        expect(html).toContain('More than one party sounds like');
        expect(val('customerName')).toBe('Ramesh');

        known('customerOptions', ['Ramesh Bhai', 'Suresh']);
        $('customerName').value = '';
        window.webkitSpeechRecognition = fakeWebSpeech(['रमेश से, cash 100']);
        modal = sheet(true);
        await VoiceBilling.listenOnce('purchase', 'web');
        expect(modal.mock.calls.at(-1)[0]).toMatch(/<option value="m0" selected>Ramesh Bhai/);
        expect(val('customerName')).toBe('Ramesh Bhai');

        // the user picks another in the sheet
        known('customerOptions', ['Ramesh Bhai', 'Ramesh Kumar']);
        window.webkitSpeechRecognition = fakeWebSpeech(['customer ramesh, cash 50']);
        sheet(true, async () => { $('voicePartyPick').value = 'm1'; });
        await VoiceBilling.listenOnce('purchase', 'web');
        expect(val('customerName')).toBe('Ramesh Kumar');
    });

    test('unclear words and a line without a rate are marked; edits in the sheet are what fills', async () => {
        window.webkitSpeechRecognition = fakeWebSpeech(['wheat 10 kg 24, rice 5 kg, hello there, cash 100']);
        const modal = sheet(true, async () => { $('voicePay-cash').value = '150'; });
        await VoiceBilling.listenOnce('purchase', 'web');
        const html = modal.mock.calls[0][0];
        expect(html).toContain('Not understood: “hello there”');
        expect(html).toMatch(/<tbody data-voice-row="1" class="voice-unclear">/);
        expect(billLines()).toEqual([['Wheat', 10, 24]]);
        expect(val('cashPayment')).toBe('150');
    });

    test('date: the owner may back-date; anyone else is told it was not changed', async () => {
        window.webkitSpeechRecognition = fakeWebSpeech(['wheat 10 kg 24, kal ka bill']);
        sheet(true);
        await VoiceBilling.listenOnce('purchase', 'web');
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const iso = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
        expect([val('billDate'), $('billDate').dataset.picked]).toEqual([iso, '1']);

        AppState.userRole = 'staff';
        $('billDate').value = '';
        delete $('billDate').dataset.picked;
        const modal = sheet(true);
        window.webkitSpeechRecognition = fakeWebSpeech(['cash 100, kal']);
        await VoiceBilling.listenOnce('purchase', 'web');
        expect(modal.mock.calls.at(-1)[0]).toContain('only the owner can change');
        expect(val('billDate')).toBe('');
    });

    test('Retail sale: "Ramesh ko … pura cash" fills the customer and the whole bill in cash', async () => {
        const fillAll = jest.spyOn(RetailSaleManager, 'fillReceivableAmount').mockImplementation(() => {});
        window.webkitSpeechRecognition = fakeWebSpeech(['Ramesh ko, pura cash, labour 20']);
        const modal = sheet(true);
        await VoiceBilling.listenOnce('sale', 'web');
        expect(modal.mock.calls[0][0]).toContain('Labour is only on purchase bills');
        expect(val('saleCustomerName')).toBe('Ramesh');
        expect(fillAll).toHaveBeenCalledWith('cash');
    });
});

describe('several holds add to one sheet', () => {
    test('each hold adds; "rate" goes to the last line; "undo" takes the last hold off; Fill bill uses it all', async () => {
        window.webkitSpeechRecognition = fakeWebSpeech(['wheat 10 kg 24']);
        const modal = sheet(true, async () => {
            await VoiceBilling.handleHeard('purchase', ['rice 5 kg 28']);
            await VoiceBilling.handleHeard('purchase', ['rate 30']);
            await VoiceBilling.handleHeard('purchase', ['cash 500']);
            await VoiceBilling.handleHeard('purchase', ['online 900']);
            expect($('voiceCheck').textContent).toContain('online 900');
            await VoiceBilling.handleHeard('purchase', ['undo']);
            expect($('voiceSheetLive').textContent).toBe('The last thing said was taken off this check.');
            expect($('voicePay-online')).toBeNull();
        });
        await expect(VoiceBilling.listenOnce('purchase', 'web')).resolves.toBe(true);
        expect(modal).toHaveBeenCalledTimes(1);
        expect(billLines()).toEqual([['Wheat', 10, 24], ['Rice', 5, 30]]);
        expect([val('cashPayment'), val('onlinePayment')]).toEqual(['500', '']);
        expect(VoiceBilling.sheet).toBeNull();
    });
});

describe('a name said alone: the party pick list (#498)', () => {
    test('lists the closest parties and "Use as said"; a pick fills the field as typing would', async () => {
        known('customerOptions', ['Ramesh Bhai', 'Ramesh Kumar', 'Suresh']);
        window.webkitSpeechRecognition = fakeWebSpeech(['रमेश से']);
        const pick = jest.spyOn(UIManager, 'showCustomModal').mockResolvedValue('m1');
        const check = jest.spyOn(UIManager, 'showModalWithHtml');
        const events = [];
        $('customerName').addEventListener('input', () => events.push('input'));
        $('customerName').addEventListener('change', () => events.push('change'));

        await expect(VoiceMic.start('purchase')).resolves.toBe(true);
        expect(check).not.toHaveBeenCalled();

        const html = pick.mock.calls[0][0];
        expect(html.match(/voice\.pickName\('m\d'\)/g)).toEqual(["voice.pickName('m0')", "voice.pickName('m1')"]);
        expect(html).toContain('Ramesh Bhai');
        expect(html).toContain('Use “रमेश” as said');
        expect(html).not.toContain('Suresh');
        expect(val('customerName')).toBe('Ramesh Kumar');
        expect(events).toEqual(['input', 'change']);
        expect($('voiceUndoPurchase').hidden).toBe(false);
    });

    test('Cancel fills nothing; "Use as said" keeps the words; Retail sale fills the customer', async () => {
        known('saleCustomerOptions', ['Mohan Lal']);
        window.webkitSpeechRecognition = fakeWebSpeech(['customer Mohan']);
        jest.spyOn(UIManager, 'showCustomModal').mockResolvedValueOnce(null).mockResolvedValueOnce('spoken').mockResolvedValueOnce('m0');
        await expect(VoiceMic.start('sale')).resolves.toBe(false);
        expect(val('saleCustomerName')).toBe('');
        await VoiceMic.start('sale');
        expect(val('saleCustomerName')).toBe('Mohan');
        known('saleCustomerOptions', ['Mohan Lal']);
        await VoiceMic.start('sale');
        expect(val('saleCustomerName')).toBe('Mohan Lal');
    });

    test('a bare name with no party word, and "Pick from phone contacts" in the list', async () => {
        known('customerOptions', ['Ramesh Bhai', 'Suresh']);
        window.webkitSpeechRecognition = fakeWebSpeech(['Ramesh']);
        window.ContactsManager = function ContactsManager() {};
        Object.defineProperty(navigator, 'contacts', { value: { select: jest.fn() }, configurable: true });
        const pick = jest.spyOn(UIManager, 'showCustomModal').mockResolvedValue('m0');
        jest.spyOn(UIManager, 'showModalWithHtml');
        try {
            await expect(VoiceMic.start('purchase')).resolves.toBe(true);
        } finally {
            delete window.ContactsManager;
            delete navigator.contacts;
        }
        expect(pick.mock.calls[0][0]).toContain('Use “Ramesh” as said');
        expect(pick.mock.calls[0][0]).toContain("voice.pickName('contacts')");
        expect(UIManager.showModalWithHtml).not.toHaveBeenCalled();
        expect(val('customerName')).toBe('Ramesh Bhai');
    });

    test('a name with an item or amount is a whole bill: the check sheet, not the pick list', async () => {
        window.webkitSpeechRecognition = fakeWebSpeech(['Ramesh se, cash 100']);
        const pick = jest.spyOn(UIManager, 'showCustomModal');
        const modal = sheet(true);
        await VoiceMic.start('purchase');
        expect(pick).not.toHaveBeenCalled();
        expect(modal).toHaveBeenCalledTimes(1);
    });

    test('a name said while the check sheet is open sets its party', async () => {
        known('customerOptions', ['Ramesh Bhai']);
        window.webkitSpeechRecognition = fakeWebSpeech(['wheat 10 kg 24']);
        const pick = jest.spyOn(UIManager, 'showCustomModal');
        sheet(true, async () => {
            await VoiceBilling.handleHeard('purchase', ['Ramesh']);
            expect($('voiceCheck').textContent).toContain('Ramesh Bhai');
        });
        await VoiceBilling.listenOnce('purchase', 'web');
        expect(pick).not.toHaveBeenCalled();
        expect(val('customerName')).toBe('Ramesh Bhai');
    });
});

/** A Capacitor SpeechRecognition plugin: partial results by event; stop() never answers (as on Android). */
function fakePlugin({ perm = 'granted', asked = 'granted', available = true } = {}) {
    const listeners = {};
    const plugin = {
        available: jest.fn().mockResolvedValue({ available }),
        checkPermissions: jest.fn().mockResolvedValue({ speechRecognition: perm }),
        requestPermissions: jest.fn().mockResolvedValue({ speechRecognition: asked }),
        start: jest.fn().mockResolvedValue({}),
        stop: jest.fn(() => new Promise(() => {})),
        isListening: jest.fn().mockResolvedValue({ listening: true }),
        addListener: jest.fn(async (event, fn) => {
            listeners[event] = fn;
            return { remove: jest.fn(() => { delete listeners[event]; }) };
        }),
        emit: (event, data) => listeners[event]?.(data),
        listeners
    };
    window.Capacitor = { isNativePlatform: () => true, isPluginAvailable: (n) => n === 'SpeechRecognition', Plugins: { SpeechRecognition: plugin } };
    return plugin;
}

describe('Android app: the phone recogniser and the microphone permission', () => {
    test('the APK uses the native engine', () => {
        fakePlugin();
        expect(voiceEngine()).toBe('native');
    });

    test('first press asks for the microphone and does not listen; granted, the next hold listens until let go', async () => {
        const plugin = fakePlugin({ perm: 'prompt', asked: 'granted' });
        await expect(VoiceBilling.beginHold('purchase', 'native', {})).resolves.toBe(false);
        expect(plugin.requestPermissions).toHaveBeenCalledTimes(1);
        expect(plugin.start).not.toHaveBeenCalled();
        expect(UIManager.showToast).toHaveBeenLastCalledWith('Microphone allowed. Now hold the mic and speak.', 5000);

        plugin.checkPermissions.mockResolvedValue({ speechRecognition: 'granted' });
        const modal = sheet(false);
        const hold = {};
        const done = VoiceBilling.beginHold('purchase', 'native', hold);
        await flush(12);
        expect(plugin.start).toHaveBeenCalledWith({ language: 'en-IN', maxResults: 3, partialResults: true, popup: false });
        plugin.emit('partialResults', { matches: ['wheat 10 kg'] });
        expect($('voiceTranscriptPurchase').textContent).toContain('wheat 10 kg');
        hold.released = true;
        VoiceBilling.endHold(hold);
        expect(plugin.stop).toHaveBeenCalled();
        plugin.emit('partialResults', { matches: ['wheat 10 kg 24', 'wheat 10 kg 4'] });
        await done;
        expect(modal.mock.calls[0][0]).toContain('wheat 10 kg 24');
        expect(plugin.requestPermissions).toHaveBeenCalledTimes(1);
    });

    test('refused: a clear message pointing to Settings, and no listening', async () => {
        const plugin = fakePlugin({ perm: 'denied', asked: 'denied' });
        await expect(VoiceBilling.beginHold('purchase', 'native', {})).resolves.toBe(false);
        expect(plugin.start).not.toHaveBeenCalled();
        expect(UIManager.showToast).toHaveBeenLastCalledWith(expect.stringMatching(/Settings › Apps › this app › Permissions › Microphone/), 5000);
        setLang('hi');
        await VoiceBilling.beginHold('purchase', 'native', {});
        expect(UIManager.showToast).toHaveBeenLastCalledWith(expect.stringMatching(/माइक्रोफ़ोन में अनुमति दें/), 5000);
    });

    test('no recogniser on the phone: says so', async () => {
        fakePlugin({ available: false });
        await VoiceBilling.beginHold('purchase', 'native', {});
        expect(UIManager.showToast).toHaveBeenLastCalledWith(expect.stringMatching(/no speech recogniser turned on/), 5000);
    });

    test('Android ends at a pause while the mic is still held: it listens again and keeps both parts', async () => {
        jest.useFakeTimers();
        const plugin = fakePlugin();
        const session = openSession('native', 'en-IN', { win: window });
        await jest.advanceTimersByTimeAsync(0);
        plugin.emit('partialResults', { matches: ['wheat 10 kg 24'] });
        plugin.emit('listeningState', { status: 'stopped' });
        await jest.advanceTimersByTimeAsync(500);
        expect(plugin.start).toHaveBeenCalledTimes(2);
        plugin.emit('partialResults', { matches: ['cash 500'] });
        session.stop();
        plugin.emit('partialResults', { matches: ['cash 500', 'kash 500'] });
        await jest.advanceTimersByTimeAsync(200);
        await expect(session.result).resolves.toEqual(['wheat 10 kg 24 cash 500', 'wheat 10 kg 24 kash 500']);
    });
});

/** A browser recogniser that listens until stop(); `say` sends words. */
function holdRecogniser() {
    const made = [];
    window.webkitSpeechRecognition = jest.fn().mockImplementation(function Rec() {
        made.push(this);
        this.start = jest.fn();
        this.stop = jest.fn(() => setTimeout(() => this.onend()));
        this.abort = jest.fn(() => setTimeout(() => this.onend()));
    });
    return {
        made,
        say: (text) => made[made.length - 1].onresult({ results: [Object.assign([{ transcript: text }], { isFinal: true })] })
    };
}

const pointer = (type, el, opts = {}) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10, ...opts });
    Object.defineProperty(e, 'pointerId', { value: 7 });
    el.dispatchEvent(e);
    return e;
};

describe('hold-to-talk on the mic (pointer events)', () => {
    let now = 1000;
    beforeEach(() => {
        now = 1000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
        VoiceMic.apply();
        bindHold(document);
    });

    test('press, speak, let go: what was said goes to the sheet; the click after is not a second listen', async () => {
        const rec = holdRecogniser();
        const modal = sheet(true);
        const mic = $('voiceMicPurchase');
        const down = pointer('pointerdown', mic);
        expect(down.defaultPrevented).toBe(true);
        await flush(20);
        expect(mic.classList.contains('voice-listening')).toBe(true);
        rec.say('wheat 10 kg 24');
        now += 2000;
        pointer('pointerup', mic);
        const start = jest.spyOn(VoiceMic, 'start');
        mic.click();
        expect(start).not.toHaveBeenCalled();
        await new Promise(r => setTimeout(r, 20));
        await flush(20);
        expect(modal).toHaveBeenCalledTimes(1);
        expect([val('billItem'), val('billRate'), val('newWeight')]).toEqual(['1', '24', '10']);
    });

    test('a cancelled press, or letting go off the mic, uses nothing', async () => {
        const rec = holdRecogniser();
        const modal = sheet(true);
        const mic = $('voiceMicPurchase');
        pointer('pointerdown', mic);
        await flush(20);
        rec.say('wheat 10 kg 24');
        pointer('pointercancel', mic);
        await new Promise(r => setTimeout(r, 20));
        await flush(20);
        expect(rec.made[0].abort).toHaveBeenCalled();

        mic.getBoundingClientRect = () => ({ left: 0, right: 48, top: 0, bottom: 48, width: 48, height: 48 });
        pointer('pointerdown', mic);
        await flush(20);
        rec.say('rice 5 kg 30');
        now += 2000;
        pointer('pointerup', mic, { clientX: 300, clientY: 10 });
        await new Promise(r => setTimeout(r, 20));
        await flush(20);
        expect(modal).not.toHaveBeenCalled();
        expect($('voiceTranscriptPurchase').textContent).toBe('Let go off the mic: nothing used.');
        expect(billLines()).toEqual([]);
    });

    test('voice on but no speech engine: the mic stays and a press says why', () => {
        const mic = $('voiceMicPurchase');
        expect(mic.hidden).toBe(false);
        pointer('pointerdown', mic);
        expect(UIManager.showToast).toHaveBeenLastCalledWith(expect.stringMatching(/isn't available on this device/), 5000);
    });
});
