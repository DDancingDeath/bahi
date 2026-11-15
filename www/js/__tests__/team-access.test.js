/**
 * @fileoverview Access and team helpers from the Android UX review (U-08, U-55, U-56, U-58):
 * worker sign-ins without email, the owner's write-off alerts, the first-run checklist and the
 * phone lock's PIN and idle rules.
 */
import { normalizeUsername, validPin, workerDomain, workerEmail, loginEmailFor, workerUsername } from '../utils/worker-accounts.js';
import { writeOffsByOthers } from '../utils/owner-alerts.js';
import { firstRunSteps, showFirstRun, appLockOfferDue } from '../utils/first-run.js';
import { hashPin, shouldLock, validLockPin, canUseAppLock } from '../ui/app-lock.js';
import { webcrypto } from 'crypto';

describe('worker accounts without email (U-56)', () => {
    test('usernames and PINs', () => {
        expect(normalizeUsername('  Ramesh_1 ')).toBe('ramesh_1');
        expect(normalizeUsername('ab')).toBeNull();
        expect(normalizeUsername('ram esh')).toBeNull();
        expect(normalizeUsername('ram@shop')).toBeNull();
        expect(validPin('123456')).toBe(true);
        expect(validPin('12345')).toBe(false);
        expect(validPin('12a456')).toBe(false);
    });

    test('a username signs in with its reserved .invalid email; an email is used as typed', () => {
        const domain = workerDomain('Happa-Dev');
        expect(domain).toBe('happa-dev.bahi.invalid');
        expect(loginEmailFor('Ramesh', domain)).toBe(workerEmail('ramesh', domain));
        expect(loginEmailFor('owner@shop.in', domain)).toBe('owner@shop.in');
        expect(workerUsername('ramesh@happa-dev.bahi.invalid')).toBe('ramesh');
        expect(workerUsername('owner@shop.in')).toBeNull();
    });
});

describe("the owner hears of someone else's write-off (U-08)", () => {
    const now = Date.UTC(2026, 10, 15, 12);
    const day = 86400000;
    const bill = (id, payments) => ({ id, billNumber: `S${id}`, customerName: 'Ram', payments });
    const wo = (id, by, at, amount = 500) => ({ id, kind: 'writeOff', amount, recordedById: by, recordedBy: by === 'm1' ? 'Mohan' : 'Owner', at });

    test("only others' write-offs of the last 7 days, newest first", () => {
        const list = writeOffsByOthers({
            retail: [bill('1', [wo('w1', 'm1', now - day), { id: 'p', kind: 'payment', amount: 10, recordedById: 'm1', at: now }])],
            purchase: [bill('2', [wo('w2', 'owner', now - day), wo('w3', 'm1', now - 8 * day)])],
            wholesale: [bill('3', [wo('w4', 'm1', now - 2 * 3600000, 75)])]
        }, 'owner', now);
        expect(list.map(x => [x.key, x.billType, x.by, x.amount])).toEqual([['wo:w4', 'wholesale', 'Mohan', 75], ['wo:w1', 'retail', 'Mohan', 500]]);
    });
});

describe('first-run checklist (U-58)', () => {
    test('steps are done from what the shop already has; shown to an owner until done or hidden', () => {
        const steps = firstRunSteps({ shopName: 'Ram Traders', itemCount: 0, teamSeen: false, printerSet: true });
        expect(steps.map(s => [s.id, s.done])).toEqual([['shop', true], ['items', false], ['team', false], ['printer', true]]);
        expect(showFirstRun(steps, { isOwner: true, hidden: false })).toBe(true);
        expect(showFirstRun(steps, { isOwner: false, hidden: false })).toBe(false);
        expect(showFirstRun(steps, { isOwner: true, hidden: true })).toBe(false);
        expect(showFirstRun(firstRunSteps({ shopName: 'x', itemCount: 1, teamSeen: true, printerSet: true }), { isOwner: true, hidden: false })).toBe(false);
    });
});

describe('phone lock (U-55)', () => {
    beforeAll(() => {
        if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
        if (typeof TextEncoder === 'undefined') globalThis.TextEncoder = require('util').TextEncoder;
    });

    test('owner and managers only; offered once to the owner, off by default', () => {
        expect(canUseAppLock('owner')).toBe(true);
        expect(canUseAppLock('manager')).toBe(true);
        expect(canUseAppLock('staff')).toBe(false);
        const store = new Map();
        const s = { getItem: k => store.get(k) ?? null };
        expect(appLockOfferDue(s, 'u1', 'owner')).toBe(true);
        expect(appLockOfferDue(s, 'u1', 'staff')).toBe(false);
        store.set('happa.appLockAsked.u1', '1');
        expect(appLockOfferDue(s, 'u1', 'owner')).toBe(false);
    });

    test('the PIN is kept as a salted hash; the phone locks after the chosen idle minutes', async () => {
        expect(validLockPin('1234')).toBe(true);
        expect(validLockPin('12')).toBe(false);
        const a = await hashPin('1234', 'salt-a');
        expect(a).toMatch(/^[0-9a-f]{64}$/);
        expect(a).not.toContain('1234');
        expect(await hashPin('1234', 'salt-b')).not.toBe(a);
        expect(await hashPin('1234', 'salt-a')).toBe(a);
        expect(shouldLock(0, 5 * 60000 - 1, 5)).toBe(false);
        expect(shouldLock(0, 5 * 60000, 5)).toBe(true);
        expect(shouldLock(0, 10 * 60000, 0)).toBe(false);
    });
});
