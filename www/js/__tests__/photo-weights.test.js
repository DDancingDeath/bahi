/**
 * @fileoverview Photo of weights (#374): what the model's answer means (PW-1…PW-3), the free-limit
 * and offline messages, who sees the button, the AI Logic call (mocked) and the check sheet, which
 * only fills the line's bag chips and never adds a line or saves.
 */
import { BillingManager } from '../modules/billing.js';
import { PurchaseManager } from '../modules/purchase.js';
import { UIManager } from '../ui/ui-manager.js';
import { AppState } from '../utils/state.js';
import { Helpers } from '../utils/helpers.js';
import { setLang } from '../i18n/index.js';
import { SettingsManager } from '../modules/settings.js';
import { FirebaseService } from '../firebase/firestore-service.js';
import { AuditService } from '../services/audit.js';
import { PhotoWeights, canPickPhoto } from '../ui/photo-weights.js';
import { PhotoWeightsFlow } from '../modules/photo-weights.js';
import { readWeightsPhoto, _resetPhotoWeightsAi } from '../firebase/photo-weights-ai.js';
import {
    fitWithin, isQuotaError, normaliseReading, normaliseRotation, parseModelJson, parseWeightText, photoErrorKey,
    reviewSummary, rotateBox, PHOTO_WEIGHTS_MODEL, PHOTO_WEIGHTS_SCHEMA
} from '../utils/photo-weights.js';

jest.mock('../firebase/repos/bill-drafts.js', () => ({
    getAutoSave: jest.fn(),
    saveAutoSave: jest.fn().mockResolvedValue(undefined),
    deleteAutoSave: jest.fn().mockResolvedValue(undefined),
    saveDraft: jest.fn().mockResolvedValue(undefined),
    countDrafts: jest.fn().mockResolvedValue(0)
}));

const entry = (value, raw_text, column, row, extra = {}) => ({ value, raw_text, confidence: 0.95, column, row, box: [100, 100, 150, 300], ...extra });

/** Image (1).jpg of the spike: two columns, sideways, a dash decimal and a tick mark. */
const SAMPLE = {
    rotation_degrees: 270,
    columns: 2,
    weights: [
        entry(25.3, '25-3', 2, 1), entry(25.5, '25.5✓', 1, 1), entry(24, '24-0', 1, 2), entry(94.6, '94-6', 1, 3),
        entry(38, '38-0', 2, 2)
    ],
    written_total: null,
    written_count: null,
    crossed_out: [entry(51, '51', 1, 4)]
};

describe('PW-1: reading the answer', () => {
    test.each([
        ['94-6', 94.6], ['23-0', 23], ['25.5', 25.5], ['25.5✓', 25.5], ['48,5', 48.5], ['48½', 48.5],
        ['४८.५', 48.5], [' 40 ', 40], ['-23-2-', 23.2], ['4?.2', null], ['', null], ['0', null], ['abc', null], ['1.2.3', null]
    ])('%p → %p', (raw, kg) => {
        expect(parseWeightText(raw)).toBe(kg);
    });

    test('column by column, top to bottom; crossed-out entries kept apart; the written text wins', () => {
        const r = normaliseReading(SAMPLE);
        expect(r.entries.map(e => e.value)).toEqual([25.5, 24, 94.6, 25.3, 38]);
        expect(r.crossedOut.map(e => e.value)).toEqual([51]);
        expect(r.rotation).toBe(270);
        expect(r.entries.every(e => !e.unclear)).toBe(true);
    });

    test('a missed decimal point, a low confidence or an unreadable entry is not clear', () => {
        const r = normaliseReading({
            weights: [entry(946, '94-6', 1, 1), entry(40, '40', 1, 2, { confidence: 0.4 }), entry(42, '4?', 1, 3), entry(null, '', 1, 4)],
            crossed_out: []
        });
        expect(r.entries.map(e => [e.value, e.unclear])).toEqual([[94.6, true], [40, true], [42, true], [null, true]]);
    });

    test('over 100 kg is flagged (BF-BAGCHECK); exactly 100 is fine', () => {
        const r = normaliseReading({ weights: [entry(100, '100', 1, 1), entry(485, '485', 1, 2)], crossed_out: [] });
        expect(r.entries.map(e => e.heavy)).toEqual([false, true]);
    });

    test('no column / row: the model order; bad boxes dropped; a written total and count kept', () => {
        const r = normaliseReading({
            weights: [{ value: 30, raw_text: '30', confidence: 1, box: [5, 5, 1, 9] }, { value: 20, raw_text: '20', confidence: 1, box: [0, 0, 2000, 10] }],
            written_total: 50, written_count: 2
        });
        expect(r.entries.map(e => [e.value, e.box])).toEqual([[30, null], [20, [0, 0, 1000, 10]]]);
        expect([r.writtenTotal, r.writtenCount]).toEqual([50, 2]);
    });

    test('rotation and the JSON text', () => {
        expect([normaliseRotation(90), normaliseRotation(-90), normaliseRotation(361), normaliseRotation('x')]).toEqual([90, 270, 0, 0]);
        expect(parseModelJson('```json\n{"weights":[]}\n```')).toEqual({ weights: [] });
        expect(() => parseModelJson('[1]')).toThrow();
    });
});

