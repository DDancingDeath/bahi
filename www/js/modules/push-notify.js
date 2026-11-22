/**
 * @fileoverview Push while the app is closed (docs/notifications.md, stage 2). Registers this phone
 * with FCM (Android: @capacitor-firebase/messaging; browser: the Firebase messaging SDK with the
 * project's VAPID key and our service worker) and keeps its device doc in step with the switches in
 * Settings › Notifications. Only when a sender is configured (APP_IDENTITY.push.url).
 * @module modules/push-notify
 */

import { APP_IDENTITY } from '../config/app-identity.js';
import { safeSetItem } from '../utils/storage-full.js';
import { savePushDevice, deletePushDevice } from '../firebase/repos/push-devices.js';
import { getWebPushToken, deleteWebPushToken } from '../firebase/web-push.js';
import {
    PUSH_DEVICE_KEY, pushDeviceId, pushDeviceDoc, pushDeviceSig, pushDeviceStale, readPushDevice
} from '../utils/push-device.js';

const FORGET_WAIT_MS = 3000;

const capacitor = () => (typeof window !== 'undefined' ? window.Capacitor : null);
const isNative = () => !!capacitor()?.isNativePlatform?.();
const store = () => { try { return localStorage; } catch (_) { return null; } };

export const PushNotify = {
    bound: false,
    token: null,
    chain: Promise.resolve(),

    /** The native plugin, or null. */
    plugin() {
        return isNative() ? capacitor()?.Plugins?.FirebaseMessaging || null : null;
    },

    /** 'android' | 'web' | null: whether this phone can get pushes from the configured sender. */
    kind(identity = APP_IDENTITY) {
        if (!identity?.push?.url || (typeof window !== 'undefined' && window.COLLECTION_PREFIX)) return null;
        if (isNative()) return this.plugin() ? 'android' : null;
        if (!identity.push.vapidKey || typeof navigator === 'undefined' || !navigator.serviceWorker || typeof window === 'undefined' || !('PushManager' in window)) return null;
        return 'web';
    },

    /** Taps on a pushed notification (Android; the browser's go through the service worker). Once per page. */
    init(route) {
        if (this.bound) return;
        this.bound = true;
        const native = this.plugin();
        if (!native || !this.kind()) return;
        try {
            native.addListener('notificationActionPerformed', (ev) => route(ev?.notification?.data?.route || 'bell'));
            native.addListener('tokenReceived', (ev) => {
                if (ev?.token && ev.token !== this.token) {
                    this.token = ev.token;
                    this.onToken?.();
                }
            });
        } catch (e) {
            console.warn('Push listeners failed:', e?.message || e);
        }
    },

    /** This phone's FCM token (null when it can't have one). */
    async getToken() {
        const kind = this.kind();
        if (kind === 'android') {
            const r = await this.plugin().getToken();
            return r?.token || null;
        }
        return kind === 'web' ? getWebPushToken(APP_IDENTITY.push.vapidKey) : null;
    },

    /** Pushes stand in for the local bell notification on this phone (Android; the browser merges by tag). */
    handlesBell(uid) {
        const saved = readPushDevice(store());
        return this.kind() === 'android' && !!saved && saved.uid === uid && !!saved.on;
    },

    /**
     * Writes this phone's device doc when something changed (or once a week). Phone notifications
     * off: the doc goes, so nothing is pushed here. Never rejects.
     * @param {string} uid
     * @param {{on: boolean, types: Object<string, boolean>}} prefs
     * @param {string} lang
     */
    sync(uid, prefs, lang) {
        this.chain = this.chain.then(() => this.syncNow(uid, prefs, lang)).catch(e => {
            console.warn('Push registration failed:', e?.message || e);
        });
        return this.chain;
    },

    async syncNow(uid, prefs, lang) {
        const kind = this.kind();
        if (!uid || !kind) return;
        const saved = readPushDevice(store());
        if (saved && saved.uid !== uid) await this.forgetNow();
        if (!prefs?.on) {
            if (readPushDevice(store())) await this.forgetNow({ keepToken: true });
            return;
        }
        if (!this.token) this.token = await this.getToken();
        if (!this.token) return;
        const id = await pushDeviceId(this.token);
        const doc = pushDeviceDoc({ token: this.token, platform: kind, prefs, lang });
        const sig = pushDeviceSig(uid, id, doc);
        const now = Date.now();
        const last = readPushDevice(store());
        if (!pushDeviceStale(last, sig, now)) return;
        if (last && last.id !== id) await deletePushDevice(last.uid, last.id).catch(() => {});
        await savePushDevice(uid, id, doc);
        safeSetItem(PUSH_DEVICE_KEY, JSON.stringify({ uid, id, sig, at: now, on: true }));
    },

    /** Before sign-out (still signed in): this phone gets nothing more for this person. */
    forget() {
        const done = this.chain.then(() => this.forgetNow()).catch(e => console.warn('Push device not removed:', e?.message || e));
        return Promise.race([done, new Promise(resolve => setTimeout(resolve, FORGET_WAIT_MS))]);
    },

    async forgetNow({ keepToken = false } = {}) {
        const saved = readPushDevice(store());
        try { store()?.removeItem(PUSH_DEVICE_KEY); } catch (_) { /* nothing kept */ }
        if (saved) await deletePushDevice(saved.uid, saved.id).catch(e => console.warn('Push device not removed:', e?.message || e));
        if (keepToken || (!saved && !this.token)) return;
        this.token = null;
        try {
            if (this.plugin()) await this.plugin().deleteToken();
            else await deleteWebPushToken();
        } catch (e) {
            console.warn('Push token not deleted:', e?.message || e);
        }
    }
};
