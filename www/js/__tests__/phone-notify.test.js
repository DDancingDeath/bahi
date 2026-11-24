/**
 * Phone notifications (docs/notifications.md): the plan of reminders, the choices and their
 * defaults, the Android plugin (mocked) and the browser's service worker path.
 */
import { PhoneNotify } from '../modules/phone-notify.js';
import { ManualReminders } from '../ui/manual-reminders.js';
import { UIManager } from '../ui/ui-manager.js';
import { FirebaseService } from '../firebase/firestore-service.js';
import { AppState } from '../utils/state.js';
import { saveRentReminder } from '../utils/reminders.js';
import {
    notifyPrefs, planReminders, planKey, ownReminderIds, udhaarSummary, NOTIFY_IDS, NOTIFY_PREFS_KEY
} from '../utils/phone-reminders.js';

const fs = require('fs');
const path = require('path');

const NOW = new Date(2026, 10, 15, 10, 0);
const on = (role = 'owner', extra = {}) => notifyPrefs({ on: true, ...extra }, { role, rentals: role === 'owner', granted: true });

describe('plan (utils/phone-reminders.js)', () => {
    test('To do at its date and time, 9:00 am without one; past, done and cancelled ones left out; soonest first', () => {
        const plan = planReminders({
            prefs: on('staff'), now: NOW, todos: [
                { id: 'a', title: 'Call Ramesh', party: 'Ramesh', dueDate: '2026-11-16', status: 'open' },
                { id: 'b', title: 'Pay', dueDate: '2026-11-15', dueTime: '16:30', status: 'open' },
                { id: 'c', title: 'Gone', dueDate: '2026-11-15', dueTime: '08:00', status: 'open' },
                { id: 'd', title: 'Done', dueDate: '2026-11-20', status: 'done' },
                { id: 'e', title: 'Off', dueDate: '2026-11-20', status: 'cancelled' }
            ]
        });
        expect(plan.map(p => [p.id, p.at, p.body, p.route])).toEqual([
            [NOTIFY_IDS.todo, new Date(2026, 10, 15, 16, 30), 'Pay', 'todo'],
            [NOTIFY_IDS.todo + 1, new Date(2026, 10, 16, 9, 0), 'Call Ramesh · Ramesh', 'todo']
        ]);
    });

    test('Udhaar summary at the summary time (tomorrow once it has passed), owner / manager only', () => {
        const udhaar = { total: 12500, overdue: 2 };
        const at = (prefs, now = NOW) => planReminders({ prefs, now, udhaar }).filter(p => p.kind === 'udhaar');
        expect(at(on('manager'))[0]).toMatchObject({ id: NOTIFY_IDS.udhaar, at: new Date(2026, 10, 15, 9, 30 + 24 * 60), route: 'udhaar' });
        expect(at(on('manager', { time: '18:00' }))[0].at).toEqual(new Date(2026, 10, 15, 18, 0));
        expect(at(on('manager'))[0].body).toMatch(/12,500 to collect, 2 overdue$/);
        expect(at(on('staff'))).toEqual([]);
        expect(planReminders({ prefs: on('owner'), now: NOW, udhaar: { total: 0, overdue: 0 } })).toEqual([]);
    });

    test('rent on each due day still to come this month; a backup check 30 days after the last one', () => {
        const rent = { due: 68000, dueUnits: 3, dueDays: [5, 15, 20, 28] };
        const plan = planReminders({ prefs: on('owner', { time: '11:00' }), now: NOW, rent, backup: { due: false, lastAt: new Date(2026, 10, 1).getTime() } });
        expect(plan.map(p => [p.kind, p.id, p.at])).toEqual([
            ['rent', NOTIFY_IDS.rent, new Date(2026, 10, 15, 11, 0)],
            ['rent', NOTIFY_IDS.rent + 1, new Date(2026, 10, 20, 11, 0)],
            ['rent', NOTIFY_IDS.rent + 2, new Date(2026, 10, 28, 11, 0)],
            ['backup', NOTIFY_IDS.backup, new Date(2026, 11, 1, 11, 0)]
        ]);
        expect(plan[0].body).toMatch(/68,000 due from 3 units$/);
        const due = planReminders({ prefs: on('owner'), now: NOW, backup: { due: true, lastAt: null } });
        expect(due[0].at).toEqual(new Date(2026, 10, 16, 9, 30));
    });

    test('per-type switches and the master switch', () => {
        const input = { now: NOW, todos: [{ title: 'x', dueDate: '2026-11-16', status: 'open' }], udhaar: { total: 5, overdue: 0 }, rent: { due: 5, dueDays: [20] }, backup: { due: true, lastAt: null } };
        expect(planReminders({ ...input, prefs: on('owner') }).map(p => p.kind).sort()).toEqual(['backup', 'rent', 'todo', 'udhaar']);
        expect(planReminders({ ...input, prefs: on('owner', { todo: false, rent: false }) }).map(p => p.kind).sort()).toEqual(['backup', 'udhaar']);
        expect(planReminders({ ...input, prefs: notifyPrefs({ on: false }, { role: 'owner', granted: true }) })).toEqual([]);
    });

    test('defaults: To do for everyone, Udhaar for owner / manager, Rent for rentals, Backup for the owner; off without permission', () => {
        expect(notifyPrefs(null, { role: 'staff', granted: true, defaultOn: true }).types).toEqual({ todo: true, udhaar: false, rent: false, backup: false });
        expect(notifyPrefs(null, { role: 'manager', rentals: true, granted: true, defaultOn: true }).types).toEqual({ todo: true, udhaar: true, rent: true, backup: false });
        expect(notifyPrefs(null, { role: 'owner', granted: true, defaultOn: true }).on).toBe(true);
        expect(notifyPrefs(null, { role: 'owner', granted: false, defaultOn: true }).on).toBe(false);
        expect(notifyPrefs(null, { role: 'owner', granted: true, defaultOn: false }).on).toBe(false);
        expect(notifyPrefs({ on: true }, { role: 'owner', granted: false }).on).toBe(false);
        expect(notifyPrefs({ time: '25:00' }, { role: 'owner' }).time).toBe('09:30');
    });

    test('updates from others: per kind for whoever gets them, on by default, role changes always; independent of the master switch', () => {
        const staff = notifyPrefs({ on: false }, { role: 'staff', granted: true });
        expect(staff.updatesAllowed).toEqual({ rate: true, item: false, cashOpen: false, cashClose: false, role: true });
        expect(staff.updates).toEqual({ rate: true, item: false, cashOpen: false, cashClose: false, role: true });
        const mgr = notifyPrefs({ cashOpen: false, rate: false, role: false }, { role: 'manager' });
        expect(mgr.updates).toEqual({ rate: false, item: false, cashOpen: false, cashClose: true, role: true });
        expect(notifyPrefs(null, { role: 'owner' }).updates).toEqual({ rate: true, item: true, cashOpen: true, cashClose: true, role: true });
    });

    test('helpers: plan key, our ids among pending ones, udhaar total', () => {
        const p = [{ id: 2001, at: NOW, title: 'a', body: 'b', route: 'udhaar' }];
        expect(planKey(p)).toBe(planKey([{ ...p[0] }]));
        expect(planKey(p)).not.toBe(planKey([{ ...p[0], body: 'c' }]));
        expect(ownReminderIds([{ id: 1001 }, { id: 2001 }, { id: '2105' }, { id: 2901 }, { id: 7 }])).toEqual([2001, 2105]);
        const bill = (customerName, due, date) => ({ customerName, date, payment: { due } });
        expect(udhaarSummary([[bill('A', 100, '2026-11-14'), bill('B', 50, '2026-09-01')], [bill('C', 25.5, '2026-08-01')]], NOW)).toEqual({ total: 175.5, overdue: 2 });
    });
});

