/**
 * @fileoverview Browser push token (docs/notifications.md, stage 2): the Firebase messaging SDK,
 * loaded only when the project has a VAPID key, subscribes our own service worker.
 * @module firebase/web-push
 */

import { loadScriptOnce } from '../utils/lazy-scripts.js';

export const MESSAGING_SDK_URL = '/vendor/firebase/10.7.1/firebase-messaging-compat.js';
export const MESSAGING_SDK_INTEGRITY = 'sha384-MiR5OstmujbPpU5nzD986OTopb4Kveb2WX4EmKuqeCU1hCWlxMYL8gBBY7vDSYLF';

/**
 * @param {string} vapidKey
 * @returns {Promise<?string>}
 */
export async function getWebPushToken(vapidKey) {
    await loadScriptOnce(MESSAGING_SDK_URL, undefined, MESSAGING_SDK_INTEGRITY);
    if (!firebase.messaging || !(await firebase.messaging.isSupported())) return null;
    const registration = await navigator.serviceWorker.ready;
    return (await firebase.messaging().getToken({ vapidKey, serviceWorkerRegistration: registration })) || null;
}

/** Drops this browser's token (sign-out), when the SDK was loaded. */
export async function deleteWebPushToken() {
    if (typeof firebase !== 'undefined' && firebase.messaging) await firebase.messaging().deleteToken();
}
