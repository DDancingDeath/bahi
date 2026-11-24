/**
 * Push while the app is closed (docs/notifications.md, stage 2): this phone's device doc, the
 * call to the sender after a notification is written, and the Android plugin (mocked).
 */
import { webcrypto } from 'crypto';
import { TextEncoder as NodeTextEncoder } from 'util';
import { pushDeviceId, pushDeviceDoc, pushDeviceSig, pushDeviceStale, PUSH_REFRESH_MS, PUSH_DEVICE_KEY } from '../utils/push-device.js';
import { triggerPush, requestPush } from '../firebase/push-trigger.js';
import { savePushDevice, deletePushDevice, readPushDeviceDoc } from '../firebase/repos/push-devices.js';
import { PushNotify } from '../modules/push-notify.js';
import { PhoneNotify } from '../modules/phone-notify.js';
import { UIManager } from '../ui/ui-manager.js';
import { FirebaseService } from '../firebase/firestore-service.js';
import { AppState } from '../utils/state.js';
import { APP_IDENTITY } from '../config/app-identity.js';
import { notifyPrefs } from '../utils/phone-reminders.js';

jest.mock('../firebase/repos/push-devices.js', () => ({
    savePushDevice: jest.fn(async () => {}),
    deletePushDevice: jest.fn(async () => {}),
    readPushDeviceDoc: jest.fn(async () => ({ updatedAt: 1 }))
}));
jest.mock('../config/app-identity.js', () => ({
    APP_IDENTITY: { appName: 'Bahi', projectId: 'bahi-happa', push: { url: 'https://script.google.com/macros/s/abc/exec', vapidKey: '' } }
}));

if (typeof globalThis.TextEncoder === 'undefined') globalThis.TextEncoder = NodeTextEncoder;
if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const prefs = (stored = { on: true }) => notifyPrefs(stored, { role: 'owner', granted: true });

describe('device doc (utils/push-device.js)', () => {
    test('id is a hex hash of the token, never the token', async () => {
        const id = await pushDeviceId('tok/with:odd', webcrypto.subtle);
        expect(id).toMatch(/^[0-9a-f]{40}$/);
        expect(await pushDeviceId('tok/with:odd', webcrypto.subtle)).toBe(id);
        expect(await pushDeviceId('other', webcrypto.subtle)).not.toBe(id);
    });

    test('copies the master switch and every kind switch, and the language', () => {
        const doc = pushDeviceDoc({ token: 't', platform: 'android', prefs: prefs({ on: true, cashClose: false }), lang: 'hi' });
        expect(doc).toEqual({ token: 't', platform: 'android', on: true, kinds: { backup: true, cashClose: false, cashOpen: true, item: true, rate: true, rent: false, role: true, todo: true, udhaar: true }, lang: 'hi' });
        expect(pushDeviceDoc({ token: 't', platform: 'web', prefs: prefs(), lang: 'xx' }).lang).toBe('en');
    });

    test('written again when anything changed or after a week', () => {
        const sig = pushDeviceSig('u1', 'h', pushDeviceDoc({ token: 't', platform: 'android', prefs: prefs(), lang: 'en' }));
        const now = 10 * PUSH_REFRESH_MS;
        expect(pushDeviceStale(null, sig, now)).toBe(true);
        expect(pushDeviceStale({ sig, at: now - 1000 }, sig, now)).toBe(false);
        expect(pushDeviceStale({ sig, at: now - PUSH_REFRESH_MS - 1 }, sig, now)).toBe(true);
        expect(pushDeviceStale({ sig: 'x', at: now }, sig, now)).toBe(true);
        expect(pushDeviceStale({ sig, at: now + 60000 }, sig, now)).toBe(true);
    });
});

describe('call to the sender (firebase/push-trigger.js)', () => {
    afterEach(() => { delete window.COLLECTION_PREFIX; });

    test('posts the event id and project, without waiting', () => {
        const fetchFn = jest.fn(() => Promise.reject(new Error('offline')));
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        expect(triggerPush('rate-1-sale', { fetchFn })).toBe(true);
        const [url, init] = fetchFn.mock.calls[0];
        expect(url).toBe('https://script.google.com/macros/s/abc/exec');
        expect(init).toMatchObject({ method: 'POST', mode: 'no-cors', keepalive: true });
        expect(JSON.parse(init.body)).toEqual({ eventId: 'rate-1-sale', project: 'bahi-happa' });
    });

    test('nothing without a sender, an event id, or on test data', () => {
        const fetchFn = jest.fn(async () => ({}));
        expect(triggerPush('e1', { fetchFn, identity: { projectId: 'p', push: { url: '' } } })).toBe(false);
        expect(triggerPush('', { fetchFn })).toBe(false);
        window.COLLECTION_PREFIX = 'dev_';
        expect(triggerPush('e1', { fetchFn })).toBe(false);
        expect(fetchFn).not.toHaveBeenCalled();
    });
});

