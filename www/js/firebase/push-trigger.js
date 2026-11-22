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