function nativePlugin({ display = 'granted', request = 'granted' } = {}) {
    const listeners = {};
    const ln = {
        checkPermissions: jest.fn(async () => ({ display })),
        requestPermissions: jest.fn(async () => ({ display: request })),
        createChannel: jest.fn(async () => {}),
        schedule: jest.fn(async () => ({})),
        cancel: jest.fn(async () => {}),
        getPending: jest.fn(async () => ({ notifications: [{ id: 1001 }, { id: 2001 }, { id: 2100 }] })),
        addListener: jest.fn((name, fn) => { listeners[name] = fn; return Promise.resolve({ remove() {} }); })
    };
    const app = { addListener: jest.fn((name, fn) => { listeners[`app:${name}`] = fn; return Promise.resolve({ remove() {} }); }) };
    window.Capacitor = { isNativePlatform: () => true, Plugins: { LocalNotifications: ln, App: app } };
    return { ln, listeners };
}

function reset() {
    PhoneNotify.stop();
    Object.assign(PhoneNotify, { bound: false, permission: 'unknown', appActive: true, lastKey: null, chain: Promise.resolve(), pendingRoute: null });
    localStorage.clear();
    delete window.Capacitor;
    ManualReminders.stop();
}

describe('Android app (@capacitor/local-notifications, mocked)', () => {
    beforeEach(() => {
        reset();
        jest.useRealTimers();
        AppState.userRole = 'owner';
        AppState.currentUser = { uid: 'u1' };
        AppState.retailSalesHistory = [];
        jest.spyOn(UIManager, 'showToast').mockImplementation(() => {});
        jest.spyOn(FirebaseService, 'listenOpenReminders').mockImplementation(() => () => {});
    });
    afterEach(() => { reset(); jest.restoreAllMocks(); });

    test('start makes the channels and checks, never asks, for permission', async () => {
        const { ln } = nativePlugin({ display: 'prompt' });
        await PhoneNotify.start('u1');
        expect(ln.createChannel.mock.calls.map(c => c[0].id)).toEqual(['bahi', 'reminders']);
        expect(ln.checkPermissions).toHaveBeenCalled();
        expect(ln.requestPermissions).not.toHaveBeenCalled();
        expect(PhoneNotify.prefs().on).toBe(false);
    });

    test('scheduling cancels only our reminder ids, then makes the plan; the same plan again does nothing', async () => {
        const { ln } = nativePlugin();
        await PhoneNotify.start('u1');
        const at = new Date(Date.now() + 3600000);
        const plan = [{ id: 2100, kind: 'todo', at, title: 'To do', body: 'Call', route: 'todo' }];
        await PhoneNotify.apply(plan);
        expect(ln.cancel).toHaveBeenCalledWith({ notifications: [{ id: 2001 }, { id: 2100 }] });
        expect(ln.schedule).toHaveBeenCalledWith({
            notifications: [expect.objectContaining({ id: 2100, title: 'To do', body: 'Call', channelId: 'reminders', smallIcon: 'ic_stat_bahi', extra: { route: 'todo' }, schedule: { at, allowWhileIdle: true } })]
        });
        await PhoneNotify.apply(plan.map(p => ({ ...p })));
        expect(ln.schedule).toHaveBeenCalledTimes(1);
        await PhoneNotify.apply([{ ...plan[0], body: 'Call again' }]);
        expect(ln.cancel).toHaveBeenCalledTimes(2);
        expect(ln.schedule).toHaveBeenCalledTimes(2);
    });

    test('a To do with a time is scheduled from the live list; switching To do off cancels it', async () => {
        const { ln } = nativePlugin();
        await PhoneNotify.start('u1');
        PhoneNotify.ready = true;
        const tomorrow = new Date(Date.now() + 86400000);
        const iso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
        Object.assign(ManualReminders, { uid: 'u1', list: [{ id: 'r', title: 'Call', dueDate: iso, dueTime: '07:15', status: 'open' }] });
        await PhoneNotify.planNow();
        const sent = ln.schedule.mock.calls.at(-1)[0].notifications.find(n => n.extra.route === 'todo');
        expect(sent.schedule.at).toEqual(new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 7, 15));
        PhoneNotify.setType('todo', false);
        await PhoneNotify.planNow();
        expect(ln.cancel).toHaveBeenCalledTimes(2);
        expect(ln.schedule.mock.calls.at(-1)?.[0].notifications.some(n => n.extra.route === 'todo')).toBe(false);
        expect(JSON.parse(localStorage.getItem(NOTIFY_PREFS_KEY)).todo).toBe(false);
    });

    test('rent due days come from what Rentals last showed', async () => {
        const { ln } = nativePlugin();
        await PhoneNotify.start('u1');
        AppState.rentRole = 'owner';
        const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
        saveRentReminder(localStorage, { uid: 'u1', month, due: 500, late: 0, dueUnits: 1, dueDays: [28] });
        const plan = PhoneNotify.plan(new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1, 8, 0));
        expect(plan.find(p => p.kind === 'rent')?.at).toEqual(new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 28, 9, 30));
        expect(ln).toBeTruthy();
    });

    test('until the data is in after sign-in, going to the background keeps what was scheduled; then the plan is made', async () => {
        jest.useFakeTimers();
        const { ln, listeners } = nativePlugin();
        await PhoneNotify.start('u1');
        listeners['app:appStateChange']({ isActive: false });
        PhoneNotify.reschedule();
        await PhoneNotify.chain;
        expect(ln.getPending).not.toHaveBeenCalled();
        jest.advanceTimersByTime(8000);
        jest.useRealTimers();
        await PhoneNotify.chain;
        expect(ln.getPending).toHaveBeenCalledTimes(1);
        expect(ln.cancel).toHaveBeenCalledWith({ notifications: [{ id: 2001 }, { id: 2100 }] });
    });

    test('sign-out cancels this person\'s reminders and schedules nothing', async () => {
        const { ln } = nativePlugin();
        await PhoneNotify.start('u1');
        PhoneNotify.stop();
        await PhoneNotify.chain;
        expect(ln.cancel).toHaveBeenCalledWith({ notifications: [{ id: 2001 }, { id: 2100 }] });
        expect(ln.schedule).not.toHaveBeenCalled();
    });

    test('switching on asks once; refused: stays off, says where to allow it, schedules nothing', async () => {
        const { ln } = nativePlugin({ display: 'prompt', request: 'denied' });
        await PhoneNotify.start('u1');
        document.body.innerHTML = '<div id="notifSettingsCard" hidden><input id="settingPhoneNotifications" type="checkbox"><p id="notifPermNote" hidden></p><p id="notifPlatformNote"></p></div>';
        expect(await PhoneNotify.setOn(true)).toBe(false);
        expect(ln.requestPermissions).toHaveBeenCalledTimes(1);
        expect(UIManager.showToast).toHaveBeenCalledWith(expect.stringMatching(/blocked/i), 6000);
        await PhoneNotify.renderSettings();
        expect(document.getElementById('settingPhoneNotifications').checked).toBe(false);
        ln.checkPermissions.mockResolvedValue({ display: 'denied' });
        await PhoneNotify.renderSettings();
        expect(document.getElementById('notifPermNote').hidden).toBe(false);
        expect(document.getElementById('notifPermNote').textContent).toMatch(/phone settings/);
        await PhoneNotify.planNow();
        expect(ln.schedule).not.toHaveBeenCalled();
    });

    test('Send test notification: asks if needed, shows one now and one 10 s later', async () => {
        const { ln } = nativePlugin({ display: 'prompt', request: 'granted' });
        await PhoneNotify.start('u1');
        const before = Date.now();
        expect(await PhoneNotify.sendTest()).toBe(true);
        expect(ln.requestPermissions).toHaveBeenCalledTimes(1);
        const [now, later] = ln.schedule.mock.calls.map(c => c[0].notifications[0]);
        expect(now).toMatchObject({ id: NOTIFY_IDS.testNow, channelId: 'bahi', smallIcon: 'ic_stat_bahi' });
        expect(now.schedule).toBeUndefined();
        expect(later.id).toBe(NOTIFY_IDS.testLater);
        expect(later.schedule.at.getTime() - before).toBeGreaterThanOrEqual(10000);
        expect(later.schedule.at.getTime() - before).toBeLessThan(12000);
    });

    test('bell: only with the app in the background, the type on, and never for this person\'s own change', async () => {
        const { ln, listeners } = nativePlugin();
        await PhoneNotify.start('u1');
        const n = { id: 'n1', type: 'rate_change', itemName: 'Wheat', rateType: 'purchase', oldRate: 40, newRate: 45, changedBy: 'Manager' };
        expect(PhoneNotify.bell([n], 'u1')).toBe(false);
        listeners['app:appStateChange']({ isActive: false });
        expect(PhoneNotify.bell([{ ...n, byUid: 'u1' }], 'u1')).toBe(false);
        expect(PhoneNotify.bell([n], 'u2')).toBe(false);
        expect(PhoneNotify.bell([n], 'u1')).toBe(true);
        await Promise.resolve();
        const sent = ln.schedule.mock.calls.map(c => c[0].notifications[0]).find(x => x.id === NOTIFY_IDS.bell);
        expect(sent).toMatchObject({ channelId: 'bahi', extra: { route: 'bell' } });
        expect(sent.body).toMatch(/Wheat/);
        PhoneNotify.setType('bell', false);
        expect(PhoneNotify.bell([n], 'u1')).toBe(true);
        PhoneNotify.setUpdate('rate', false);
        expect(PhoneNotify.bell([n], 'u1')).toBe(false);
        expect(JSON.parse(localStorage.getItem(NOTIFY_PREFS_KEY)).rate).toBe(false);
        PhoneNotify.setUpdate('role', false);
        expect(PhoneNotify.wants({ type: 'role_change', newRole: 'manager' })).toBe(true);
    });

    test('test notifications: no switch of their own, may come from this person, never on the phone that sent a push test to itself', async () => {
        const { ln, listeners } = nativePlugin();
        await PhoneNotify.start('u1');
        listeners['app:appStateChange']({ isActive: false });
        PhoneNotify.setUpdate('rate', false);
        const n = { id: 'test-1_u1', type: 'test', changedBy: 'Me', changedByUserId: 'u1', byUid: 'u1', eventKey: 'test-1' };
        expect(PhoneNotify.wants(n)).toBe(true);
        expect(PhoneNotify.bell([n], 'u1')).toBe(true);
        await Promise.resolve();
        expect(ln.schedule.mock.calls.at(-1)[0].notifications[0].body).toBe('Test notification: it reached this phone. — Me');
        PhoneNotify.quiet.add('test-1');
        expect(PhoneNotify.wants(n)).toBe(false);
        expect(PhoneNotify.bell([n], 'u1')).toBe(false);
        PhoneNotify.quiet.clear();
        PhoneNotify.save({ on: false });
        expect(PhoneNotify.bell([n], 'u1')).toBe(false);
    });

    test('background test: only the scheduled one, 15 s later; the failure is returned without a toast', async () => {
        const { ln } = nativePlugin();
        await PhoneNotify.start('u1');
        const before = Date.now();
        expect(await PhoneNotify.sendTest({ now: false, laterMs: 15000, toast: false })).toBe(true);
        expect(ln.schedule).toHaveBeenCalledTimes(1);
        const later = ln.schedule.mock.calls[0][0].notifications[0];
        expect(later.id).toBe(NOTIFY_IDS.testLater);
        expect(later.body).toMatch(/15 seconds later/);
        expect(later.schedule.at.getTime() - before).toBeGreaterThanOrEqual(15000);
        expect(UIManager.showToast).not.toHaveBeenCalled();
        ln.checkPermissions.mockResolvedValue({ display: 'denied' });
        ln.requestPermissions.mockResolvedValue({ display: 'denied' });
        PhoneNotify.permission = 'denied';
        expect(await PhoneNotify.sendTest({ laterMs: 0, toast: false })).toBe('denied');
        expect(UIManager.showToast).not.toHaveBeenCalled();
    });

    test('cash opened / closed: a status-bar notification that opens Today › Cash; its own switch', async () => {
        const { ln, listeners } = nativePlugin();
        await PhoneNotify.start('u1');
        listeners['app:appStateChange']({ isActive: false });
        const n = { id: 'c1', type: 'cash_close', amount: 12300, difference: -200, changedBy: 'Ramesh' };
        expect(PhoneNotify.bell([n], 'u1')).toBe(true);
        await Promise.resolve();
        const sent = ln.schedule.mock.calls.map(c => c[0].notifications[0]).find(x => x.id === NOTIFY_IDS.bell);
        expect(sent.extra.route).toBe('cash');
        expect(sent.body).toBe('Cash closed by Ramesh · counted ₹12,300 · short ₹200');
        PhoneNotify.setUpdate('cashClose', false);
        expect(PhoneNotify.bell([n], 'u1')).toBe(false);
        expect(PhoneNotify.bell([{ ...n, id: 'c2', type: 'cash_open', amount: 5000 }], 'u1')).toBe(true);
        const showTab = jest.fn();
        window.app = { nav: { showTab } };
        listeners.localNotificationActionPerformed({ notification: { extra: { route: 'cash' } } });
        expect(showTab).toHaveBeenCalledWith('day-cash');
        delete window.app;
    });

    test('a tap opens the bell; a tap before sign-in waits for it', async () => {
        const { listeners } = nativePlugin();
        const open = jest.fn();
        window.app = { nav: { showTab: jest.fn() }, notifications: { open } };
        PhoneNotify.init();
        listeners.localNotificationActionPerformed({ notification: { extra: { route: 'bell' } } });
        expect(open).not.toHaveBeenCalled();
        expect(PhoneNotify.pendingRoute).toBe('bell');
        PhoneNotify.uid = 'u1';
        listeners.localNotificationActionPerformed({ notification: { extra: { route: 'bell' } } });
        expect(open).toHaveBeenCalledTimes(1);
        delete window.app;
    });

    test('an app built without the plugin: only the update switches, nothing thrown', async () => {
        window.Capacitor = { isNativePlatform: () => true, Plugins: {} };
        AppState.userRole = 'staff';
        await PhoneNotify.start('u1');
        expect(PhoneNotify.platform()).toBeNull();
        await expect(PhoneNotify.planNow()).resolves.toBeUndefined();
        document.body.innerHTML = '<div id="notifSettingsCard" hidden><div data-notify-phone></div>'
            + '<div data-notify-update="rate"><input type="checkbox"></div><div data-notify-update="cashOpen"><input type="checkbox"></div></div>';
        await PhoneNotify.renderSettings();
        expect(document.getElementById('notifSettingsCard').hidden).toBe(false);
        expect(document.querySelector('[data-notify-phone]').hidden).toBe(true);
        expect(document.querySelector('[data-notify-update="rate"]').hidden).toBe(false);
        expect(document.querySelector('[data-notify-update="rate"] input').checked).toBe(true);
        expect(document.querySelector('[data-notify-update="cashOpen"]').hidden).toBe(true);
    });
});