describe('test call that waits for the answer (requestPush)', () => {
    afterEach(() => { delete window.COLLECTION_PREFIX; });

    test('posts the delay, a readable request, and returns the answer', async () => {
        const fetchFn = jest.fn(async () => ({ json: async () => ({ ok: true, docs: 1, targets: 2, sent: 2 }) }));
        expect(await requestPush('test-1', { delay: 30, fetchFn })).toEqual({ ok: true, docs: 1, targets: 2, sent: 2 });
        const [, init] = fetchFn.mock.calls[0];
        expect(init.mode).toBeUndefined();
        expect(JSON.parse(init.body)).toEqual({ eventId: 'test-1', project: 'bahi-happa', delay: 30 });
        await requestPush('test-2', { fetchFn });
        expect(JSON.parse(fetchFn.mock.calls[1][1].body)).toEqual({ eventId: 'test-2', project: 'bahi-happa' });
    });

    test('no sender, test data or an unreadable answer: null', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        expect(await requestPush('e1', { fetchFn: jest.fn(async () => { throw new TypeError('cors'); }) })).toBeNull();
        expect(await requestPush('e1', { fetchFn: jest.fn(), identity: { push: { url: '' } } })).toBeNull();
        window.COLLECTION_PREFIX = 'dev_';
        const fetchFn = jest.fn();
        expect(await requestPush('e1', { fetchFn })).toBeNull();
        expect(fetchFn).not.toHaveBeenCalled();
        jest.restoreAllMocks();
    });
});

function messagingPlugin(token = 'fcm-1') {
    const listeners = {};
    const fm = {
        getToken: jest.fn(async () => ({ token })),
        deleteToken: jest.fn(async () => {}),
        addListener: jest.fn((name, fn) => { listeners[name] = fn; return Promise.resolve({ remove() {} }); })
    };
    const ln = {
        checkPermissions: jest.fn(async () => ({ display: 'granted' })),
        requestPermissions: jest.fn(async () => ({ display: 'granted' })),
        createChannel: jest.fn(async () => {}),
        schedule: jest.fn(async () => ({})),
        cancel: jest.fn(async () => {}),
        getPending: jest.fn(async () => ({ notifications: [] })),
        addListener: jest.fn(async () => ({ remove() {} }))
    };
    window.Capacitor = { isNativePlatform: () => true, Plugins: { FirebaseMessaging: fm, LocalNotifications: ln } };
    return { fm, ln, listeners };
}