describe('PW-2 / PW-3: count, total, the sheet check', () => {
    test('total and count against the sheet: a mismatch only warns', () => {
        const ok = reviewSummary([25.5, 24, 94.6], { writtenTotal: 144.1, writtenCount: 3 });
        expect(ok).toMatchObject({ count: 3, total: 144.1, heavy: 0, totalCheck: { ok: true }, countCheck: { ok: true } });
        const off = reviewSummary([25.5, 24, 140], { writtenTotal: 99.5, writtenCount: 4 });
        expect(off).toMatchObject({ count: 3, heavy: 1, totalCheck: { sheet: 99.5, read: 189.5, ok: false }, countCheck: { sheet: 4, read: 3, ok: false } });
        expect(reviewSummary([10]).totalCheck).toBeNull();
    });

    test('boxes follow the photo when it is turned upright; the photo is made smaller, never larger', () => {
        const box = [100, 200, 300, 400];
        expect(rotateBox(box, 0)).toEqual(box);
        expect(rotateBox(box, 90)).toEqual([200, 700, 400, 900]);
        expect(rotateBox(box, 180)).toEqual([700, 600, 900, 800]);
        expect(rotateBox(box, 270)).toEqual([600, 100, 800, 300]);
        expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
        expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    });
});

describe('errors: free limit, offline, not set up', () => {
    test('429 / RESOURCE_EXHAUSTED is the daily limit', () => {
        const sdk429 = Object.assign(new Error('AI: Error fetching from …: [429 Too Many Requests] Resource has been exhausted'), { code: 'fetch-error', customErrorData: { status: 429 } });
        expect(isQuotaError(sdk429)).toBe(true);
        expect(isQuotaError(new Error('RESOURCE_EXHAUSTED'))).toBe(true);
        expect(photoErrorKey(sdk429)).toBe('msg.photo_weights.limit');
        expect(photoErrorKey(new Error('x'), { online: false })).toBe('msg.photo_weights.offline');
        expect(photoErrorKey(Object.assign(new Error('enable it'), { code: 'api-not-enabled' }))).toBe('msg.photo_weights.unavailable');
        expect(photoErrorKey(Object.assign(new Error('x'), { customErrorData: { status: 403 } }))).toBe('msg.photo_weights.unavailable');
        expect(photoErrorKey(new Error('timeout'))).toBe('msg.photo_weights.failed');
    });
});

