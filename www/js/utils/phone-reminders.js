// @ts-check
/**
 * @fileoverview Phone notifications (docs/notifications.md): the choices kept on this
 * phone, who may get which kind, and the reminders to schedule at a time. Pure: no DOM,
 * no Firestore, no plugin. modules/phone-notify.js shows and schedules them.
 * @module utils/phone-reminders
 */

import { buildAging } from './aging.js';
import { formatRupees, round2 } from './money.js';
import { parseLocalDate, toLocalISODate, addLocalDays } from './dates.js';
import { reminderAt, REMINDER_TIME_RE, REMINDER_LISTEN_LIMIT } from './manual-reminders.js';
import { t, tn } from '../i18n/index.js';
import { UPDATE_KINDS, ALWAYS_ON_KINDS, updateKindsFor } from './notification-format.js';

export const NOTIFY_PREFS_KEY = 'happa.notify';
/** The old "Desktop notifications" switch ('1' = on). */
export const LEGACY_SYSTEM_KEY = 'aadhat.notifications.system';
/** Reminder kinds (updates from others are notification-format.js UPDATE_KINDS). */
export const NOTIFY_TYPES = Object.freeze(['todo', 'udhaar', 'rent', 'backup']);
export const DEFAULT_SUMMARY_TIME = '09:30';
/** A backup is checked every this many days (REM-3). */
export const BACKUP_EVERY_DAYS = 30;

/**
 * Notification ids. Bell and tests replace their own last one; reminders live in
 * [REMINDER_FIRST, REMINDER_LAST] and are cancelled and made again as one set.
 */
export const NOTIFY_IDS = Object.freeze({
    bell: 1001, testNow: 2901, testLater: 2902,
    udhaar: 2001, rent: 2010, backup: 2020, todo: 2100
});
export const REMINDER_FIRST = 2000;
export const REMINDER_LAST = 2899;
const RENT_MAX = 5;
/**
 * A time of day as the time field gives it ('HH:MM', 24 h).
 * @param {*} v
 * @returns {boolean}
 */
export const isTimeText = (v) => REMINDER_TIME_RE.test(String(v || ''));

/** The browser can only remind while the app is open: timers for the next day at most. */
const WEB_AHEAD_MS = 24 * 60 * 60 * 1000;

/**
 * Browser timers: the reminders of the next day, with the wait before each.
 * @template {{at: Date}} T
 * @param {Array<T>} plan
 * @param {number} nowMs
 * @returns {Array<{item: T, wait: number}>}
 */
export function webTimers(plan, nowMs) {
    return (plan || []).map(item => ({ item, wait: Math.max(0, item.at.getTime() - nowMs) }))
        .filter(x => x.wait <= WEB_AHEAD_MS);
}

/**
 * The moment `ms` after `nowMs`.
 * @param {number} ms
 * @param {number} [nowMs]
 * @returns {Date}
 */
export const inMs = (ms, nowMs = Date.now()) => new Date(nowMs + ms);

/**
 * Kinds this person can get (the same people who see them in the app).
 * @param {{role?: ?string, rentals?: boolean}} who
 * @returns {Object<string, boolean>}
 */
export function allowedTypes({ role, rentals = false }) {
    const manager = role === 'owner' || role === 'manager';
    return { todo: true, udhaar: manager, rent: !!rentals, backup: role === 'owner' };
}

/**
 * The choices on this phone with their defaults. `on` is the master switch; it needs the phone's
 * permission (never asked at start). Unset, it follows `defaultOn` (the Android app: on; the
 * browser: the old Desktop notifications switch).
 * @param {?Rec} stored
 * @param {{role?: ?string, rentals?: boolean, granted?: boolean, defaultOn?: boolean}} who
 * `updates` (per update kind; a role change is always on) also decide the bell's toast and badge,
 * so they do not depend on `on`.
 * @returns {{on: boolean, chosen: boolean, time: string, types: Object<string, boolean>, allowed: Object<string, boolean>,
 *   updates: Object<string, boolean>, updatesAllowed: Object<string, boolean>}}
 */
export function notifyPrefs(stored, { role, rentals = false, granted = false, defaultOn = false }) {
    const s = stored && typeof stored === 'object' ? stored : {};
    const allowed = allowedTypes({ role, rentals });
    const chosen = typeof s.on === 'boolean';
    const on = granted && (chosen ? s.on : defaultOn);
    /** @type {Object<string, boolean>} */
    const types = {};
    NOTIFY_TYPES.forEach(k => { types[k] = allowed[k] && (typeof s[k] === 'boolean' ? s[k] : true); });
    const time = REMINDER_TIME_RE.test(String(s.time || '')) ? String(s.time) : DEFAULT_SUMMARY_TIME;
    const updatesAllowed = updateKindsFor(role);
    /** @type {Object<string, boolean>} */
    const updates = {};
    UPDATE_KINDS.forEach(k => { updates[k] = updatesAllowed[k] && (ALWAYS_ON_KINDS.includes(k) || s[k] !== false); });
    return { on, chosen, time, types, allowed, updates, updatesAllowed };
}

/**
 * The first moment at `time` on `fromIso` or later that is after `now`.
 * @param {Date} now
 * @param {string} time 'HH:MM'
 * @param {string} [fromIso] earliest day (default today)
 * @returns {?Date}
 */
