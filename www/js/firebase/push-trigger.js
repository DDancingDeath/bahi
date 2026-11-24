/**
 * @fileoverview Tells the push sender (docs/notifications.md, stage 2: a Google Apps Script web app)
 * that an event's notification docs are written, so it pushes them at once. Fire and forget: the
 * user's action never waits for it, and with no sender configured it does nothing. Docs it never
 * hears about are sent by the sender's own sweep a few minutes later.
 * @module firebase/push-trigger
 */

import { APP_IDENTITY } from '../config/app-identity.js';
import { col } from './db.js';

/**
 * @param {string} eventId
 * @param {{fetchFn?: typeof fetch, identity?: Rec}} [opts]
 * @returns {boolean} whether a call was made
 */
export function triggerPush(eventId, { fetchFn = globalThis.fetch, identity = APP_IDENTITY } = {}) {
    const url = identity?.push?.url;
    if (!url || !eventId || typeof fetchFn !== 'function' || col('notifications') !== 'notifications') return false;
    try {
        fetchFn(url, {
            method: 'POST',
            mode: 'no-cors',
            keepalive: true,
            body: JSON.stringify({ eventId, project: identity.projectId })
        }).catch(e => console.warn('Push trigger failed:', e?.message || e));
    } catch (e) {
        console.warn('Push trigger failed:', e?.message || e);
        return false;
    }
    return true;
}

/**
 * The same call, waiting for the sender's answer (the test panel): `{ok, docs, targets, sent, ...}`, or
 * null when there is no sender or the answer can't be read. `delay`: seconds the sender waits first (≤ 60).
 * @param {string} eventId
 * @param {{delay?: number, fetchFn?: typeof fetch, identity?: Rec}} [opts]
 * @returns {Promise<?Rec>}
 */
export async function requestPush(eventId, { delay = 0, fetchFn = globalThis.fetch, identity = APP_IDENTITY } = {}) {
    const url = identity?.push?.url;
    if (!url || !eventId || typeof fetchFn !== 'function' || col('notifications') !== 'notifications') return null;
    try {
        const res = await fetchFn(url, {
            method: 'POST',
            body: JSON.stringify({ eventId, project: identity.projectId, ...(delay ? { delay } : {}) })
        });
        const out = await res.json();
        return out && typeof out === 'object' ? out : null;
    } catch (e) {
        console.warn('Push test call failed:', e?.message || e);
        return null;
    }
}