describe('readWeightsPhoto (Firebase AI Logic, mocked)', () => {
    const fakeSdk = (generate) => {
        const calls = {};
        const app = { name: 'photo-weights' };
        const sdk = [
            { getApps: () => [], initializeApp: jest.fn((opts, name) => { calls.init = [opts, name]; return app; }) },
            {
                GoogleAIBackend: function GoogleAIBackend() { this.kind = 'google'; },
                getAI: jest.fn((a, o) => { calls.ai = o; return { app: a }; }),
                getGenerativeModel: jest.fn((ai, params, req) => { calls.model = [params, req]; return { generateContent: generate }; })
            },
            { initializeAppCheck: jest.fn(), ReCaptchaEnterpriseProvider: function P(k) { this.key = k; } }
        ];
        return { sdk, calls };
    };
    beforeEach(() => _resetPhotoWeightsAi());

    test('the app\'s own config, JSON output with the schema, App Check (reCAPTCHA Enterprise, auto refresh) on every call', async () => {
        const generate = jest.fn().mockResolvedValue({ response: { text: () => '{"weights":[],"crossed_out":[]}' } });
        const { sdk, calls } = fakeSdk(generate);
        const startAppCheck = jest.fn().mockResolvedValue({});
        const deps = { loadSdk: async () => sdk, options: () => ({ projectId: 'any-project', apiKey: 'k', appId: 'a' }), win: { APP_CHECK_SITE_KEY: ' site ' }, startAppCheck, model: PHOTO_WEIGHTS_MODEL };
        const out = await readWeightsPhoto(new Blob(['jpeg'], { type: 'image/jpeg' }), { deps });
        expect(out).toEqual({ weights: [], crossed_out: [] });
        expect(calls.init).toEqual([{ projectId: 'any-project', apiKey: 'k', appId: 'a' }, 'photo-weights']);
        expect(calls.ai.backend.kind).toBe('google');
        expect(calls.model[0]).toMatchObject({ model: PHOTO_WEIGHTS_MODEL, generationConfig: { responseMimeType: 'application/json', responseSchema: PHOTO_WEIGHTS_SCHEMA } });
        expect(startAppCheck).toHaveBeenCalled();
        const [checkApp, checkOpts] = sdk[2].initializeAppCheck.mock.calls[0];
        expect(checkApp).toEqual({ name: 'photo-weights' });
        expect(checkOpts.provider).toBeInstanceOf(sdk[2].ReCaptchaEnterpriseProvider);
        expect(checkOpts.provider.key).toBe('site');
        expect(checkOpts.isTokenAutoRefreshEnabled).toBe(true);
        // AI Logic then asks App Check for a (limited-use) token and sends it with the request
        expect(calls.ai.useLimitedUseAppCheckTokens).toBe(true);
        const [parts] = generate.mock.calls[0];
        expect(parts[1].inlineData).toEqual({ mimeType: 'image/jpeg', data: Buffer.from('jpeg').toString('base64') });
    });

    test('AI Logic enforces App Check: no site key, or App Check not started, never calls Gemini', async () => {
        for (const [win, started] of [[{}, {}], [{ APP_CHECK_SITE_KEY: 'site' }, null]]) {
            _resetPhotoWeightsAi();
            const generate = jest.fn();
            const { sdk } = fakeSdk(generate);
            const deps = { loadSdk: async () => sdk, options: () => ({}), win, startAppCheck: jest.fn().mockResolvedValue(started), model: 'm' };
            const err = await readWeightsPhoto(new Blob(['x']), { deps }).catch((e) => e);
            expect(err).toMatchObject({ code: 'app-check' });
            expect(photoErrorKey(err)).toBe('msg.photo_weights.unavailable');
            expect(generate).not.toHaveBeenCalled();
        }
    });

    test('a 429 comes back as it is (no retry)', async () => {
        const err = Object.assign(new Error('[429 ] quota'), { customErrorData: { status: 429 } });
        const generate = jest.fn().mockRejectedValue(err);
        const { sdk } = fakeSdk(generate);
        const deps = { loadSdk: async () => sdk, options: () => ({}), win: { APP_CHECK_SITE_KEY: 'site' }, startAppCheck: jest.fn().mockResolvedValue({}), model: 'm' };
        await expect(readWeightsPhoto(new Blob(['x']), { deps })).rejects.toBe(err);
        expect(generate).toHaveBeenCalledTimes(1);
    });    test('cancelled before the upload: generateContent is never called (no free quota used)', async () => {
        const generate = jest.fn();
        const { sdk } = fakeSdk(generate);
        const ctrl = new AbortController();
        const deps = { loadSdk: async () => { ctrl.abort(); return sdk; }, options: () => ({}), win: { APP_CHECK_SITE_KEY: 'site' }, startAppCheck: jest.fn().mockResolvedValue({}), model: 'm' };
        await expect(readWeightsPhoto(new Blob(['x']), { signal: ctrl.signal, deps })).rejects.toMatchObject({ name: 'AbortError' });
        expect(generate).not.toHaveBeenCalled();
    });

    test('the cancel signal goes to the SDK, and a cancel during the request ends the read at once', async () => {
        let finish;
        const generate = jest.fn(() => new Promise((resolve, reject) => { finish = reject; }));
        const { sdk } = fakeSdk(generate);
        const ctrl = new AbortController();
        const deps = { loadSdk: async () => sdk, options: () => ({}), win: { APP_CHECK_SITE_KEY: 'site' }, startAppCheck: jest.fn().mockResolvedValue({}), model: 'm' };
        const reading = readWeightsPhoto(new Blob(['x']), { signal: ctrl.signal, deps });
        for (let i = 0; i < 50 && !generate.mock.calls.length; i++) await new Promise(r => setTimeout(r, 5));
        expect(generate.mock.calls[0][1]).toEqual({ signal: ctrl.signal });
        ctrl.abort();
        await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
        finish(new DOMException('Aborted', 'AbortError'));
    });
});

