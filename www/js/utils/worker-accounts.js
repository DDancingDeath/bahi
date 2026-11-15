// @ts-check
/**
 * @fileoverview Worker accounts without email (U-56): the owner makes a sign-in for a worker in
 * Settings › Team with a username and a PIN. Firebase Auth needs an email, so the account's email
 * is made from the username under a reserved `.invalid` domain (RFC 2606): no mail can ever reach
 * it, so a "forgot password" link for it goes nowhere. The login card takes the username or an email.
 * @module utils/worker-accounts
 */

/** Usernames: 3–30 small letters, numbers, dot, dash or underscore, starting with a letter or number. */
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
/** Firebase passwords are at least 6 characters: the PIN is 6 to 8 numbers. */
export const PIN_RE = /^\d{6,8}$/;
export const WORKER_DOMAIN_SUFFIX = 'bahi.invalid';

/**
 * @param {*} raw
 * @returns {?string} the username in its stored form, or null when it can't be one
 */
export function normalizeUsername(raw) {
    const u = String(raw ?? '').trim().toLowerCase();
    return USERNAME_RE.test(u) ? u : null;
}

/** @param {*} pin */
export const validPin = (pin) => PIN_RE.test(String(pin ?? ''));

/**
 * The email domain of this shop's worker accounts.
 * @param {string} projectId - the Firebase project the app runs against
 */
export const workerDomain = (projectId) => `${String(projectId || 'shop').toLowerCase()}.${WORKER_DOMAIN_SUFFIX}`;

/**
 * @param {string} username - normalized
 * @param {string} domain - workerDomain()
 */
export const workerEmail = (username, domain) => `${username}@${domain}`;

/**
 * What the login card signs in with: an email as typed, or a username's worker email.
 * @param {*} input
 * @param {string} domain
 * @returns {string}
 */
export function loginEmailFor(input, domain) {
    const v = String(input ?? '').trim();
    if (v.includes('@')) return v;
    const u = normalizeUsername(v);
    return u ? workerEmail(u, domain) : v;
}

/**
 * The username of a worker account's email, else null (an ordinary email).
 * @param {*} email
 * @returns {?string}
 */
export function workerUsername(email) {
    const m = String(email ?? '').toLowerCase().match(/^([^@]+)@[^@]+\.bahi\.invalid$/);
    return m ? m[1] : null;
}
