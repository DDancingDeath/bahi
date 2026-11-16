// @ts-check
/**
 * @fileoverview One plain, translated sentence for a failed call (U-51): Firestore,
 * Auth and network errors become a next step ("Check the internet and try again",
 * "Ask the owner for access") instead of the server's English text. The raw text
 * stays in the console.error the caller logs, which Diagnostics records.
 * @module utils/friendly-error
 */

import { t } from '../i18n/index.js';
import { isStorageFullError, STORAGE_FULL_KEY } from './storage-full.js';
import { isQuotaExhaustedError } from './quota-guard.js';
import { NEEDS_INTERNET, CHANGED_ELSEWHERE } from './write-conflict.js';

const NETWORK_TEXT = /network|offline|failed to fetch|could not reach|unavailable|timed? ?out|deadline/i;
const DENIED_TEXT = /permission|insufficient|denied/i;

/** Firestore / Auth error code (without the "auth/" or "firestore/" prefix) → message key. */
/** @type {Record<string, string>} */
const CODE_KEYS = {
    'permission-denied': 'msg.error.no_access',
    unauthenticated: 'msg.error.signed_out',
    'user-token-expired': 'msg.error.signed_out',
    'requires-recent-login': 'msg.error.signed_out',
    unavailable: 'msg.error.no_internet',
    'deadline-exceeded': 'msg.error.no_internet',
    'network-request-failed': 'msg.error.no_internet',
    [NEEDS_INTERNET]: 'msg.sync.needs_internet_write',
    [CHANGED_ELSEWHERE]: 'msg.sync.changed_elsewhere',
    'resource-exhausted': 'msg.error.limit_reached',
    'too-many-requests': 'msg.error.limit_reached',
    'not-found': 'msg.error.not_found',
    'already-exists': 'msg.error.already_saved',
    'already-saved': 'msg.error.already_saved',
    'failed-precondition': 'msg.error.refresh_app',
    aborted: 'msg.error.try_again',
    cancelled: 'msg.error.try_again'
};

/**
 * The message key for an error (msg.error.* or an existing msg.sync.* key).
 * @param {*} err
 * @returns {string}
 */
export function friendlyErrorKey(err) {
    if (isStorageFullError(err)) return STORAGE_FULL_KEY;
    if (isQuotaExhaustedError(err)) return 'msg.error.limit_reached';
    const code = String((err && typeof err === 'object' && err.code) || '').replace(/^(auth|firestore|storage|functions)\//, '');
    if (CODE_KEYS[code]) return CODE_KEYS[code];
    const text = String((err && typeof err === 'object' ? err.message : err) || '');
    if (DENIED_TEXT.test(text)) return 'msg.error.no_access';
    if (NETWORK_TEXT.test(text) || (typeof navigator !== 'undefined' && navigator.onLine === false)) return 'msg.error.no_internet';
    return 'msg.error.try_again';
}

/**
 * A short, translated sentence for an error, in the app language (or `lang`).
 * @param {*} err
 * @param {'en'|'hi'} [lang]
 * @returns {string}
 */
export function friendlyError(err, lang) {
    return t(friendlyErrorKey(err), null, lang);
}
