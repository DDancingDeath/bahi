/**
 * @fileoverview Who may give or take the owner role (utils/owner-roles.js): the same checks
 * as firestore.rules (rules-tests "owners: …"), made before anything is written.
 */
import {
    roleChangeCheck, removalCheck, activeOwnerIds, missingOwners, ownerList,
    firstOwnerOf, pickFirstOwner, isFounderLocked, canHandOverFirstOwner
} from '../utils/owner-roles.js';

const me = { id: 'me', name: 'Me', role: 'owner', status: 'active' };
const o2 = { id: 'o2', name: 'Second', role: 'owner', status: 'approved' };
const mgr = { id: 'mgr', name: 'Ramesh', role: 'manager', status: 'active' };
const pend = { id: 'pend', name: 'New', role: 'staff', status: 'pending' };
const gone = { id: 'gone', name: 'Gone', role: 'owner', status: 'disabled' };
const actor = { id: 'me', role: 'owner' };
const check = (target, next, users) => roleChangeCheck({ actor, target, next, users });

describe('roleChangeCheck', () => {
    test('an owner makes an approved person owner; a pending one is approved first', () => {
        expect(check(mgr, 'owner', [me, mgr])).toEqual({ ok: true, kind: 'promote' });
        expect(check(pend, 'owner', [me, pend])).toEqual({ ok: false, reason: 'pending' });
        expect(check({ id: 'x', status: 'active' }, 'owner', [me])).toEqual({ ok: false, reason: 'pending' });
    });

    test('managers and members never change roles', () => {
        for (const role of ['manager', 'staff', 'none']) {
            expect(roleChangeCheck({ actor: { id: 'mgr', role }, target: mgr, next: 'owner', users: [me, mgr] }))
                .toEqual({ ok: false, reason: 'not_owner' });
        }
    });

    test('never the last active owner: demote, step down', () => {
        expect(check(me, 'manager', [me, mgr, gone])).toEqual({ ok: false, reason: 'last_owner' });
        expect(check(me, 'staff', [me, o2])).toEqual({ ok: true, kind: 'step_down' });
        expect(check(o2, 'manager', [me, o2])).toEqual({ ok: true, kind: 'demote' });
    });

    test('plain changes, the same role and unknown roles', () => {
        expect(check(mgr, 'staff', [me, mgr])).toEqual({ ok: true, kind: 'plain' });
        expect(check(mgr, 'manager', [me, mgr])).toEqual({ ok: false, reason: 'same' });
        expect(check(mgr, 'none', [me, mgr])).toEqual({ ok: false, reason: 'bad_role' });
    });
});

describe('removalCheck', () => {
    test('another owner can be removed while you stay; never yourself', () => {
        expect(removalCheck({ actor, target: o2, users: [me, o2] })).toEqual({ ok: true, owner: true });
        expect(removalCheck({ actor, target: mgr, users: [me, mgr] })).toEqual({ ok: true, owner: false });
        expect(removalCheck({ actor, target: me, users: [me, o2] })).toEqual({ ok: false, reason: 'own_account' });
        expect(removalCheck({ actor: { id: 'x', role: 'owner' }, target: o2, users: [o2] })).toEqual({ ok: false, reason: 'last_owner' });
        expect(removalCheck({ actor: { id: 'mgr', role: 'manager' }, target: o2, users: [me, o2] })).toEqual({ ok: false, reason: 'not_owner' });
    });
});

describe('the owner list', () => {
    test('active owners, the stored list and who is missing from it', () => {
        expect(activeOwnerIds([me, o2, mgr, gone, pend, null])).toEqual(['me', 'o2']);
        expect(ownerList(null)).toEqual([]);
        expect(ownerList({ ownerUids: ['me', 5] })).toEqual(['me']);
        expect(missingOwners(['me', 'o2', 'o2'], { ownerUids: ['me'] })).toEqual(['o2']);
        expect(missingOwners(['me'], null)).toEqual(['me']);
    });
});

describe('the first owner (founder)', () => {
    test('nobody else demotes or removes the founder; the founder still can, and steps down with another owner', () => {
        const asO2 = { id: 'o2', role: 'owner' };
        expect(roleChangeCheck({ actor: asO2, target: me, next: 'manager', users: [me, o2], firstOwnerUid: 'me' }))
            .toEqual({ ok: false, reason: 'founder' });
        expect(removalCheck({ actor: asO2, target: me, users: [me, o2], firstOwnerUid: 'me' })).toEqual({ ok: false, reason: 'founder' });
        expect(roleChangeCheck({ actor, target: o2, next: 'manager', users: [me, o2], firstOwnerUid: 'me' })).toEqual({ ok: true, kind: 'demote' });
        expect(roleChangeCheck({ actor, target: me, next: 'manager', users: [me, o2], firstOwnerUid: 'me' })).toEqual({ ok: true, kind: 'step_down' });
        expect(roleChangeCheck({ actor, target: me, next: 'manager', users: [me], firstOwnerUid: 'me' })).toEqual({ ok: false, reason: 'last_owner' });
        // a founder who stepped down is an ordinary person again
        const exFounder = { ...me, role: 'manager' };
        expect(roleChangeCheck({ actor: asO2, target: exFounder, next: 'staff', users: [exFounder, o2], firstOwnerUid: 'me' }))
            .toEqual({ ok: true, kind: 'plain' });
        expect(isFounderLocked(me, null, 'o2')).toBe(false);
    });

    test('recorded as the earliest-created active owner; no createdAt counts as earliest; ties by uid', () => {
        const at = (ms) => ({ toMillis: () => ms });
        expect(pickFirstOwner([
            { ...o2, createdAt: at(200) }, { ...me, id: 'b', createdAt: at(100) }, { ...me, id: 'a', createdAt: at(100) },
            { ...gone, createdAt: at(1) }, { ...mgr, createdAt: at(1) }
        ])).toBe('a');
        expect(pickFirstOwner([{ ...o2, createdAt: '2026-01-01' }, { ...me, id: 'legacy' }])).toBe('legacy');
        expect(pickFirstOwner([mgr, gone])).toBeNull();
        expect(firstOwnerOf({ firstOwnerUid: 'me' })).toBe('me');
        expect(firstOwnerOf({ firstOwnerUid: '' })).toBeNull();
        expect(firstOwnerOf(null)).toBeNull();
    });

    test('only the founder hands it on, to another active owner', () => {
        expect(canHandOverFirstOwner({ actor, target: o2, firstOwnerUid: 'me' })).toBe(true);
        expect(canHandOverFirstOwner({ actor, target: mgr, firstOwnerUid: 'me' })).toBe(false);
        expect(canHandOverFirstOwner({ actor, target: me, firstOwnerUid: 'me' })).toBe(false);
        expect(canHandOverFirstOwner({ actor: { id: 'o2', role: 'owner' }, target: me, firstOwnerUid: 'me' })).toBe(false);
        expect(canHandOverFirstOwner({ actor, target: o2, firstOwnerUid: null })).toBe(false);
    });
});
