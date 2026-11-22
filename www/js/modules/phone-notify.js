/**
 * @fileoverview Phone notifications (docs/notifications.md): bell updates in the status bar
 * while the app runs but is not in front, and reminders at a time. Android app:
 * @capacitor/local-notifications (shown now, or scheduled so they come with the app closed).
 * Browser: the service worker's showNotification, only while the app is open. The phone's
 * permission is asked only when the user switches notifications on or sends a test.
 * @module modules/phone-notify
 */

import { AppState } from '../utils/state.js';
import { UIManager } from '../ui/ui-manager.js';
import { t } from '../i18n/index.js';
import { pickLang } from '../i18n/localize.js';
import { APP_IDENTITY } from '../config/app-identity.js';
import { on, REFRESH, REMINDERS_CHANGED, TODOS_CHANGED } from '../utils/events.js';
import { describeNotification, wantsUpdate, UPDATE_KINDS, ALWAYS_ON_KINDS } from '../utils/notification-format.js';
import { rentReminder } from '../utils/reminders.js';
import { drillReminder } from '../utils/backup-verify.js';
import { billsForKind } from '../utils/party-due.js';
import { canOpenPage } from '../utils/role-access.js';
import { toLocalISODate } from '../utils/dates.js';
import { safeSetItem } from '../utils/storage-full.js';
import { rentalsRole } from '../ui/business-switcher.js';
import { ManualReminders, TODAY_REMINDERS_KEY } from '../ui/manual-reminders.js';
import { setDisclosureOpen } from '../ui/disclosure.js';
import {
    NOTIFY_PREFS_KEY, LEGACY_SYSTEM_KEY, NOTIFY_TYPES, NOTIFY_IDS, notifyPrefs, planReminders, planKey,
    ownReminderIds, udhaarSummary, webTimers, inMs, isTimeText
} from '../utils/phone-reminders.js';

const CHANNEL_BELL = 'bahi';
const CHANNEL_REMINDERS = 'reminders';
const SMALL_ICON = 'ic_stat_bahi';
const RESCHEDULE_MS = 1500;
const FIRST_PLAN_MS = 8000;
const TEST_LATER_MS = 10000;
const ROUTES = new Set(['bell', 'cash', 'todo', 'udhaar', 'rent', 'backup', 'test']);

const capacitor = () => (typeof window !== 'undefined' ? window.Capacitor : null);
const isNative = () => !!capacitor()?.isNativePlatform?.();