describe('browser (service worker showNotification)', () => {
    let showNotification;
    beforeEach(() => {
        reset();
        AppState.userRole = 'staff';
        AppState.currentUser = { uid: 'u1' };
        showNotification = jest.fn(async () => {});
        window.Notification = Object.assign(jest.fn(), { permission: 'granted', requestPermission: jest.fn(async () => 'granted') });
        Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: jest.fn(async () => ({ showNotification })), addEventListener: jest.fn() } });
        jest.spyOn(UIManager, 'showToast').mockImplementation(() => {});
    });
    afterEach(() => {
        reset();
        delete window.Notification;
        delete navigator.serviceWorker;
        jest.restoreAllMocks();
    });

    const hidden = (value) => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (value ? 'hidden' : 'visible') });

    test('a bell update while the tab is hidden goes through the service worker; none while it is visible', async () => {
        await PhoneNotify.start('u1');
        PhoneNotify.save({ on: true });
        const n = { id: 'n1', type: 'item_edit', action: 'added', itemName: 'Rice' };
        hidden(false);
        expect(PhoneNotify.bell([n], 'u1')).toBe(false);
        hidden(true);
        expect(PhoneNotify.bell([n], 'u1')).toBe(true);
        await new Promise(r => setTimeout(r, 0));
        expect(showNotification).toHaveBeenCalledWith('Bahi', expect.objectContaining({ tag: 'happa-bell', data: { route: 'bell' }, body: expect.stringMatching(/Rice/) }));
        expect(window.Notification).not.toHaveBeenCalled();
        hidden(false);
    });

    test('Send test notification shows one now (no second one: the browser cannot schedule)', async () => {
        await PhoneNotify.start('u1');
        expect(await PhoneNotify.sendTest()).toBe(true);
        expect(showNotification).toHaveBeenCalledTimes(1);
        expect(showNotification.mock.calls[0][1]).toMatchObject({ tag: 'happa-test' });
    });

    test('the service worker sends a tap to the open app, or opens the app on that page', async () => {
        const handlers = {};
        const client = { url: 'https://myhappa.web.app/', postMessage: jest.fn(), focus: jest.fn(async () => {}) };
        const clients = { matchAll: jest.fn(async () => [client]), openWindow: jest.fn(async () => {}), claim: () => {} };
        const self = { addEventListener: (type, fn) => { handlers[type] = fn; }, location: { origin: 'https://myhappa.web.app' }, skipWaiting: () => {}, clients };
        new Function('self', 'caches', 'fetch', fs.readFileSync(path.join(__dirname, '..', '..', 'service-worker.js'), 'utf8'))(self, {}, jest.fn());
        const click = async (route) => {
            let wait;
            const close = jest.fn();
            handlers.notificationclick({ notification: { close, data: { route } }, waitUntil: (p) => { wait = p; } });
            await wait;
            expect(close).toHaveBeenCalled();
        };
        await click('bell');
        expect(client.postMessage).toHaveBeenCalledWith({ type: 'HAPPA_NOTIFICATION', route: 'bell' });
        expect(client.focus).toHaveBeenCalled();
        clients.matchAll.mockResolvedValue([]);
        await click('todo');
        expect(clients.openWindow).toHaveBeenCalledWith('/?notify=todo');
    });
});