const DOM = `
  <input type="checkbox" id="settingPhotoWeights"><p id="photoWeightsOwnerOnly" hidden></p><p id="photoWeightsNeedsSetup" hidden></p>
  <div id="purchaseSection">
    <select id="billItem"><option value="0">Rice</option></select>
    <input id="billRate"><input id="newWeight"><div id="weightsDisplay"></div>
    <span id="totalWeights"></span><span id="totalPackets"></span>
    <button data-photo-weights id="photoWeightsPurchase" hidden></button>
    <input type="file" id="photoWeightsInput" hidden>
    <table id="billTable"><tbody></tbody></table>
  </div>`;

const tick = () => new Promise(r => setTimeout(r, 0));
const sheet = () => document.getElementById('photoWeightsSheet');

describe('who sees it: the owner switch, every role, devices that can take a photo', () => {
    beforeEach(() => {
        document.body.innerHTML = DOM;
        window.APP_CHECK_SITE_KEY = 'site-key';
        jest.spyOn(UIManager, 'showToast').mockImplementation(() => {});
        PhotoWeights.setShared(undefined);
    });

    afterEach(() => {
        delete window.APP_CHECK_SITE_KEY;
        delete window.Capacitor;
    });

    test('no App Check key on this build: no button, and Settings says why', () => {
        AppState.userRole = 'owner';
        delete window.APP_CHECK_SITE_KEY;
        PhotoWeights.setShared({ enabled: true });
        expect(document.getElementById('photoWeightsPurchase').hidden).toBe(true);
        expect(document.getElementById('photoWeightsNeedsSetup').hidden).toBe(false);
        window.APP_CHECK_SITE_KEY = 'site-key';
        PhotoWeights.apply();
        expect(document.getElementById('photoWeightsPurchase').hidden).toBe(false);
        expect(document.getElementById('photoWeightsNeedsSetup').hidden).toBe(true);
    });

    test('Android app: the tap offers Take photo or Choose photo (a gallery input without capture)', async () => {
        window.Capacitor = { isNativePlatform: () => true };
        PhotoWeights.setShared({ enabled: true });
        const ask = jest.spyOn(UIManager, 'showCustomModal').mockResolvedValueOnce('gallery').mockResolvedValueOnce('camera');
        const camera = jest.spyOn(document.getElementById('photoWeightsInput'), 'click').mockImplementation(() => {});
        const gallery = jest.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
        expect(PhotoWeights.pick('purchase')).toBe(true);
        await tick();
        const picker = document.getElementById('photoWeightsInputGallery');
        expect(picker.type).toBe('file');
        expect(picker.hasAttribute('capture')).toBe(false);
        expect(gallery.mock.contexts).toContain(picker);
        PhotoWeights.pick('purchase');
        await tick();
        expect(camera).toHaveBeenCalledTimes(1);
        expect(ask).toHaveBeenCalledTimes(2);
        gallery.mockRestore();
    });

    test('off by default: the button stays hidden and a tap opens nothing', () => {
        AppState.userRole = 'owner';
        PhotoWeights.apply();
        expect(document.getElementById('photoWeightsPurchase').hidden).toBe(true);
        const click = jest.spyOn(document.getElementById('photoWeightsInput'), 'click');
        expect(PhotoWeights.pick('purchase')).toBe(false);
        expect(click).not.toHaveBeenCalled();
    });

    test.each(['owner', 'manager', 'staff'])('on: %s sees the button and the camera opens', (role) => {
        AppState.userRole = role;
        PhotoWeights.setShared({ enabled: true });
        PhotoWeights.apply();
        expect(document.getElementById('photoWeightsPurchase').hidden).toBe(false);
        expect(document.getElementById('settingPhotoWeights').disabled).toBe(role !== 'owner');
        expect(document.getElementById('photoWeightsOwnerOnly').hidden).toBe(role === 'owner');
        const click = jest.spyOn(document.getElementById('photoWeightsInput'), 'click').mockImplementation(() => {});
        expect(PhotoWeights.pick('purchase')).toBe(true);
        expect(click).toHaveBeenCalled();
    });

    test('no file input on this device: hidden', () => {
        // A browser that does not know type="file" keeps the input a text box
        const doc = { createElement: () => Object.defineProperty({}, 'type', { get: () => 'text', set: () => {} }) };
        expect(canPickPhoto(doc)).toBe(false);
        expect(canPickPhoto()).toBe(true);
    });

    test('offline: says so and puts the cursor in the weight box, no camera', () => {
        PhotoWeights.setShared({ enabled: true });
        const online = jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        const click = jest.spyOn(document.getElementById('photoWeightsInput'), 'click');
        expect(PhotoWeights.pick('purchase')).toBe(false);
        expect(click).not.toHaveBeenCalled();
        expect(UIManager.showToast.mock.calls[0][0]).toBe('No internet. Please type the weights.');
        expect(document.activeElement.id).toBe('newWeight');
        online.mockRestore();
    });

    test('the switch: only the owner saves it, for every phone; a manager cannot; start-up without it is off', async () => {
        const save = jest.spyOn(FirebaseService, 'savePhotoWeightsSettings').mockResolvedValue(undefined);
        jest.spyOn(AuditService, 'note').mockImplementation(() => {});
        AppState.userRole = 'manager';
        await expect(SettingsManager.savePhotoWeights(true)).resolves.toBe(false);
        expect(save).not.toHaveBeenCalled();
        expect(PhotoWeights.shared()).toEqual({ enabled: false });

        AppState.userRole = 'owner';
        await expect(SettingsManager.savePhotoWeights(true)).resolves.toBe(true);
        expect(save).toHaveBeenCalledWith({ enabled: true });
        expect(document.getElementById('photoWeightsPurchase').hidden).toBe(false);

        save.mockRejectedValueOnce(new Error('offline'));
        await expect(SettingsManager.savePhotoWeights(false)).resolves.toBe(false);
        expect(PhotoWeights.shared()).toEqual({ enabled: true });

        AppState.userRole = 'staff';
        await SettingsManager.applySharedSettings({ laborRate: 6 });
        expect(PhotoWeights.shared()).toEqual({ enabled: false });
        expect(document.getElementById('photoWeightsPurchase').hidden).toBe(true);
    });
});