export const PhoneNotify = {
    uid: null,
    permission: 'unknown',
    appActive: true,
    bound: false,
    timer: null,
    webTimers: [],
    lastKey: null,
    /** Set once the data had time to come in after sign-in: until then the phone keeps what it had scheduled. */
    ready: false,
    chain: Promise.resolve(),
    pendingRoute: null,

    /** The native plugin, or null (the browser, or an app built without it). */
    plugin() {
        return isNative() ? capacitor()?.Plugins?.LocalNotifications || null : null;
    },

    /** 'native' | 'web' | null (nothing can show a phone notification here). */
    platform() {
        if (isNative()) return this.plugin() ? 'native' : null;
        return typeof window !== 'undefined' && 'Notification' in window ? 'web' : null;
    },

    stored() {
        try {
            const s = JSON.parse(localStorage.getItem(NOTIFY_PREFS_KEY) || 'null');
            return s && typeof s === 'object' ? s : {};
        } catch (_) {
            return {};
        }
    },

    save(patch) {
        safeSetItem(NOTIFY_PREFS_KEY, JSON.stringify({ ...this.stored(), ...patch }));
    },

    prefs() {
        let legacy = false;
        try { legacy = localStorage.getItem(LEGACY_SYSTEM_KEY) === '1'; } catch (_) { legacy = false; }
        return notifyPrefs(this.stored(), {
            role: AppState.userRole,
            rentals: !!rentalsRole(AppState),
            granted: this.permission === 'granted',
            defaultOn: this.platform() === 'native' || legacy
        });
    },

    enabled(type) {
        const p = this.prefs();
        return p.on && !!p.types[type];
    },

    /** Whether bell item `n` should toast, badge and phone-notify (its kind's switch on this phone). */
    wants(n) {
        return wantsUpdate(n, this.stored());
    },

    /** The app is on screen (then the bell and its toast are enough). */
    foreground() {
        if (typeof document === 'undefined') return true;
        const visible = document.visibilityState !== 'hidden';
        return isNative() ? this.appActive && visible : visible;
    },

    async readNotifyPermission() {
        const kind = this.platform();
        try {
            if (kind === 'native') {
                const r = await this.plugin().checkPermissions();
                this.permission = r?.display === 'granted' ? 'granted' : r?.display === 'denied' ? 'denied' : 'prompt';
            } else if (kind === 'web') {
                const p = window.Notification.permission;
                this.permission = p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'prompt';
            } else {
                this.permission = 'unsupported';
            }
        } catch (e) {
            console.warn('Notification permission check failed:', e?.message || e);
            this.permission = 'unsupported';
        }
        return this.permission;
    },

    /** Asks the phone (Android 13+ / the browser) once, from a tap. */
    async askNotifyPermission() {
        const kind = this.platform();
        try {
            if (kind === 'native') {
                const r = await this.plugin().requestPermissions();
                this.permission = r?.display === 'granted' ? 'granted' : 'denied';
            } else if (kind === 'web') {
                const p = await window.Notification.requestPermission();
                this.permission = p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'prompt';
            }
        } catch (e) {
            console.warn('Notification permission request failed:', e?.message || e);
            await this.readNotifyPermission();
        }
        return this.permission;
    },

    /** Listeners that never change: taps on a notification, the app going to the back. Once per page. */
    init() {
        if (this.bound || typeof window === 'undefined') return;
        this.bound = true;
        const native = this.plugin();
        if (native) {
            try {
                native.addListener('localNotificationActionPerformed', (ev) => this.route(ev?.notification?.extra?.route));
            } catch (e) {
                console.warn('Notification tap listener failed:', e?.message || e);
            }
        }
        const app = isNative() ? capacitor()?.Plugins?.App : null;
        if (app?.addListener) {
            try {
                app.addListener('appStateChange', ({ isActive }) => {
                    this.appActive = !!isActive;
                    if (!isActive) this.planNow();
                    else this.readNotifyPermission().then(() => this.reschedule());
                });
            } catch (e) {
                console.warn('App state listener failed:', e?.message || e);
            }
        }
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') this.planNow();
            });
        }
        if (!isNative() && navigator.serviceWorker?.addEventListener) {
            navigator.serviceWorker.addEventListener('message', (ev) => {
                if (ev.data?.type === 'HAPPA_NOTIFICATION') this.route(ev.data.route);
            });
        }
        try {
            const url = new URL(window.location.href);
            const r = url.searchParams.get('notify');
            if (r) {
                url.searchParams.delete('notify');
                window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
                this.route(r);
            }
        } catch (_) { /* no launch link */ }
        [REMINDERS_CHANGED, TODOS_CHANGED, REFRESH.due, REFRESH.today, REFRESH.history].forEach(name => on(name, () => this.reschedule()));
        window.addEventListener('aadhat:langchange', () => {
            this.reschedule();
            this.renderSettings().catch(e => console.warn('Notification settings failed:', e?.message || e));
        });
    },

    /** Signed in: channels, the To do listener when needed, then the first plan. */
    async start(uid) {
        this.init();
        this.uid = uid || null;
        this.lastKey = null;
        this.ready = false;
        if (!this.uid) return;
        const native = this.plugin();
        if (native) {
            try {
                await native.createChannel({ id: CHANNEL_BELL, name: APP_IDENTITY.appName || 'Bahi', description: t('ui.notify.channel_bell'), importance: 4, visibility: 0 });
                await native.createChannel({ id: CHANNEL_REMINDERS, name: t('ui.notify.channel_reminders'), description: t('ui.notify.channel_reminders_hint'), importance: 4, visibility: 0 });
            } catch (e) {
                console.warn('Notification channels not made:', e?.message || e);
            }
        }
        await this.readNotifyPermission();
        this.listenTodos();
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { this.ready = true; this.planNow(); }, FIRST_PLAN_MS);
        if (this.pendingRoute) {
            const r = this.pendingRoute;
            this.pendingRoute = null;
            setTimeout(() => this.route(r), 1500);
        }
    },

    /** Signed out: nothing of this person comes later. */
    stop() {
        this.uid = null;
        this.ready = false;
        clearTimeout(this.timer);
        this.clearWebTimers();
        this.lastKey = null;
        this.apply([]);
    },

    /** To do reminders come from Today's listener; started here too when they may notify. */
    listenTodos() {
        if (!this.uid || !this.enabled('todo')) return;
        ManualReminders.start(ManualReminders.onChange);
    },

    reschedule() {
        if (!this.uid || !this.ready) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.planNow(), RESCHEDULE_MS);
    },

    /** What to schedule from what this phone has now. */
    plan(now = new Date()) {
        const prefs = this.prefs();
        if (!this.uid || !prefs.on) return [];
        const role = AppState.userRole;
        let udhaar = null;
        if (prefs.types.udhaar) {
            const lists = [];
            if (canOpenPage('due', role, AppState.settings?.roleAccess)) lists.push(AppState.retailSalesHistory || []);
            if (canOpenPage('wholesale-sales', role, AppState.settings?.roleAccess)) lists.push(billsForKind(AppState, 'wholesale'));
            udhaar = lists.length ? udhaarSummary(lists, now) : null;
        }
        let rent = null;
        let backup = null;
        try { if (prefs.types.rent) rent = rentReminder(localStorage, this.uid, toLocalISODate(now).slice(0, 7)); } catch (_) { rent = null; }
        try { if (prefs.types.backup) backup = drillReminder(localStorage, this.uid, now.getTime()); } catch (_) { backup = null; }
        return planReminders({ prefs, now, todos: ManualReminders.uid === this.uid ? ManualReminders.list : [], udhaar, rent, backup });
    },

    planNow() {
        if (!this.uid || !this.ready) return Promise.resolve();
        clearTimeout(this.timer);
        let plan = [];
        try { plan = this.plan(); } catch (e) { console.warn('Reminder plan failed:', e?.message || e); }
        return this.apply(plan);
    },

    /**
     * Android: cancel our scheduled reminders and make the plan again (one at a time, skipped when
     * nothing changed). Browser: timers while the app is open.
     */
    apply(plan) {
        const key = planKey(plan);
        const native = this.plugin();
        if (!native) {
            this.webTimersFor(plan);
            return Promise.resolve();
        }
        this.chain = this.chain.then(async () => {
            if (key === this.lastKey) return;
            const pending = await native.getPending();
            const ids = ownReminderIds(pending?.notifications);
            if (ids.length) await native.cancel({ notifications: ids.map(id => ({ id })) });
            if (plan.length) {
                await native.schedule({
                    notifications: plan.map(p => ({
                        id: p.id, title: p.title, body: p.body, channelId: CHANNEL_REMINDERS, smallIcon: SMALL_ICON,
                        autoCancel: true, extra: { route: p.route }, schedule: { at: p.at, allowWhileIdle: true }
                    }))
                });
            }
            this.lastKey = key;
        }).catch(e => {
            this.lastKey = null;
            console.warn('Reminders not scheduled:', e?.message || e);
        });
        return this.chain;
    },

    clearWebTimers() {
        this.webTimers.forEach(id => clearTimeout(id));
        this.webTimers = [];
    },

    webTimersFor(plan) {
        this.clearWebTimers();
        if (this.platform() !== 'web') return;
        webTimers(plan, Date.now()).forEach(({ item: p, wait }) => {
            this.webTimers.push(setTimeout(() => {
                if (this.foreground()) UIManager.showToast(`${p.title}: ${p.body}`, 8000);
                else this.show({ id: p.id, title: p.title, body: p.body, route: p.route, tag: `happa-${p.kind}`, channel: CHANNEL_REMINDERS });
            }, wait));
        });
    },

    /** Shows one notification now. */
    async show({ id, title, body, route, tag, channel = CHANNEL_BELL, at = null }) {
        const native = this.plugin();
        if (native) {
            const n = { id, title, body, channelId: channel, smallIcon: SMALL_ICON, autoCancel: true, extra: { route } };
            if (at) n.schedule = { at, allowWhileIdle: true };
            await native.schedule({ notifications: [n] });
            return true;
        }
        if (this.platform() !== 'web' || window.Notification.permission !== 'granted') return false;
        const options = { body, tag, icon: '/icons/icon-192.png', badge: '/icons/favicon-32.png', data: { route } };
        try {
            const reg = navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null;
            if (reg?.showNotification) {
                await reg.showNotification(title, options);
                return true;
            }
        } catch (e) {
            console.warn('Service worker notification failed:', e?.message || e);
        }
        try {
            const note = new window.Notification(title, options);
            note.onclick = () => { window.focus(); this.route(route); note.close(); };
            return true;
        } catch (e) {
            console.warn('Notification failed:', e?.message || e);
            return false;
        }
    },

    /**
     * New bell items (notifications.js): one status-bar notification when the app is not in
     * front. Never for this person's own changes (they are never sent to them either).
     */
    bell(fresh, uid) {
        if (!uid || uid !== this.uid || !this.prefs().on || this.foreground()) return false;
        const list = (fresh || []).filter(n => n && n.byUid !== uid && n.createdBy !== uid && this.wants(n));
        if (!list.length) return false;
        const d = describeNotification(list[0]);
        const name = APP_IDENTITY.appName || 'Bahi';
        const title = list.length > 1 ? t('ui.notify.bell_many', { app: name, count: list.length }) : name;
        const body = `${pickLang(d)}${d.who ? ` — ${d.who}` : ''}`;
        const route = list.length === 1 && d.target?.tab === 'day-cash' ? 'cash' : 'bell';
        this.show({ id: NOTIFY_IDS.bell, title, body, route, tag: 'happa-bell' })
            .catch(e => console.warn('Bell notification failed:', e?.message || e));
        return true;
    },

    /** A tap on a notification (or the browser's message about one): the page it is about. */
    route(r) {
        const page = ROUTES.has(r) ? r : null;
        if (!page) return;
        if (!this.uid || !window.app?.nav) {
            this.pendingRoute = page;
            return;
        }
        const app = window.app;
        if (page === 'bell') app.notifications?.open?.();
        else if (page === 'cash') app.nav.showTab('day-cash');
        else if (page === 'todo') {
            setDisclosureOpen(TODAY_REMINDERS_KEY, true);
            app.nav.showTab('day');
        } else if (page === 'udhaar') app.day?.openDues?.('retail');
        else if (page === 'rent') app.rentals?.open?.('rent');
        else if (page === 'backup') app.day?.openBackupCheck?.();
    },

    // ---------- Settings › Help & about › Notifications ----------

    async setOn(checked) {
        if (checked) {
            if (this.permission !== 'granted') await this.askNotifyPermission();
            if (this.permission !== 'granted') {
                this.save({ on: false });
                UIManager.showToast(t('msg.notify.denied'), 6000);
                this.renderSettings();
                return false;
            }
            this.save({ on: true });
            try { localStorage.removeItem(LEGACY_SYSTEM_KEY); } catch (_) { /* old switch */ }
            UIManager.showToast(t(this.platform() === 'native' ? 'msg.notify.on_app' : 'msg.notify.on_web'));
            this.listenTodos();
        } else {
            this.save({ on: false });
        }
        this.lastKey = null;
        this.renderSettings();
        this.reschedule();
        return true;
    },

    setType(type, checked) {
        if (!NOTIFY_TYPES.includes(type)) return;
        this.save({ [type]: !!checked });
        if (type === 'todo') this.listenTodos();
        this.renderSettings();
        this.reschedule();
    },

    /** A switch under "Updates from others": the bell's toast and badge and the phone, on this phone. */
    setUpdate(kind, checked) {
        if (!UPDATE_KINDS.includes(kind) || ALWAYS_ON_KINDS.includes(kind)) return;
        this.save({ [kind]: !!checked });
        this.renderSettings();
    },

    setTime(value) {
        if (!isTimeText(value)) return;
        this.save({ time: value });
        this.reschedule();
    },

    /** One now and, in the Android app, one 10 s later (close the app or lock the phone to try it). */
    async sendTest() {
        if (!this.platform()) {
            UIManager.showToast(t('msg.notify.unsupported'));
            return false;
        }
        if (this.permission !== 'granted') await this.askNotifyPermission();
        if (this.permission !== 'granted') {
            UIManager.showToast(t('msg.notify.denied'), 6000);
            this.renderSettings();
            return false;
        }
        const name = APP_IDENTITY.appName || 'Bahi';
        try {
            await this.show({ id: NOTIFY_IDS.testNow, title: name, body: t('ui.notify.test_body'), route: 'test', tag: 'happa-test' });
            if (this.plugin()) {
                await this.show({ id: NOTIFY_IDS.testLater, title: name, body: t('ui.notify.test_later_body'), route: 'test', channel: CHANNEL_REMINDERS, at: inMs(TEST_LATER_MS) });
            }
        } catch (e) {
            console.warn('Test notification failed:', e?.message || e);
            UIManager.showToast(t('msg.notify.test_failed'));
            return false;
        }
        UIManager.showToast(t(this.plugin() ? 'msg.notify.test_sent_app' : 'msg.notify.test_sent_web'), 6000);
        this.renderSettings();
        return true;
    },

    /** Fills the card from the choices on this phone (Settings opens, or something changed). */
    async renderSettings() {
        const card = typeof document !== 'undefined' ? document.getElementById('notifSettingsCard') : null;
        if (!card) return;
        const kind = this.platform();
        card.hidden = false;
        card.querySelectorAll('[data-notify-phone]').forEach(el => { el.hidden = !kind; });
        const u = this.prefs();
        UPDATE_KINDS.forEach(k => {
            const row = card.querySelector(`[data-notify-update="${k}"]`);
            if (row) row.hidden = !u.updatesAllowed[k];
            const box = row?.querySelector('input');
            if (box) box.checked = !!u.updates[k];
        });
        if (!kind) return;
        await this.readNotifyPermission();
        const p = this.prefs();
        const master = document.getElementById('settingPhoneNotifications');
        if (master) master.checked = p.on;
        NOTIFY_TYPES.forEach(type => {
            const row = card.querySelector(`[data-notify-type="${type}"]`);
            if (row) row.hidden = !p.allowed[type];
            const box = row?.querySelector('input');
            if (box) {
                box.checked = !!p.types[type];
                box.disabled = !p.on;
            }
        });
        const time = document.getElementById('notifSummaryTime');
        if (time) {
            time.value = p.time;
            time.disabled = !p.on;
            const row = time.closest('[data-notify-time]');
            if (row) row.hidden = !(p.allowed.udhaar || p.allowed.rent || p.allowed.backup);
        }
        const perm = document.getElementById('notifPermNote');
        if (perm) {
            perm.hidden = this.permission !== 'denied';
            perm.textContent = t(kind === 'native' ? 'ui.notify.denied_app' : 'ui.notify.denied_web');
        }
        const note = document.getElementById('notifPlatformNote');
        if (note) note.textContent = t(kind === 'native' ? 'ui.notify.note_app' : 'ui.notify.note_web');
    }
};
