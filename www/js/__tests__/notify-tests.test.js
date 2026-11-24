/**
 * Settings › Notifications › Test notifications (modules/notify-tests.js, utils/notify-test.js): the
 * limit of 5 a minute, the result line from the push sender's answer, who can be picked, and the panel
 * shown to owners and managers only.
 */
jest.mock('../firebase/push-trigger.js', () => ({ triggerPush: jest.fn(), requestPush: jest.fn() }));

import fs from 'fs';
import path from 'path';
import { requestPush } from '../firebase/push-trigger.js';
import { FirebaseService } from '../firebase/firestore-service.js';
import { AppState } from '../utils/state.js';
import { NotifyTests } from '../modules/notify-tests.js';
import { PhoneNotify } from '../modules/phone-notify.js';
import { PushNotify } from '../modules/push-notify.js';
import { takeTestSlot, pushResult, TEST_LIMIT, NOTIFY_TESTS_KEY } from '../utils/notify-test.js';
import { t } from '../i18n/index.js';

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'templates', 'settings.html'), 'utf8');
const panel = () => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    document.body.innerHTML = '';
    document.body.appendChild(doc.getElementById('notifSettingsCard'));
};
const resultOf = (kind) => document.querySelector(`[data-notify-result="${kind}"]`);

describe('limit and result line (utils/notify-test.js)', () => {
    test('5 tests a minute; the 6th says how long to wait; older ones no longer count', () => {
        let stamps = [];
        for (let i = 0; i < TEST_LIMIT; i++) {
            const r = takeTestSlot(stamps, 1000 + i * 1000);
            expect(r.ok).toBe(true);
            stamps = r.stamps;
        }
        expect(takeTestSlot(stamps, 10000)).toMatchObject({ ok: false, waitS: 51 });
        expect(takeTestSlot(stamps, 61001).ok).toBe(true);
        expect(takeTestSlot('junk', 5).ok).toBe(true);
    });

    test('the sender\'s answer', () => {
        expect(pushResult({ ok: true, docs: 1, targets: 2, sent: 1 }, { self: true })).toEqual({ key: 'tres_push_done', params: { sent: 1, targets: 2 } });
        expect(pushResult({ ok: true, docs: 1, targets: 0, sent: 0 }, { self: true }).key).toBe('tres_push_none');
        expect(pushResult({ ok: true, docs: 3, targets: 4, sent: 4 }, { self: false, people: 3 })).toEqual({ key: 'tres_others', params: { people: 3, targets: 4, sent: 4 } });
        expect(pushResult({ ok: true, docs: 3, targets: 0 }, { self: false, people: 3 }).key).toBe('tres_others_none');
        expect(pushResult({ ok: true, docs: 0 }, { self: true }).key).toBe('tres_swept');
        expect(pushResult({ ok: true, docs: 2, targets: 0, limited: 2 }, { self: false }).key).toBe('tres_limited');
        expect(pushResult({ ok: false, error: 'busy' }, { self: true })).toEqual({ key: 'tres_failed', params: { reasonKey: 'treason_busy' } });
        expect(pushResult(null, { self: true }).key).toBe('tres_push_unknown');
        expect(pushResult(null, { self: false, people: 2 })).toEqual({ key: 'tres_others_unknown', params: { people: 2 } });
    });
});

