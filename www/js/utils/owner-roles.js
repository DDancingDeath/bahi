// @ts-check
/**
 * @fileoverview Who may give or take the owner role (docs/role-permissions.md, "Owners").
 * The same checks as firestore.rules: only an owner changes roles; there is always at least
 * one active owner (`settings/team.ownerUids`, kept in the same batch as each change);
 * a pending person is approved first. Pure: no Firestore, AppState or DOM.
 * @module utils/owner-roles
 */

/** The roles an owner picks from in Admin › Users (stored `staff` is shown as Member). */
export const ROLE_CHOICES = Object.freeze(['staff', 'manager', 'owner']);

const GONE = ['pending', 'rejected', 'disabled'];

/** An owner who may use the app (the rules' activeOwner()). */
export const isActiveOwner = (/** @type {?Rec|undefined} */ u) => !!u && u.role === 'owner' && !GONE.includes(u.status);

/** Approved: not pending, rejected or removed, with a role. */
const isApproved = (/** @type {?Rec|undefined} */ u) => !!u && !!u.role && !GONE.includes(u.status);

/**
 * uids of the active owners among the profiles.
 * @param {Array<?Rec>} users
 * @returns {string[]}
 */
export function activeOwnerIds(users) {
    return (users || []).filter(u => u && u.id && isActiveOwner(u)).map(u => String(u?.id));
}

/**
 * The stored owner list of settings/team, or [] when missing.
 * @param {?Rec|undefined} team
 * @returns {string[]}
 */
export function ownerList(team) {
    const l = team && team.ownerUids;
    return Array.isArray(l) ? l.filter(x => typeof x === 'string') : [];
}

/**
 * What changing `target`'s role to `next` needs, or why it is refused.
 * kind: 'promote' (to owner), 'demote' (another owner loses it), 'step_down' (yourself), 'plain'.
 * reason (refused): 'not_owner' | 'same' | 'bad_role' | 'pending' | 'last_owner' | 'own_account'.
 * @param {{actor: {id: string, role: string}, target: Rec, next: string, users: Array<?Rec>}} p
 * @returns {{ok: true, kind: 'promote'|'demote'|'step_down'|'plain'} | {ok: false, reason: string}}
 */
export function roleChangeCheck({ actor, target, next, users }) {
    if (!actor || actor.role !== 'owner') return { ok: false, reason: 'not_owner' };
    if (!target || !ROLE_CHOICES.includes(next)) return { ok: false, reason: 'bad_role' };
    if (target.role === next) return { ok: false, reason: 'same' };
    const self = target.id === actor.id;
    const wasOwner = isActiveOwner(target);
    if (self && !wasOwner) return { ok: false, reason: 'own_account' };
    if (!isApproved(target)) return { ok: false, reason: 'pending' };
    if (next === 'owner') return { ok: true, kind: 'promote' };
    if (!wasOwner) return { ok: true, kind: 'plain' };
    const others = activeOwnerIds(users).filter(id => id !== target.id);
    if (others.length === 0) return { ok: false, reason: 'last_owner' };
    return { ok: true, kind: self ? 'step_down' : 'demote' };
}

/**
 * Removing a person's access (disable): an owner only, never yourself, never the last owner.
 * @param {{actor: {id: string, role: string}, target: Rec, users: Array<?Rec>}} p
 * @returns {{ok: true, owner: boolean} | {ok: false, reason: string}}
 */
export function removalCheck({ actor, target, users }) {
    if (!actor || actor.role !== 'owner') return { ok: false, reason: 'not_owner' };
    if (!target || target.id === actor.id) return { ok: false, reason: 'own_account' };
    if (!isActiveOwner(target)) return { ok: true, owner: false };
    if (!activeOwnerIds(users).some(id => id !== target.id)) return { ok: false, reason: 'last_owner' };
    return { ok: true, owner: true };
}

/**
 * Owners the stored list is missing (each added on its own write: the rules check one at a time).
 * @param {string[]} owners active owner uids from the profiles
 * @param {?Rec|undefined} team settings/team
 * @returns {string[]}
 */
export function missingOwners(owners, team) {
    const have = new Set(ownerList(team));
    return [...new Set(owners || [])].filter(id => !have.has(id));
}
