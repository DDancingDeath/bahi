/**
 * @fileoverview Lock a shared phone when it is not used (U-55): the owner or a manager turns it
 * on in Settings with a PIN; after N minutes without a tap (or with the app in the background)
 * the app is covered until the PIN is typed. The PIN is kept on this phone only, as a salted
 * SHA-256 hash, per person; forgetting it means logging out and in again.
 * @module ui/app-lock
 */

import { UIManager } from './ui-manager.js';
import { Helpers } from '../utils/helpers.js';
import { AppState } from '../utils/state.js';
import { safeSetItem } from '../utils/storage-full.js';
import { t } from '../i18n/index.js';
import { APP_LOCK_KEY, APP_LOCK_ASKED_KEY } from '../utils/first-run.js';
import { emit, REMINDERS_CHANGED } from '../utils/events.js';

export const LOCK_MINUTES = Object.freeze([2, 5, 10, 30]);
const PIN_RE = /^\d{4,6}$/;
const CHECK_EVERY_MS = 30 * 1000;
const WAIT_AFTER_TRIES = 5;
const TRIES_WAIT_MS = 30 * 1000;

/** Roles that may lock the phone (money pages). */
export const canUseAppLock = (role) => role === 'owner' || role === 'manager';

/** @param {string} pin */
export const validLockPin = (pin) => PIN_RE.test(String(pin ?? ''));

/**
 * @param {number} lastActive - ms
 * @param {number} now - ms
 * @param {number} minutes
 */
export const shouldLock = (lastActive, now, minutes) => minutes > 0 && now - lastActive >= minutes * 60 * 1000;

/**
 * Hex SHA-256 of salt + PIN.
 * @param {string} pin
 * @param {string} salt
 * @returns {Promise<string>}
 */