export function nextAt(now, time, fromIso = toLocalISODate(now)) {
    let day = fromIso < toLocalISODate(now) ? toLocalISODate(now) : fromIso;
    for (let i = 0; i < 2; i++) {
        const at = reminderAt(day, time);
        if (at && at.getTime() > now.getTime()) return at;
        day = toLocalISODate(/** @type {Date} */ (addLocalDays(parseLocalDate(day), 1)));
    }
    return null;
}

/**
 * Udhaar to collect: every open receivable (retail and, for those who see it, wholesale)
 * and how many customers have an overdue bill (REM-1's 30 days).
 * @param {Array<Array<Rec>>} lists open bills per kind
 * @param {Date} today
 * @returns {{total: number, overdue: number}}
 */
export function udhaarSummary(lists, today) {
    let total = 0;
    let overdue = 0;
    (lists || []).forEach(bills => {
        const a = buildAging(bills || [], { today });
        total += a.total;
        overdue += a.parties.filter(p => p.overdue > 0).length;
    });
    return { total: round2(total), overdue };
}

/**
 * The reminders to schedule, soonest first: To do at their date and time (9:00 am without
 * one), the Udhaar summary and a due backup check at the summary time, and rent on each due
 * day still to come this month. Only moments after `now`.
 * @param {{
 *   prefs: ReturnType<typeof notifyPrefs>, now: Date,
 *   todos?: Array<Rec>, udhaar?: ?{total: number, overdue: number},
 *   rent?: ?{due: number, dueUnits?: number, dueDays?: Array<number>},
 *   backup?: ?{due: boolean, lastAt: ?number}
 * }} input
 * @returns {Array<{id: number, kind: string, at: Date, title: string, body: string, route: string}>}
 */
export function planReminders({ prefs, now, todos = [], udhaar = null, rent = null, backup = null }) {
    if (!prefs?.on) return [];
    const out = [];
    const time = prefs.time;
    if (prefs.types.todo) {
        const list = (todos || [])
            .filter(r => r && r.status !== 'done' && r.status !== 'cancelled')
            .map(r => ({ r, at: reminderAt(r.dueDate, r.dueTime) }))
            .filter(x => x.at && x.at.getTime() > now.getTime())
            .sort((a, b) => /** @type {Date} */ (a.at).getTime() - /** @type {Date} */ (b.at).getTime())
            .slice(0, REMINDER_LISTEN_LIMIT);
        list.forEach(({ r, at }, i) => out.push({
            id: NOTIFY_IDS.todo + i, kind: 'todo', at: /** @type {Date} */ (at), route: 'todo',
            title: t('ui.notify.todo_title'),
            body: [String(r.title || ''), String(r.party || '')].filter(Boolean).join(' · ')
        }));
    }
    if (prefs.types.udhaar && udhaar && udhaar.total > 0) {
        const at = nextAt(now, time);
        if (at) {
            out.push({
                id: NOTIFY_IDS.udhaar, kind: 'udhaar', at, route: 'udhaar',
                title: t('ui.notify.udhaar_title'),
                body: udhaar.overdue > 0
                    ? t('ui.notify.udhaar_body_overdue', { amount: formatRupees(udhaar.total), count: udhaar.overdue })
                    : t('ui.notify.udhaar_body', { amount: formatRupees(udhaar.total) })
            });
        }
    }
    if (prefs.types.rent && rent && rent.due > 0) {
        const month = toLocalISODate(now).slice(0, 7);
        (rent.dueDays || []).map(d => nextOn(now, time, `${month}-${String(d).padStart(2, '0')}`))
            .filter(/** @returns {at is Date} */ (at) => !!at)
            .slice(0, RENT_MAX)
            .forEach((at, i) => out.push({
                id: NOTIFY_IDS.rent + i, kind: 'rent', at, route: 'rent',
                title: t('ui.notify.rent_title'),
                body: tn('ui.notify.rent_body', Number(rent.dueUnits) || 0, { amount: formatRupees(rent.due) })
            }));
    }
    if (prefs.types.backup && backup) {
        const from = backup.due || backup.lastAt === null
            ? toLocalISODate(now)
            : toLocalISODate(/** @type {Date} */ (addLocalDays(new Date(backup.lastAt), BACKUP_EVERY_DAYS)));
        const at = nextAt(now, time, from);
        if (at) {
            out.push({
                id: NOTIFY_IDS.backup, kind: 'backup', at, route: 'backup',
                title: t('ui.notify.backup_title'), body: t('ui.notify.backup_body')
            });
        }
    }
    return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * `time` on exactly that day, when it is still to come.
 * @param {Date} now @param {string} time @param {string} iso
 * @returns {?Date}
 */
function nextOn(now, time, iso) {
    const at = reminderAt(iso, time);
    return at && at.getTime() > now.getTime() ? at : null;
}

/**
 * Same plan, same text: nothing to cancel and make again.
 * @param {Array<{id: number, at: Date, title: string, body: string, route: string}>} plan
 * @returns {string}
 */
export function planKey(plan) {
    return JSON.stringify(plan.map(p => [p.id, p.at.getTime(), p.title, p.body, p.route]));
}

/**
 * Notification ids of ours among the phone's pending ones (scheduled reminders only).
 * @param {Array<{id: (number|string)}>} pending
 * @returns {Array<number>}
 */
export function ownReminderIds(pending) {
    return (pending || []).map(p => Number(p?.id)).filter(id => Number.isInteger(id) && id >= REMINDER_FIRST && id <= REMINDER_LAST);
}
