import { chooseStartPage, roleStartPage, routeFromHash } from '../utils/start-page.js';

const all = () => true;
const except = (...off) => (id) => !off.includes(id);

describe('start page per role', () => {
    test('owner opens on Today; manager and member (staff) on Billing', () => {
        expect(chooseStartPage({ role: 'owner', canOpen: all })).toEqual({ tab: 'day', home: 'day', source: 'role' });
        expect(chooseStartPage({ role: 'manager', canOpen: all })).toEqual({ tab: 'billing', home: 'billing', source: 'role' });
        expect(chooseStartPage({ role: 'staff', canOpen: all })).toEqual({ tab: 'billing', home: 'billing', source: 'role' });
    });

    test('Rentals-only and unknown roles keep Billing, as before', () => {
        for (const role of ['none', undefined, null, 'tenant']) {
            expect(roleStartPage(role)).toBe('billing');
            expect(chooseStartPage({ role, canOpen: all }).tab).toBe('billing');
        }
    });

    test('a page the role may not open falls back to the first one it may', () => {
        expect(chooseStartPage({ role: 'owner', canOpen: except('day') })).toMatchObject({ tab: 'billing', home: 'billing' });
        expect(chooseStartPage({ role: 'manager', canOpen: except('billing') })).toMatchObject({ tab: 'day', home: 'day' });
        expect(chooseStartPage({ role: 'staff', canOpen: except('billing', 'day') })).toMatchObject({ tab: 'history', home: 'history' });
        expect(chooseStartPage({ role: 'staff', canOpen: () => false }).tab).toBe('billing');
    });
});

describe('deep links and reloads', () => {
    test('an explicit link wins over the role start page and a reloaded page; home stays the role page', () => {
        expect(chooseStartPage({ role: 'owner', link: 'history', restored: 'billing', canOpen: all }))
            .toEqual({ tab: 'history', home: 'day', source: 'link' });
        expect(chooseStartPage({ role: 'staff', link: 'settings-printing', canOpen: all }))
            .toEqual({ tab: 'settings-printing', home: 'billing', source: 'link' });
    });

    test('a refused link is still opened, so navigation says why and falls back', () => {
        expect(chooseStartPage({ role: 'staff', link: 'admin', canOpen: except('admin') }).tab).toBe('admin');
    });

    test('a reload keeps the page this tab showed (a bill being typed stays on Billing)', () => {
        expect(chooseStartPage({ role: 'owner', restored: 'billing', canOpen: all })).toEqual({ tab: 'billing', home: 'day', source: 'session' });
        expect(chooseStartPage({ role: 'owner', restored: 'admin', canOpen: except('admin') }).tab).toBe('day');
    });

    test('routeFromHash reads #route and ignores anything else', () => {
        expect(routeFromHash('#history')).toBe('history');
        expect(routeFromHash('#/settings-printing')).toBe('settings-printing');
        for (const h of ['', '#', undefined, '#Main', '#a b', '#x?y=1', `#${'a'.repeat(60)}`]) expect(routeFromHash(h)).toBeNull();
    });
});