export async function hashPin(pin, salt) {
    const data = new TextEncoder().encode(`${salt}:${pin}`);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const randomSalt = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');

/**
 * @param {string} uid
 * @param {?Storage} [store]
 * @returns {?{on: boolean, minutes: number, salt: string, hash: string}}
 */
export function readLock(uid, store = typeof localStorage !== 'undefined' ? localStorage : null) {
    try {
        const v = JSON.parse(store?.getItem(`${APP_LOCK_KEY}.${uid}`) || 'null');
        return v && v.on && LOCK_MINUTES.includes(v.minutes) && v.salt && v.hash ? v : null;
    } catch (_) {
        return null;
    }
}

export const AppLock = {
    uid: null,
    lastActive: Date.now(),
    timer: null,
    locked: false,
    tries: 0,
    waitUntil: 0,
    bound: false,

    /** After sign-in: watches for idle time when this person turned the lock on. */
    start(uid) {
        this.stop();
        this.uid = uid;
        this.lastActive = Date.now();
        if (!uid || !canUseAppLock(AppState.userRole) || !readLock(uid)) return;
        if (!this.bound) {
            this.bound = true;
            const touch = () => { if (!this.locked) this.lastActive = Date.now(); };
            ['pointerdown', 'keydown'].forEach(type => document.addEventListener(type, touch, { passive: true, capture: true }));
            document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.check(); });
        }
        this.timer = setInterval(() => this.check(), CHECK_EVERY_MS);
    },

    /** Sign-out: nothing to guard, the lock screen goes. */
    stop() {
        clearInterval(this.timer);
        this.timer = null;
        this.uid = null;
        this.locked = false;
        document.getElementById('appLockScreen')?.remove();
    },

    check(now = Date.now()) {
        const cfg = this.uid ? readLock(this.uid) : null;
        if (!cfg || this.locked) return false;
        if (!shouldLock(this.lastActive, now, cfg.minutes)) return false;
        this.lock();
        return true;
    },

    lock() {
        this.locked = true;
        if (document.getElementById('appLockScreen')) return;
        const e = Helpers.escapeHtml;
        const box = document.createElement('div');
        box.id = 'appLockScreen';
        box.className = 'app-lock';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.setAttribute('aria-labelledby', 'appLockTitle');
        box.innerHTML = `
            <div class="app-lock-box">
                <h2 id="appLockTitle">${e(t('ui.applock.locked_title'))}</h2>
                <p>${e(t('ui.applock.locked_hint', { name: AppState.userName || '' }))}</p>
                <div class="field">
                    <label for="appLockPin">${e(t('ui.applock.pin'))}</label>
                    <input class="input" type="password" id="appLockPin" inputmode="numeric" maxlength="6" autocomplete="off" data-onenter="appLock.unlock()">
                </div>
                <p class="notice neg" id="appLockMessage" role="alert" hidden></p>
                <button type="button" class="btn btn-primary btn-block" data-onclick="appLock.unlock()">${e(t('ui.applock.unlock'))}</button>
                <button type="button" class="btn btn-ghost btn-block" data-onclick="auth.logout()">${e(t('ui.applock.forgot'))}</button>
            </div>`;
        document.body.appendChild(box);
        /** @type {?HTMLInputElement} */ (document.getElementById('appLockPin'))?.focus();
    },

    /** The PIN typed on the lock screen. */
    async unlock() {
        const input = /** @type {?HTMLInputElement} */ (document.getElementById('appLockPin'));
        const msg = document.getElementById('appLockMessage');
        const cfg = this.uid ? readLock(this.uid) : null;
        const say = (key, params) => { if (msg) { msg.hidden = false; msg.textContent = t(key, params); } };
        if (!cfg) {
            this.unlocked();
            return true;
        }
        const now = Date.now();
        if (now < this.waitUntil) {
            say('msg.applock.wait', { seconds: Math.ceil((this.waitUntil - now) / 1000) });
            return false;
        }
        const ok = (await hashPin(input?.value || '', cfg.salt)) === cfg.hash;
        if (input) input.value = '';
        if (ok) {
            this.unlocked();
            return true;
        }
        this.tries += 1;
        if (this.tries >= WAIT_AFTER_TRIES) {
            this.tries = 0;
            this.waitUntil = now + TRIES_WAIT_MS;
        }
        say('msg.applock.wrong_pin');
        input?.focus();
        return false;
    },

    unlocked() {
        this.locked = false;
        this.tries = 0;
        this.lastActive = Date.now();
        document.getElementById('appLockScreen')?.remove();
    },

    /** Settings: the phone lock row for the owner and managers. */
    renderSettings() {
        const card = document.getElementById('appLockCard');
        if (!card) return;
        const uid = AppState.currentUser?.uid;
        const allowed = !!uid && canUseAppLock(AppState.userRole);
        card.hidden = !allowed;
        if (!allowed) return;
        const cfg = readLock(uid);
        const state = document.getElementById('appLockState');
        if (state) state.textContent = cfg ? t('ui.applock.on_after', { minutes: cfg.minutes }) : t('ui.applock.off');
        const setUp = document.getElementById('appLockSetup');
        if (setUp) setUp.textContent = t(cfg ? 'ui.applock.change' : 'ui.applock.set_up');
        const off = document.getElementById('appLockOff');
        if (off) off.hidden = !cfg;
    },

    /** Turn on (or change): a PIN typed twice and the idle minutes. */
    async setup() {
        const uid = AppState.currentUser?.uid;
        if (!uid || !canUseAppLock(AppState.userRole)) return false;
        const e = Helpers.escapeHtml;
        const current = readLock(uid);
        const options = LOCK_MINUTES.map(m => `<option value="${m}"${(current?.minutes || 5) === m ? ' selected' : ''}>${e(t('ui.applock.minutes', { minutes: m }))}</option>`).join('');
        const choice = await UIManager.showCustomModal(`
            <h3 class="dialog-title">${e(t('ui.applock.title'))}</h3>
            <p>${e(t('ui.applock.setup_hint'))}</p>
            <div class="field"><label for="appLockNewPin">${e(t('ui.applock.new_pin'))}</label>
                <input class="input" type="password" id="appLockNewPin" inputmode="numeric" maxlength="6" autocomplete="off"></div>
            <div class="field"><label for="appLockNewPin2">${e(t('ui.applock.repeat_pin'))}</label>
                <input class="input" type="password" id="appLockNewPin2" inputmode="numeric" maxlength="6" autocomplete="off"></div>
            <div class="field"><label for="appLockMinutes">${e(t('ui.applock.after'))}</label>
                <select class="input" id="appLockMinutes">${options}</select></div>`,
        [{ text: t('ui.modals.cancel'), value: null, class: 'btn btn-ghost' }, { text: t('ui.common.save'), value: 'save', class: 'btn btn-primary' }]);
        if (choice !== 'save') return false;
        const pin = /** @type {?HTMLInputElement} */ (document.getElementById('appLockNewPin'))?.value || '';
        const again = /** @type {?HTMLInputElement} */ (document.getElementById('appLockNewPin2'))?.value || '';
        const minutes = Number(/** @type {?HTMLSelectElement} */ (document.getElementById('appLockMinutes'))?.value);
        if (!validLockPin(pin)) { UIManager.showToast(t('msg.applock.bad_pin'), 'warning'); return false; }
        if (pin !== again) { UIManager.showToast(t('msg.applock.pins_differ'), 'warning'); return false; }
        const salt = randomSalt();
        const saved = safeSetItem(`${APP_LOCK_KEY}.${uid}`, JSON.stringify({ on: true, minutes: LOCK_MINUTES.includes(minutes) ? minutes : 5, salt, hash: await hashPin(pin, salt) }));
        if (!saved.ok) { UIManager.showToast(t('msg.sync.storage_full'), 'error'); return false; }
        UIManager.showToast(t('msg.applock.on'));
        this.start(uid);
        this.renderSettings();
        emit(REMINDERS_CHANGED);
        return true;
    },

    /** Turn off, after the PIN. */
    async turnOff() {
        const uid = AppState.currentUser?.uid;
        const cfg = uid ? readLock(uid) : null;
        if (!cfg) return true;
        const e = Helpers.escapeHtml;
        const choice = await UIManager.showCustomModal(`
            <h3 class="dialog-title">${e(t('ui.applock.turn_off'))}</h3>
            <div class="field"><label for="appLockOffPin">${e(t('ui.applock.pin'))}</label>
                <input class="input" type="password" id="appLockOffPin" inputmode="numeric" maxlength="6" autocomplete="off"></div>`,
        [{ text: t('ui.modals.cancel'), value: null, class: 'btn btn-ghost' }, { text: t('ui.applock.turn_off'), value: 'off', class: 'btn btn-primary' }]);
        if (choice !== 'off') return false;
        const pin = /** @type {?HTMLInputElement} */ (document.getElementById('appLockOffPin'))?.value || '';
        if ((await hashPin(pin, cfg.salt)) !== cfg.hash) { UIManager.showToast(t('msg.applock.wrong_pin'), 'warning'); return false; }
        try { localStorage.removeItem(`${APP_LOCK_KEY}.${uid}`); } catch (_) { /* nothing stored */ }
        this.stop();
        this.uid = uid;
        UIManager.showToast(t('msg.applock.off'));
        this.renderSettings();
        return true;
    },

    /** "No, thanks" on Today's offer (U-55): not offered again on this phone. */
    dismissOffer() {
        const uid = AppState.currentUser?.uid;
        if (uid) safeSetItem(`${APP_LOCK_ASKED_KEY}.${uid}`, '1');
        emit(REMINDERS_CHANGED);
    }
};
