// @ts-check
/**
 * @fileoverview The page the app opens on (docs/role-permissions.md, "Start page"): an explicit
 * launch link (home-screen shortcut or `#route`), else the page of this tab's session (reload),
 * else the role's start page (owner: Today; manager, member and others: Billing), else the
 * first page the role may open.
 * @module utils/start-page
 */

/** @type {Readonly<Object<string, string>>} */
export const ROLE_START_PAGES = Object.freeze({ owner: 'day' });

/** Tried in order when the role's start page is switched off for it. */
export const START_FALLBACKS = Object.freeze(['billing', 'day', 'history', 'due', 'settings']);

/**
 * @param {?string|undefined} role - AppState.userRole
 * @returns {string}
 */
export function roleStartPage(role) {
    return (role && ROLE_START_PAGES[role]) || 'billing';
}

/**
 * The route a launch URL's hash names (`#history`, `#settings-printing`), or null.
 * @param {?string|undefined} hash - `location.hash`
 * @returns {?string}
 */
export function routeFromHash(hash) {
    const id = String(hash || '').replace(/^#\/?/, '');
    return /^[a-z][a-z0-9-]{0,40}$/.test(id) ? id : null;
}

/**
 * @param {{role?: ?string, link?: ?string, restored?: ?string, canOpen: function(string): boolean}} p
 *   link: explicit launch route (opened even when refused, so the refusal says why);
 *   restored: the route this browser tab showed before a reload
 * @returns {{tab: string, home: string, source: 'link'|'session'|'role'}}
 */
export function chooseStartPage({ role, link, restored, canOpen }) {
    const wanted = roleStartPage(role);
    const home = [wanted, ...START_FALLBACKS].find(id => canOpen(id)) || wanted;
    if (link) return { tab: link, home, source: 'link' };
    if (restored && canOpen(restored)) return { tab: restored, home, source: 'session' };
    return { tab: home, home, source: 'role' };
}
