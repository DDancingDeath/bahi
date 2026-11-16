// @ts-check
/**
 * @fileoverview First-run checklist for a new shop's owner on Today (U-58): the few things that
 * make the app useful on day one, each with where to do it. Kept until done or hidden.
 * @module utils/first-run
 */

/** localStorage keys, per owner (uid appended). */
export const FIRST_RUN_HIDDEN_KEY = 'happa.firstRun.hidden';
export const FIRST_RUN_TEAM_KEY = 'happa.firstRun.team';

/**
 * @param {{shopName?: *, itemCount?: number, teamSeen?: boolean, printerSet?: boolean}} state
 * @returns {Array<{id: 'shop'|'items'|'team'|'printer', done: boolean, route: string}>}
 */
export function firstRunSteps({ shopName = '', itemCount = 0, teamSeen = false, printerSet = false } = {}) {
    return [
        { id: 'shop', done: String(shopName || '').trim().length > 0, route: 'settings-shop' },
        { id: 'items', done: itemCount > 0, route: 'rates' },
        { id: 'team', done: !!teamSeen, route: 'settings-team' },
        { id: 'printer', done: !!printerSet, route: 'settings-printing' }
    ];
}

/**
 * Whether Today shows the checklist: owner only, not hidden, something left to do.
 * @param {Array<{done: boolean}>} steps
 * @param {{isOwner: boolean, hidden: boolean}} opts
 */
export const showFirstRun = (steps, { isOwner, hidden }) => isOwner && !hidden && steps.some(s => !s.done);

/** Phone lock (U-55) keys, per person (uid appended): the lock itself and "already offered". */
export const APP_LOCK_KEY = 'happa.appLock';
export const APP_LOCK_ASKED_KEY = 'happa.appLockAsked';

/**
 * The owner is offered the phone lock once, on Today, until set up or dismissed (U-55).
 * @param {?Storage} store
 * @param {string} uid
 * @param {string} role
 */
export function appLockOfferDue(store, uid, role) {
    if (role !== 'owner' || !uid || !store) return false;
    try {
        return !store.getItem(`${APP_LOCK_KEY}.${uid}`) && !store.getItem(`${APP_LOCK_ASKED_KEY}.${uid}`);
    } catch (_) {
        return false;
    }
}
