/**
 * @fileoverview Settings › Notifications › Test notifications (owner and managers; docs/notifications.md,
 * "How to test"): a local one now, a scheduled one for the background, a real push to this person's
 * phones after ~30 s for the closed app, a test to other people's phones, and this phone's status.
 * @module modules/notify-tests
 */

import { AppState } from '../utils/state.js';
import { t } from '../i18n/index.js';
import { pickLang } from '../i18n/localize.js';
import { FirebaseService } from '../firebase/firestore-service.js';
import { requestPush } from '../firebase/push-trigger.js';
import { formatWhen } from '../utils/notification-format.js';
import { safeSetItem } from '../utils/storage-full.js';
import {
    NOTIFY_TESTS_KEY, TEST_LATER_MS, TEST_PUSH_DELAY_S, takeTestSlot, pushResult
} from '../utils/notify-test.js';
import { PhoneNotify } from './phone-notify.js';
import { PushNotify } from './push-notify.js';

const EVERYONE = '*';
const ROLES = ['owner', 'manager', 'staff'];
const STATUS_EVERY_MS = 60 * 1000;

const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);
const when = (ms) => {
    const w = formatWhen(ms);
    return `${pickLang(w)} (${w.abs})`;
};

export const NotifyTests = {
    people: null,
    peopleOf: null,
    statusAt: 0,

    allowed() {
        return AppState.userRole === 'owner' || AppState.userRole === 'manager';
    },

    /** One slot of this person's 5 a minute (kept on this phone; the sender counts too). */
    takeSlot(uid, now = Date.now()) {
        let all = {};
        try { all = JSON.parse(localStorage.getItem(NOTIFY_TESTS_KEY) || '{}') || {}; } catch (_) { all = {}; }
        const r = takeTestSlot(all[uid], now);
        if (r.ok) safeSetItem(NOTIFY_TESTS_KEY, JSON.stringify({ [uid]: r.stamps }));
        return r;
    },

    result(kind, text, state = '') {
        const el = typeof document !== 'undefined' ? document.querySelector(`[data-notify-result="${kind}"]`) : null;
        if (!el) return;
        el.textContent = text;
        el.dataset.state = state;
    },

    failed(kind, reasonKey, params) {
        this.result(kind, t('ui.notify.tres_failed', { reason: t(`ui.notify.${reasonKey}`, params) }), 'error');
        return false;
    },

    /**
     * Runs one test from its button.
     * @param {'now'|'later'|'push'|'others'} kind
     * @returns {Promise<boolean>}
     */
    async run(kind) {
        const uid = AppState.currentUser?.uid;
        if (!uid || !this.allowed()) return false;
        const slot = this.takeSlot(uid);
        if (!slot.ok) return this.failed(kind, 'treason_limit', { seconds: slot.waitS });
        if (kind === 'now' || kind === 'later') return this.local(kind);
        if (kind === 'push') return this.pushSelf(uid);
        if (kind === 'others') return this.others(uid);
        return false;
    },

    async local(kind) {
        const later = kind === 'later';
        const r = await PhoneNotify.sendTest(later ? { now: false, laterMs: TEST_LATER_MS, toast: false } : { laterMs: 0, toast: false });
        if (r !== true) return this.failed(kind, r === 'denied' ? 'treason_denied' : r === 'unsupported' ? 'treason_unsupported' : 'treason_show');
        this.result(kind, t(later ? 'ui.notify.tres_later' : 'ui.notify.tres_shown'), 'ok');
        return true;
    },

    async pushSelf(uid) {
        if (!PushNotify.kind()) return this.failed('push', 'treason_no_push');
        if (!PhoneNotify.prefs().on) return this.failed('push', 'treason_off');
        const st = await PushNotify.status(uid);
        if (!st.savedAt || st.present === false) return this.failed('push', 'treason_not_registered');
        let sent;
        try {
            sent = await FirebaseService.sendTestNotification([uid]);
        } catch (e) {
            console.warn('Test notification not written:', e?.message || e);
            return this.failed('push', 'treason_write');
        }
        PhoneNotify.quiet.add(sent.eventId);
        this.result('push', t('ui.notify.tres_push_wait'), 'wait');
        const r = pushResult(await requestPush(sent.eventId, { delay: TEST_PUSH_DELAY_S }), { self: true });
        this.show('push', r);
        return true;
    },

    async others(uid) {
        const to = $('notifTestTo')?.value || '';
        const people = await this.loadPeople();
        const ids = to === EVERYONE ? people.map(p => p.id) : people.some(p => p.id === to) ? [to] : [];
        if (!ids.length) return this.failed('others', 'treason_nobody');
        let sent;
        try {
            sent = await FirebaseService.sendTestNotification(ids);
        } catch (e) {
            console.warn('Test notification not written:', e?.message || e);
            return this.failed('others', 'treason_write');
        }
        this.result('others', t('ui.notify.tres_sending'), 'wait');
        this.show('others', pushResult(await requestPush(sent.eventId), { self: false, people: sent.count }));
        return true;
    },

    show(kind, r) {
        if (r.key === 'tres_failed') return this.failed(kind, r.params.reasonKey);
        this.result(kind, t(`ui.notify.${r.key}`, r.params), r.key === 'tres_limited' ? 'error' : 'ok');
        return true;
    },

    /** Everyone on the team but this person (active members only). */
    async loadPeople() {
        const me = AppState.currentUser?.uid;
        if (this.people && this.peopleOf === me) return this.people;
        let list = [];
        try { list = await FirebaseService.loadPeople(); } catch (e) { console.warn('Team not loaded:', e?.message || e); }
        this.people = (list || [])
            .filter(p => p && p.id && p.id !== me && ROLES.includes(p.role) && !['pending', 'rejected'].includes(p.status))
            .map(p => ({ id: p.id, name: String(p.name || p.email || p.id) }))
            .sort((a, b) => a.name.localeCompare(b.name));
        this.peopleOf = me;
        return this.people;
    },

    async fillPicker() {
        const select = $('notifTestTo');
        if (!select) return;
        const people = await this.loadPeople();
        const keep = select.value;
        select.replaceChildren();
        const add = (value, label) => {
            const o = document.createElement('option');
            o.value = value;
            o.textContent = label;
            select.appendChild(o);
        };
        if (people.length) add(EVERYONE, t('ui.notify.test_everyone'));
        people.forEach(p => add(p.id, p.name));
        if (keep && [...select.options].some(o => o.value === keep)) select.value = keep;
        const btn = $('notifTestOthersBtn');
        if (btn) btn.disabled = !people.length;
    },

    /** This phone: push registration, permission, battery hint (Android), the last push seen (at most one read a minute). */
    async renderStatus(force = false) {
        const box = $('notifTestStatus');
        const uid = AppState.currentUser?.uid;
        if (!box || !uid || (!force && Date.now() - this.statusAt < STATUS_EVERY_MS)) return;
        this.statusAt = Date.now();
        const st = await PushNotify.status(uid);
        const lines = [];
        if (!st.kind) lines.push(t('ui.notify.st_push_na'));
        else if (!st.savedAt) lines.push(t('ui.notify.st_push_no'));
        else if (st.present === false) lines.push(t('ui.notify.st_push_missing'));
        else lines.push(t(st.present ? 'ui.notify.st_push_yes' : 'ui.notify.st_push_unknown', { when: when(st.savedAt) }));
        lines.push(t('ui.notify.st_master', { state: t(PhoneNotify.prefs().on ? 'ui.notify.st_on' : 'ui.notify.st_off') }));
        const perm = ['granted', 'denied', 'prompt'].includes(PhoneNotify.permission) ? PhoneNotify.permission : 'unsupported';
        lines.push(t('ui.notify.st_perm', { state: t(`ui.notify.st_perm_${perm}`) }));
        const last = await PushNotify.lastPushAt();
        lines.push(last ? t('ui.notify.st_last_push', { when: when(last) }) : t('ui.notify.st_last_push_none'));
        if (PhoneNotify.platform() === 'native') lines.push(t('ui.notify.st_battery'));
        box.replaceChildren(...lines.map(text => {
            const p = document.createElement('p');
            p.className = 'setting-description';
            p.textContent = text;
            return p;
        }));
    },

    /** Shows the panel to owners and managers (the old single test button to everyone else). */
    render() {
        const panel = $('notifTestPanel');
        if (!panel) return;
        const show = this.allowed() && !!AppState.currentUser?.uid;
        panel.hidden = !show;
        const old = $('notifTestBtnRow');
        if (old) old.hidden = show;
        if (!show) return;
        if (!panel.dataset.bound) {
            panel.dataset.bound = '1';
            panel.addEventListener('toggle', () => { if (panel.open) this.opened(); });
        }
        if (panel.open) this.opened();
    },

    /** The team and the status are read only once the panel is opened (Settings itself reads nothing). */
    opened() {
        this.fillPicker().catch(e => console.warn('Test picker failed:', e?.message || e));
        this.renderStatus().catch(e => console.warn('Notification status failed:', e?.message || e));
    },

    /** Signed out or another person: nothing kept. */
    reset() {
        this.people = null;
        this.peopleOf = null;
        this.statusAt = 0;
    }
};

PhoneNotify.afterRender = () => NotifyTests.render();