describe('check sheet', () => {
    const prepare = async () => ({ canvas: document.createElement('canvas'), blob: new Blob(['jpeg'], { type: 'image/jpeg' }) });
    const answer = (raw) => ({ prepare, read: jest.fn().mockResolvedValue(raw) });

    beforeEach(() => {
        setLang('en');
        document.body.innerHTML = DOM;
        jest.spyOn(UIManager, 'showToast').mockImplementation(() => {});
        jest.spyOn(UIManager, 'hapticFeedback').mockImplementation(() => {});
        AppState.items = [{ id: 'r', name: 'Rice', rates: [30] }];
        AppState.settings = { ...(AppState.settings || {}), showHindi: false };
        BillingManager.init();
        PurchaseManager.setWeights([]);
        PurchaseManager.setBillItems([]);
        PhotoWeightsFlow.open = null;
    });

    test('shows the weights in order with a numbered box each; Add fills the chips only, never a line or a save', async () => {
        PurchaseManager.setWeights([30]);
        const save = jest.spyOn(BillingManager, 'saveBillToHistory');
        const addToBill = jest.spyOn(PurchaseManager, 'addToBill');
        const done = PhotoWeightsFlow.read(new Blob(['x']), 'purchase', answer({ ...SAMPLE, rotation_degrees: 0 }));
        await tick();
        const inputs = [...sheet().querySelectorAll('.pw-row input')];
        expect(inputs.map(i => i.value)).toEqual(['25.5', '24', '94.6', '25.3', '38']);
        expect(sheet().querySelectorAll('.pw-box').length).toBe(5);
        expect(sheet().querySelector('.pw-crossed').textContent).toContain('51');
        expect(sheet().querySelector('.pw-summary').textContent).toBe('5 bags · 207.4 kg');
        expect(sheet().textContent).toContain('These go with the 1 weight already entered.');

        sheet().querySelector('.pw-row:nth-child(2) .btn-icon').click();
        const add = sheet().querySelector('.pw-add');
        expect(add.textContent).toBe('Add 4 weights');
        add.click();
        await expect(done).resolves.toBe(true);
        expect(PurchaseManager.getWeights()).toEqual([30, 25.5, 94.6, 25.3, 38]);
        expect(PurchaseManager.getBillItems()).toEqual([]);
        expect(addToBill).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
        expect(sheet()).toBeNull();
    });

    test('a weight over 100 kg is asked like a typed one; Fix keeps the sheet open and adds nothing', async () => {
        const done = PhotoWeightsFlow.read(new Blob(['x']), 'purchase', answer({ weights: [entry(48.5, '48.5', 1, 1), entry(485, '485', 1, 2)], crossed_out: [] }));
        await tick();
        expect(sheet().querySelector('.pw-row:nth-child(2) .tag.neg').textContent).toBe('Over 100 kg');
        sheet().querySelector('.pw-add').click();
        await tick();
        document.querySelector('.bag-check-dialog [data-choice="fix"]').click();
        await tick();
        expect(PurchaseManager.getWeights()).toEqual([]);
        expect(document.activeElement.id).toBe('pwWeight1');

        sheet().querySelector('.pw-add').click();
        await tick();
        document.querySelector('.bag-check-dialog [data-choice="confirm"]').click();
        await expect(done).resolves.toBe(true);
        expect(PurchaseManager.getWeights()).toEqual([48.5, 485]);
    });

    test('a crossed-out weight is left out unless put back; an edited weight is used as typed', async () => {
        const done = PhotoWeightsFlow.read(new Blob(['x']), 'purchase', answer({ weights: [entry(20, '20', 1, 1)], crossed_out: [entry(51, '51', 1, 2)] }));
        await tick();
        const input = sheet().querySelector('#pwWeight0');
        input.value = '21-5';
        input.dispatchEvent(new Event('input'));
        sheet().querySelector('.pw-crossed .btn').click();
        expect(sheet().querySelector('.pw-summary').textContent).toBe('2 bags · 72.5 kg');
        sheet().querySelector('.pw-add').click();
        await expect(done).resolves.toBe(true);
        expect(PurchaseManager.getWeights()).toEqual([21.5, 51]);
    });

    test('the sheet\'s written total is checked', async () => {
        PhotoWeightsFlow.read(new Blob(['x']), 'purchase', answer({ weights: [entry(20, '20', 1, 1), entry(30, '30', 1, 2)], crossed_out: [], written_total: 60, written_count: 2 }));
        await tick();
        expect(sheet().querySelector('.pw-checks').textContent).toContain('The sheet says 60 kg in total, but these add up to 50 kg.');
        expect(sheet().querySelector('.pw-checks').textContent).toContain('Bags on the sheet: 2 — matches.');
    });

    test('free limit used up: a clear message, typing stays open, no retry', async () => {
        const read = jest.fn().mockRejectedValue(Object.assign(new Error('quota'), { customErrorData: { status: 429 } }));
        const done = PhotoWeightsFlow.read(new Blob(['x']), 'purchase', { prepare, read });
        await tick();
        expect(sheet().querySelector('[data-photo-error]').textContent).toBe('Photo reading limit reached for today — please type the weights.');
        expect(read).toHaveBeenCalledTimes(1);
        sheet().querySelector('.btn-primary').click();
        await expect(done).resolves.toBe(false);
        expect(document.activeElement.id).toBe('newWeight');
    });

    test('offline when the photo comes back: nothing is sent', async () => {
        const online = jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        const read = jest.fn();
        PhotoWeightsFlow.read(new Blob(['x']), 'purchase', { prepare, read });
        await tick();
        expect(sheet().querySelector('[data-photo-error]').dataset.photoError).toBe('msg.photo_weights.offline');
        expect(read).not.toHaveBeenCalled();
        online.mockRestore();
    });

    test('Cancel while reading: the sheet closes, nothing is added and the abort shows no error', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        let signal;
        const read = jest.fn((blob, opts) => new Promise((resolve, reject) => {
            signal = opts.signal;
            opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })));
        }));
        const done = PhotoWeightsFlow.read(new Blob(['x']), 'purchase', { prepare, read });
        await tick();
        sheet().querySelector('[data-dismiss]').click();
        await expect(done).resolves.toBe(false);
        await tick();
        expect(signal.aborted).toBe(true);
        expect(sheet()).toBeNull();
        expect(warn).not.toHaveBeenCalled();
        expect(PurchaseManager.getWeights()).toEqual([]);
    });

    test('while the bill is saving nothing is added', async () => {
        const busy = jest.spyOn(Helpers, 'isBusy').mockReturnValue(true);
        PhotoWeightsFlow.read(new Blob(['x']), 'purchase', answer({ weights: [entry(20, '20', 1, 1)], crossed_out: [] }));
        await tick();
        sheet().querySelector('.pw-add').click();
        await tick();
        expect(PurchaseManager.getWeights()).toEqual([]);
        expect(busy).toHaveBeenCalledWith('purchase');
    });
});
