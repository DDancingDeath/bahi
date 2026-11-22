// @ts-check
/**
 * @fileoverview Push while the app is closed (docs/notifications.md, stage 2): this phone's device
 * doc `users/{uid}/devices/{id}` (its FCM token, master switch, per-kind switches, language) and when
 * to write it again. Pure: no DOM, no Firestore, no plugin. modules/push-notify.js does the I/O.
 * @module utils/push-device
 */

/** What this phone last wrote: {uid, id, sig, at}. */
export const PUSH_DEVICE_KEY = 'happa.pushDevice';
/** A device doc is written again after this long, so it never looks abandoned. */
export const PUSH_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const ID_CHARS = 40;

/**
 * The doc id of a token: hex SHA-256, so the token itself is never a path.
 * @param {string} token
 * @param {{digest: function(string, BufferSource): Promise<ArrayBuffer>}} [subtle]
 * @returns {Promise<string>}
 */
export async function pushDeviceId(token, subtle = globalThis.crypto?.subtle) {
    if (!subtle) throw new Error('crypto.subtle missing');
    const hash = await subtle.digest('SHA-256', new TextEncoder().encode(String(token)));
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, ID_CHARS);
}

/**
 * The device doc (without `updatedAt`, which is the server's time). `kinds` copies every switch of
 * `happa.notify` (reminder types and update kinds), so the sender sends only what this person has on.
 * @param {{token: string, platform: 'android'|'web', prefs: {on: boolean, types: Object<string, boolean>, updates?: Object<string, boolean>}, lang: string}} p
 * @returns {{token: string, platform: string, on: boolean, kinds: Object<string, boolean>, lang: string}}
 */
export function pushDeviceDoc({ token, platform, prefs, lang }) {
    /** @type {Object<string, boolean>} */
    const kinds = {};
    const all = { ...(prefs?.types || {}), ...(prefs?.updates || {}) };
    Object.keys(all).sort().forEach(k => { kinds[k] = !!all[k]; });
    return { token: String(token), platform, on: !!prefs?.on, kinds, lang: lang === 'hi' ? 'hi' : 'en' };
}

/**
 * @param {string} uid
 * @param {string} id
 * @param {Rec} doc
 * @returns {string}
 */
export const pushDeviceSig = (uid, id, doc) => JSON.stringify([uid, id, doc.platform, doc.on, doc.kinds, doc.lang]);

/**
 * Write the doc now? Yes for another person, token or choice, or when the last write is old.
 * @param {?{uid?: string, sig?: string, at?: number}} saved
 * @param {string} sig
 * @param {number} nowMs
 * @returns {boolean}
 */
export function pushDeviceStale(saved, sig, nowMs) {
    if (!saved || saved.sig !== sig) return true;
    const at = Number(saved.at) || 0;
    return nowMs - at > PUSH_REFRESH_MS || at > nowMs;
}

/**
 * @param {Storage|null|undefined} store
 * @returns {?{uid: string, id: string, sig: string, at: number}}
 */
export function readPushDevice(store) {
    try {
        const v = JSON.parse(store?.getItem(PUSH_DEVICE_KEY) || 'null');
        return v && typeof v === 'object' && typeof v.uid === 'string' && typeof v.id === 'string' ? v : null;
    } catch (_) {
        return null;
    }
}