describe('test panel (modules/notify-tests.js)', () => {
    beforeEach(() => {
        localStorage.clear();
        NotifyTests.reset();
        AppState.currentUser = { uid: 'me' };
        AppState.userRole = 'manager';
        AppState.userName = 'Mgr';
        requestPush.mockReset();
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(FirebaseService, 'loadPeople').mockResolvedValue([
            { id: 'me', name: 'Mgr', role: 'manager' },
            { id: 'a', name: 'Asha', role: 'staff' },
            { id: 'o', name: 'Om', role: 'owner' },
            { id: 'p', name: 'Pending', role: 'staff', status: 'pending' }
        ]);
        jest.spyOn(FirebaseService, 'sendTestNotification').mockImplementation(async (ids) => ({ eventId: 'test-x', count: ids.length }));
        jest.spyOn(PushNotify, 'status').mockResolvedValue({ kind: null, savedAt: 0, present: false });
        jest.spyOn(PushNotify, 'lastPushAt').mockResolvedValue(0);
        panel();
    });
    afterEach(() => { jest.restoreAllMocks(); document.body.innerHTML = ''; });

    test('owners and managers see the panel instead of the single test button; others do not', async () => {
        NotifyTests.render();
        const box = document.getElementById('notifTestPanel');
        expect(box.hidden).toBe(false);
        expect(document.getElementById('notifTestBtnRow').hidden).toBe(true);
        expect(FirebaseService.loadPeople).not.toHaveBeenCalled();
        expect(PushNotify.status).not.toHaveBeenCalled();
        box.open = true;
        box.dispatchEvent(new Event('toggle'));
        await new Promise(r => setTimeout(r, 0));
        expect(PushNotify.status).toHaveBeenCalled();
        expect([...document.getElementById('notifTestTo').options].map(o => o.textContent))
            .toEqual([t('ui.notify.test_everyone'), 'Asha', 'Om']);
        AppState.userRole = 'staff';
        NotifyTests.render();
        expect(document.getElementById('notifTestPanel').hidden).toBe(true);
        expect(document.getElementById('notifTestBtnRow').hidden).toBe(false);
        expect(await NotifyTests.run('others')).toBe(false);
    });

    test('other phones: everyone but me, then how many phones were targeted and accepted', async () => {
        await NotifyTests.fillPicker();
        requestPush.mockResolvedValue({ ok: true, docs: 2, targets: 3, sent: 2 });
        expect(await NotifyTests.run('others')).toBe(true);
        expect(FirebaseService.sendTestNotification).toHaveBeenCalledWith(['a', 'o']);
        expect(requestPush).toHaveBeenCalledWith('test-x');
        expect(resultOf('others').textContent).toBe(t('ui.notify.tres_others', { people: 2, targets: 3, sent: 2 }));
        document.getElementById('notifTestTo').value = 'o';
        await NotifyTests.run('others');
        expect(FirebaseService.sendTestNotification).toHaveBeenLastCalledWith(['o']);
    });

    test('push to my own phones: not without push here; with it, quiet on this phone and delayed 30 s', async () => {
        await NotifyTests.run('push');
        expect(resultOf('push').textContent).toBe(t('ui.notify.tres_failed', { reason: t('ui.notify.treason_no_push') }));
        expect(resultOf('push').dataset.state).toBe('error');
        jest.spyOn(PushNotify, 'kind').mockReturnValue('android');
        jest.spyOn(PhoneNotify, 'prefs').mockReturnValue({ on: true, types: {}, updates: {} });
        PushNotify.status.mockResolvedValue({ kind: 'android', savedAt: 5, present: true });
        requestPush.mockResolvedValue({ ok: true, docs: 1, targets: 1, sent: 1 });
        expect(await NotifyTests.run('push')).toBe(true);
        expect(FirebaseService.sendTestNotification).toHaveBeenCalledWith(['me']);
        expect(requestPush).toHaveBeenCalledWith('test-x', { delay: 30 });
        expect(PhoneNotify.quiet.has('test-x')).toBe(true);
        expect(resultOf('push').textContent).toBe(t('ui.notify.tres_push_done', { sent: 1, targets: 1 }));
        PhoneNotify.quiet.clear();
    });

    test('at most 5 tests a minute per person', async () => {
        jest.spyOn(PhoneNotify, 'sendTest').mockResolvedValue(true);
        for (let i = 0; i < 5; i++) expect(await NotifyTests.run('now')).toBe(true);
        expect(await NotifyTests.run('later')).toBe(false);
        expect(resultOf('later').textContent).toMatch(/5 tests a minute/);
        expect(PhoneNotify.sendTest).toHaveBeenCalledTimes(5);
        expect(PhoneNotify.sendTest).toHaveBeenCalledWith({ laterMs: 0, toast: false });
        expect(JSON.parse(localStorage.getItem(NOTIFY_TESTS_KEY)).me).toHaveLength(5);
    });

    test('status: push, the switch, permission and the last push seen', async () => {
        PushNotify.status.mockResolvedValue({ kind: 'android', savedAt: Date.now() - 3 * 3600000, present: true });
        PhoneNotify.permission = 'denied';
        await NotifyTests.renderStatus(true);
        const lines = [...document.querySelectorAll('#notifTestStatus p')].map(p => p.textContent);
        expect(lines[0]).toMatch(/^Push: registered on this phone \(updated 3 h ago/);
        expect(lines[2]).toBe(t('ui.notify.st_perm', { state: t('ui.notify.st_perm_denied') }));
        expect(lines[3]).toBe(t('ui.notify.st_last_push_none'));
        PhoneNotify.permission = 'unknown';
    });
});