describe('Android app (@capacitor-firebase/messaging, mocked)', () => {
    beforeEach(() => {
        localStorage.clear();
        Object.assign(PushNotify, { bound: false, token: null, chain: Promise.resolve() });
        savePushDevice.mockClear();
        deletePushDevice.mockClear();
    });
    afterEach(() => { delete window.Capacitor; jest.restoreAllMocks(); });

    test('writes the device doc once, again only when a switch changes', async () => {
        const { fm } = messagingPlugin();
        await PushNotify.sync('u1', prefs(), 'en');
        await PushNotify.sync('u1', prefs(), 'en');
        expect(fm.getToken).toHaveBeenCalledTimes(1);
        expect(savePushDevice).toHaveBeenCalledTimes(1);
        const [uid, id, doc] = savePushDevice.mock.calls[0];
        expect(uid).toBe('u1');
        expect(id).toBe(await pushDeviceId('fcm-1'));
        expect(doc).toMatchObject({ token: 'fcm-1', platform: 'android', on: true, lang: 'en' });
        await PushNotify.sync('u1', prefs({ on: true, rate: false }), 'en');
        expect(savePushDevice).toHaveBeenCalledTimes(2);
        expect(savePushDevice.mock.calls[1][2].kinds.rate).toBe(false);
        expect(PushNotify.handlesBell('u1')).toBe(true);
        expect(PushNotify.handlesBell('u2')).toBe(false);
    });

    test('phone notifications off: the doc goes, the token stays', async () => {
        const { fm } = messagingPlugin();
        await PushNotify.sync('u1', prefs(), 'en');
        await PushNotify.sync('u1', prefs({ on: false }), 'en');
        expect(deletePushDevice).toHaveBeenCalledWith('u1', await pushDeviceId('fcm-1'));
        expect(fm.deleteToken).not.toHaveBeenCalled();
        expect(localStorage.getItem(PUSH_DEVICE_KEY)).toBeNull();
        expect(PushNotify.handlesBell('u1')).toBe(false);
    });

    test('sign-out: the doc and the token go', async () => {
        const { fm } = messagingPlugin();
        await PushNotify.sync('u1', prefs(), 'en');
        await PushNotify.forget();
        expect(deletePushDevice).toHaveBeenCalledWith('u1', await pushDeviceId('fcm-1'));
        expect(fm.deleteToken).toHaveBeenCalled();
        expect(localStorage.getItem(PUSH_DEVICE_KEY)).toBeNull();
    });

    test('no sender configured: nothing registered', async () => {
        const { fm } = messagingPlugin();
        const url = APP_IDENTITY.push.url;
        APP_IDENTITY.push.url = '';
        try {
            await PushNotify.sync('u1', prefs(), 'en');
        } finally {
            APP_IDENTITY.push.url = url;
        }
        expect(fm.getToken).not.toHaveBeenCalled();
        expect(savePushDevice).not.toHaveBeenCalled();
    });

    test('a tap on a pushed notification opens its page; the local bell notification is left to the push', async () => {
        const { listeners, ln } = messagingPlugin();
        AppState.userRole = 'owner';
        AppState.currentUser = { uid: 'u1' };
        jest.spyOn(UIManager, 'showToast').mockImplementation(() => {});
        jest.spyOn(FirebaseService, 'listenOpenReminders').mockImplementation(() => () => {});
        Object.assign(PhoneNotify, { bound: false, permission: 'unknown', appActive: true, lastKey: null, chain: Promise.resolve(), pendingRoute: null });
        localStorage.setItem('happa.notify', JSON.stringify({ on: true }));
        await PhoneNotify.start('u1');
        await PushNotify.chain;
        expect(savePushDevice).toHaveBeenCalled();
        const route = jest.spyOn(PhoneNotify, 'route').mockImplementation(() => {});
        listeners.notificationActionPerformed({ notification: { data: { route: 'bell' } } });
        expect(route).toHaveBeenCalledWith('bell');
        PhoneNotify.appActive = false;
        expect(PhoneNotify.bell([{ type: 'rate_change', itemName: 'Wheat' }], 'u1')).toBe(false);
        expect(ln.schedule).not.toHaveBeenCalled();
        PhoneNotify.stop();
    });

    test('a push on screen or tapped is remembered; a test one on screen says so', async () => {
        const { listeners } = messagingPlugin();
        PushNotify.init(() => {});
        const onTest = jest.fn();
        PushNotify.onTest = onTest;
        expect(await PushNotify.lastPushAt()).toBe(0);
        listeners.notificationReceived({ notification: { data: { route: 'bell' } } });
        expect(onTest).not.toHaveBeenCalled();
        listeners.notificationReceived({ notification: { data: { route: 'bell', test: '1' } } });
        expect(onTest).toHaveBeenCalledTimes(1);
        expect(await PushNotify.lastPushAt()).toBeGreaterThan(Date.now() - 5000);
        PushNotify.onTest = null;
    });

    test('status: registered and present, missing on the server, or not registered', async () => {
        messagingPlugin();
        expect(await PushNotify.status('u1')).toEqual({ kind: 'android', savedAt: 0, present: false });
        await PushNotify.sync('u1', prefs(), 'en');
        const st = await PushNotify.status('u1');
        expect(st).toMatchObject({ kind: 'android', present: true });
        expect(st.savedAt).toBeGreaterThan(0);
        readPushDeviceDoc.mockResolvedValueOnce(null);
        expect((await PushNotify.status('u1')).present).toBe(false);
        readPushDeviceDoc.mockRejectedValueOnce(new Error('offline'));
        expect((await PushNotify.status('u1')).present).toBeNull();
        expect((await PushNotify.status('u2')).savedAt).toBe(0);
    });
});
