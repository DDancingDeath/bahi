/**
 * Rent page views (#170): Property wise (cards -> detail grouped by type) and
 * Unit wise (filters, search) render from the same unit rows; one language at a time.
 * Those are This month's View by Property / Unit; Who owes (the default, #157 UX redesign) lists who owes, late first.
 * One view for everyone (the Simple / Advanced switch is gone): every former Advanced action stays reachable.
 */
const DATA = {
    properties: [{ id: 'P1', name: 'Gupta Bhawan' }, { id: 'P2', name: 'Arora Market' }],
    units: [
        { id: 'U1', propertyId: 'P1', label: '2B', type: 'flat', rent: 8000 },
        { id: 'U2', propertyId: 'P1', label: '3A', rent: 7000 },
        { id: 'U3', propertyId: 'P1', label: 'Shop 3', type: 'commercial', rent: 12000 },
        { id: 'U4', propertyId: 'P2', label: 'G1', type: 'godown', rent: 15000 }
    ],
    tenants: [{ id: 'T1', name: 'Ram' }, { id: 'T2', name: 'Shyam' }],
    leases: [
        { id: 'L1', unitId: 'U1', tenantId: 'T1', rent: 8000, dueDay: 10, status: 'active', startMonth: '2026-01' },
        { id: 'L3', unitId: 'U3', tenantId: 'T2', rent: 12000, dueDay: 28, status: 'active', startMonth: '2026-01' }
    ],
    linked: [],
    charges: []
};
jest.mock('../rentals/rent-store.js', () => ({
    snapshot: () => global.__rentData, truncatedKeys: () => [], isAttached: () => true, attach: jest.fn(), detach: jest.fn()
}));
jest.mock('../firebase/firestore-service.js', () => ({ FirebaseService: { loadUsers: jest.fn(async () => []) } }));
jest.mock('../ui/business-switcher.js', () => ({ rentalsRole: jest.fn(() => 'owner') }));
jest.mock('../ui/ui-manager.js', () => ({ UIManager: { showToast: jest.fn(), showModal: jest.fn() } }));
jest.mock('../utils/open-external.js', () => ({ openExternal: jest.fn() }));
jest.mock('../services/audit.js', () => ({ AuditService: { log: jest.fn(async () => {}) } }));

import { _test, RentalsModule } from '../rentals/rentals.js';
import { AppState } from '../utils/state.js';
import { saveLeaseReminders } from '../utils/reminders.js';
import { rentalsRole } from '../ui/business-switcher.js';
import { openExternal } from '../utils/open-external.js';
import { setLang, resetLangForTests } from '../i18n/index.js';
import { monthKey } from '../rentals/rent-math.js';

const M = monthKey();
global.__rentData = {
    ...DATA,
    charges: [
        { id: `L1_${M}`, leaseId: 'L1', unitId: 'U1', month: M, dueDay: 10, amount: 8000, paid: 8000, payments: [] },
        { id: `L3_${M}`, leaseId: 'L3', unitId: 'U3', month: M, dueDay: 28, amount: 12000, paid: 2000, payments: [] }
    ]
};

async function show(by = 'properties') {
    document.body.innerHTML = '<div id="rentals" class="tab active"><div id="rentalsNotice"></div><div id="rentalsBody"></div></div>';
    window.app = { rentals: { ...RentalsModule.api } };
    _test.state.page = 'rent';
    _test.state.by = by;
    _test.state.month = M;
    ['properties', 'units', 'tenants', 'leases', 'openCharges', 'monthCharges', 'monthPaid', 'monthExpenses'].forEach(k => _test.state.loaded.add(k));
    await _test.render();
    return document.getElementById('rentalsBody');
}

afterEach(() => { localStorage.clear(); resetLangForTests(); });

test('View by Property: cards with type counts, then a property grouped by type', async () => {
    setLang('en');
    localStorage.clear();
    _test.state.openProperty = '';
    let root = await show();
    expect(root.textContent).toContain('2 flats · 1 commercial');
    expect(root.textContent).toContain('2 occupied · 1 vacant');
    expect(root.textContent).toMatch(/This month: ₹20,000 rent, ₹10,000 paid/);
    RentalsModule.api.openProperty('P1');
    root = document.getElementById('rentalsBody');
    const groups = [...root.querySelectorAll('.rent-group-title')].map(h => h.textContent);
    expect(groups).toEqual(['Flat (2)', 'Commercial / shop space (1)']);
    expect(root.textContent).toContain('Shop 3');
    expect(root.textContent).not.toContain('Shop Shop 3');
    expect(root.textContent).toContain('Part paid');
    expect(root.textContent).toContain('Vacant');
    expect(root.querySelectorAll('button[data-onclick*="rentals.pay"]').length).toBe(1);
});

test('View by Unit: filters and search redraw only the list', async () => {
    setLang('en');
    _test.state.openProperty = '';
    const root = await show('units');
    expect(root.querySelector('[data-rent-by="units"]').getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelectorAll('[data-unit]').length).toBe(4);
    const search = root.querySelector('input[type=search]');
    await RentalsModule.api.filterUnits('q', 'shyam');
    expect(document.querySelector('input[type=search]')).toBe(search);
    expect([...root.querySelectorAll('[data-unit]')].map(e => e.getAttribute('data-unit'))).toEqual(['U3']);
    await RentalsModule.api.filterUnits('q', '');
    await RentalsModule.api.filterUnits('status', 'vacant');
    expect([...root.querySelectorAll('[data-unit]')].map(e => e.getAttribute('data-unit')).sort()).toEqual(['U2', 'U4']);
    RentalsModule.api.filterUnits('status', '');
});

test('Hindi: type words and counts in Hindi only', async () => {
    setLang('hi');
    _test.state.openProperty = '';
    const text = (await show()).textContent.replace(/Gupta Bhawan|Arora Market|Ram|Shyam|Shop 3|2B|3A|G1/g, '');
    expect(text).toContain('2 फ़्लैट · 1 कमर्शियल');
    expect(text).not.toMatch(/[A-Za-z]{3,}/);
});

test('no properties yet: the Rent page offers Add property, and the side menu marks only the open Rentals page', async () => {
    setLang('en');
    _test.state.openProperty = '';
    const saved = global.__rentData;
    global.__rentData = { ...DATA, properties: [], units: [], tenants: [], leases: [], charges: [] };
    try {
        await show();
        document.body.insertAdjacentHTML('afterbegin', '<nav class="nav-menu"><a data-biz="all" class="active">Settings</a><a data-biz="rentals" data-rent-nav="rent">Rent</a></nav>');
        _test.render();
        const add = document.querySelector('#rentalsBody button[data-onclick*="rentals.page(\'properties\')"]');
        expect(add.textContent).toBe('Add property');
        expect([...document.querySelectorAll('.nav-menu a.active')].map(a => a.textContent)).toEqual(['Rent']);
    } finally {
        global.__rentData = saved;
    }
});

describe('This month, View by Who owes (the default)', () => {
    // Ram paid ₹8,000 of an older month this month: that month is closed, so only the "touched this month" listener has it.
    const OLD_PAID = { id: 'L1_2025-10', leaseId: 'L1', unitId: 'U1', tenantId: 'T1', month: '2025-10', dueDay: 10, amount: 8000, paid: 8000, open: false,
        payments: [{ amount: 8000, mode: 'cash', date: `${M}-02` }] };
    const OWES = () => {
        const charges = [
            ...global.__rentData.charges,
            { id: 'L3_2025-11', leaseId: 'L3', unitId: 'U3', tenantId: 'T2', month: '2025-11', dueDay: 28, amount: 12000, paid: 0, payments: [] },
            { id: 'L9_2025-12', leaseId: 'L9', unitId: 'U2', tenantId: 'T3', tenantName: 'Hari', month: '2025-12', dueDay: 10, amount: 5000, paid: 0, payments: [] }
        ];
        return { ...DATA, tenants: [...DATA.tenants, { id: 'T3', name: 'Hari' }], charges, paidCharges: [...charges, OLD_PAID] };
    };
    let saved;
    beforeEach(() => { saved = global.__rentData; global.__rentData = OWES(); AppState.currentUser = { uid: 'u1' }; setLang('en'); });
    afterEach(() => { global.__rentData = saved; });

    test('collected of the month rent, who owes (a moved-out tenant once, late first), paid folded, one filled button', async () => {
        const root = await show('owes');
        expect(root.textContent).toContain("This month's rent: ₹10,000 paid of ₹20,000");
        // RENT-20: the ₹8,000 that came in this month for an older month
        expect(root.querySelector('[data-rent-received]').textContent).toBe('Received this month: ₹8,000');
        // RENT-21: each tenant's month (Hari moved out: none)
        expect(root.querySelector('[data-lease="L3"] [data-rent-month-state]').textContent).toBe('This month: part paid, ₹2,000 of ₹12,000');
        expect(root.querySelector('[data-lease="L1"] [data-rent-month-state]').textContent).toBe('This month: paid');
        expect(root.querySelector('[data-lease="L9"] [data-rent-month-state]')).toBeNull();
        expect(root.textContent).toContain('Total due (all months): ₹27,000');
        const owing = [...root.querySelectorAll('#rentalsBody > .panel > [data-lease]')].map(e => e.getAttribute('data-lease'));
        expect(owing).toEqual(['L3', 'L9']);
        const hari = root.querySelector('[data-lease="L9"]').textContent;
        expect(hari).toContain('Moved out');
        expect(hari).toContain('3A, Gupta Bhawan');
        expect(root.querySelector('details.rent-more').textContent).toContain('Ram');
        expect(root.textContent).toContain('2 vacant units');
        expect(root.querySelectorAll('.btn-primary').length).toBe(1);
        expect(root.querySelector('.rent-filters, [data-property]')).toBeNull();
    });

    test('its listener failing blanks only Received this month: no page notice, the rest renders', async () => {
        _test.state.paidError = true;
        try {
            const root = await show('owes');
            expect(root.querySelector('[data-rent-received]').textContent).toBe('Received this month: —');
            expect(root.textContent).toContain("This month's rent: ₹10,000 paid of ₹20,000");
            expect(document.getElementById('rentalsNotice').hidden).toBe(true);
        } finally {
            _test.state.paidError = false;
        }
    });

    test('Received this month waits for its listener ("—"), and Hindi', async () => {
        _test.state.loaded.delete('monthPaid');
        document.body.innerHTML = '<div id="rentals" class="tab active"><div id="rentalsNotice"></div><div id="rentalsBody"></div></div>';
        _test.state.by = 'owes';
        await _test.render();
        expect(document.querySelector('[data-rent-received]').textContent).toBe('Received this month: —');
        setLang('hi');
        const root = await show('owes');
        expect(root.querySelector('[data-rent-received]').textContent).toBe('इस महीने मिला: ₹8,000');
        expect(root.querySelector('[data-lease="L3"] [data-rent-month-state]').textContent).toBe('इस महीने: ₹12,000 में से ₹2,000 चुकाया');
    });

    test('Needs attention shows what Today shows (REM-2, REM-4), the meter readings to enter (REM-7), and opens the action', async () => {
        saveLeaseReminders(localStorage, { uid: 'u1', month: M, items: [{ kind: 'increase', place: 'Flat 2B, Gupta Bhawan', tenant: 'Ram', pct: 5, newRent: 8400 }] });
        const root = await show('owes');
        const rows = [...root.querySelectorAll('.rent-attn .row')];
        expect(rows[0].textContent).toContain('Rent due');
        expect(rows[0].textContent).toContain('2 units owe rent · 1 late');
        expect(rows[0].textContent).toContain('₹27,000');
        expect(rows[0].getAttribute('data-onclick')).toBe('rentals.onlyLate(true)');
        // At the top of the page, before the month's totals (REM-2 left Aadhat's Today)
        expect(root.querySelector('.rent-attn').compareDocumentPosition(root.querySelector('.rent-collect')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        // Leases without an electricity choice are billed by our meter (the default).
        expect(rows[1].textContent).toContain('Meter readings: 2 to enter');
        expect(rows[2].textContent).toContain('rent increase due: 5% → ₹8,400');
        expect(rows[2].getAttribute('data-onclick')).toBe("rentals.editLease('L1')");
        RentalsModule.api.onlyLate(true);
        expect([...document.querySelectorAll('#rentalsBody > .panel > [data-lease]')].map(e => e.getAttribute('data-lease'))).toEqual(['L3', 'L9']);
        RentalsModule.api.onlyLate(false);
    });

    test('no properties: the start hint, and the page settles (no render loop from the lease reminders)', async () => {
        global.__rentData = { ...DATA, properties: [], units: [], tenants: [], leases: [], charges: [] };
        const root = await show('owes');
        expect(root.textContent).toContain('Start by adding a property and its units.');
        expect(root.querySelector('[data-rent-by="owes"]').getAttribute('aria-pressed')).toBe('true');
        let renders = 0;
        new MutationObserver(() => { renders++; }).observe(root, { childList: true });
        await new Promise(r => setTimeout(r, 300));
        expect(renders).toBeLessThanOrEqual(1);
    });

    test('View by switches in place: Who owes, Property (totals, moved-out balances under More), Unit (filters, search, sort)', async () => {
        const root = await show('owes');
        const by = () => [...root.querySelectorAll('[data-rent-by]')].map(b => [b.getAttribute('data-rent-by'), b.getAttribute('aria-pressed')]);
        expect(by()).toEqual([['owes', 'true'], ['properties', 'false'], ['units', 'false']]);
        expect(root.querySelector('.rent-viewby').textContent).toMatch(/View by\s*Who owes\s*Property\s*Unit/);
        await RentalsModule.api.viewBy('properties');
        expect(by()[1]).toEqual(['properties', 'true']);
        expect(root.querySelector('.rent-metrics').textContent).toContain('Expenses this month');
        const more = root.querySelector('details.rent-more[data-rent-moved-out]');
        expect(more.open).toBe(false);
        expect(more.querySelector('summary').textContent).toBe('More: moved out, rent still due (1)');
        expect(more.querySelector('[data-lease="L9"]').innerHTML).toContain("rentals.pay('L9')");
        await RentalsModule.api.viewBy('units');
        expect(root.querySelector('.rent-filters input[type=search]')).not.toBeNull();
        expect([...root.querySelectorAll('.rent-filters button')].map(b => b.getAttribute('data-onclick'))).toEqual(["rentals.filterUnits('sort', 'asc')"]);
        await RentalsModule.api.viewBy('owes');
        expect(root.querySelector('[data-rent-received]')).not.toBeNull();
    });

    test('old Simple / Advanced: the saved choice is ignored and cleared; old calls and pages land on the new views', async () => {
        localStorage.setItem('happa.rentMode.u1', 'advanced');
        localStorage.setItem('happa.rentView', 'units');
        _test.state.by = 'owes';
        await RentalsModule.enter('rent');
        expect(localStorage.getItem('happa.rentMode.u1')).toBeNull();
        expect(localStorage.getItem('happa.rentView')).toBeNull();
        expect(_test.state.by).toBe('owes');
        RentalsModule.api.setMode('advanced');
        expect(_test.state.by).toBe('properties');
        RentalsModule.api.setMode('simple');
        expect(_test.state.by).toBe('owes');
        RentalsModule.api.setView('units');
        expect(_test.state.by).toBe('units');
        for (const [page, by] of [['advanced', 'properties'], ['rent-units', 'units'], ['rent-properties', 'properties']]) {
            _test.state.by = 'owes';
            await RentalsModule.enter(page);
            expect([_test.state.page, _test.state.by]).toEqual(['rent', by]);
        }
        await RentalsModule.api.propertyMonth('P1');
        expect([_test.state.page, _test.state.by, _test.state.openProperty]).toEqual(['rent', 'properties', 'P1']);
        expect(document.querySelector('#rentalsBody .rent-detail-title').textContent).toBe('Gupta Bhawan');
        _test.state.openProperty = '';
        await RentalsModule.enter('reports');
        expect(_test.state.page).toBe('reports');
    });
});

describe('Tenants and the tenant screen', () => {
    async function tenants() {
        await show('owes');
        _test.state.page = 'tenants';
        _test.state.detail = '';
        await _test.render();
        return document.getElementById('rentalsBody');
    }
    afterEach(() => { rentalsRole.mockReturnValue('owner'); _test.state.tenantList = { q: '', filter: 'all', sort: 'name' }; });

    test('one row per tenant (no inline form, no buttons on rows), one filled Add tenant; search redraws only the list', async () => {
        setLang('en');
        const root = await tenants();
        expect([...root.querySelectorAll('[data-tenant]')].map(e => e.getAttribute('data-tenant'))).toEqual(['T1', 'T2']);
        expect(root.querySelector('.rent-form, #rentTenantName')).toBeNull();
        expect(root.querySelectorAll('.btn-primary').length).toBe(1);
        expect(root.querySelector('[data-tenant="T2"]').textContent).toContain('Shop 3, Gupta Bhawan');
        RentalsModule.api.tenantList('q', 'shop 3');
        expect([...root.querySelectorAll('[data-tenant]')].map(e => e.getAttribute('data-tenant'))).toEqual(['T2']);
    });

    test('a row opens the tenant screen; the ⋯ menu follows the role; Back returns to the list', async () => {
        setLang('en');
        await tenants();
        RentalsModule.api.openTenant('T2');
        let root = document.getElementById('rentalsBody');
        expect(root.querySelector('#rentDetailTitle').textContent).toBe('Shyam');
        const menu = () => [...document.querySelectorAll('.rent-menu-list button')].map(b => b.getAttribute('data-onclick').match(/rentals\.(\w+)/)[1]);
        expect(menu()).toEqual(['editTenant', 'agreement', 'shareLink', 'changeUnit']);
        expect(root.querySelector('[data-onclick^="rentals.moveOut"]').className).toContain('tone-neg');
        expect(root.querySelectorAll('.btn-primary').length).toBe(1);
        rentalsRole.mockReturnValue('member');
        _test.render();
        expect(menu()).toEqual(['editTenant', 'changeUnit']);
        RentalsModule.api.back();
        // Back re-renders asynchronously; a fixed 20 ms wait flaked on loaded CI runners.
        for (let i = 0; i < 100 && document.querySelector('#rentalsBody #rentDetailTitle'); i++) {
            await new Promise(r => setTimeout(r, 20));
        }
        root = document.getElementById('rentalsBody');
        expect(root.querySelector('#rentDetailTitle')).toBeNull();
        expect(root.querySelectorAll('[data-tenant]').length).toBe(2);
    });

    test('WhatsApp on the tenant screen asks for everything owed, the old unit after a change too', async () => {
        setLang('en');
        const saved = global.__rentData;
        global.__rentData = { ...DATA, tenants: [{ id: 'T1', name: 'Ram', phone: '9876543210' }, DATA.tenants[1]], charges: [
            { id: 'L0_2025-12', leaseId: 'L0', unitId: 'U4', tenantId: 'T1', unitLabel: 'G1', month: '2025-12', dueDay: 10, amount: 5000, paid: 0 },
            { id: `L1_${M}`, leaseId: 'L1', unitId: 'U1', tenantId: 'T1', month: M, dueDay: 10, amount: 8000, paid: 0 }
        ] };
        try {
            await tenants();
            RentalsModule.api.openTenant('T1');
            expect(document.getElementById('rentalsBody').textContent).toContain('Owes ₹13,000');
            RentalsModule.api.remindTenant('T1');
            const url = decodeURIComponent(openExternal.mock.calls.at(-1)[0]);
            expect(url).toContain('Dec 2025');
            expect(url).toContain('₹13,000');
        } finally {
            global.__rentData = saved;
            _test.state.detail = '';
        }
    });

    test('Back after opening the same tenant again returns to the list (each screen has its own history entry)', async () => {
        await tenants();
        RentalsModule.api.openTenant('T1');
        await RentalsModule.api.page('tenants');
        _test.state.page = 'tenants';
        RentalsModule.api.openTenant('T1');
        RentalsModule.api.back();
        await new Promise(r => setTimeout(r, 20));
        expect(document.getElementById('rentDetailTitle')).toBeNull();
    });

    test('Filter opens a sheet: filters and sort apply at once and the button counts them; the row details are on the tenant screen', async () => {
        setLang('en');
        const root = await tenants();
        document.getElementById('rentals').insertAdjacentHTML('beforeend', '<div id="rentDialog" hidden><div id="rentDialogBody"></div></div>');
        expect(root.querySelector('[data-tenant="T1"]').textContent).not.toContain('₹8,000/month');
        expect(root.querySelector('#rentTenantFilter').textContent).toBe('Filter');
        root.querySelector('#rentTenantFilter').focus();
        const open = RentalsModule.api.tenantFilters();
        await new Promise(r => setTimeout(r, 0));
        const sheet = () => document.getElementById('rentTenantFilters');
        expect([...sheet().querySelectorAll('.chip')].map(b => b.textContent)).toEqual(['All', 'Owes', 'Late', 'Not in a unit', 'Name', 'Most due', 'Newest']);
        RentalsModule.api.tenantList('filter', 'owes');
        expect([...document.querySelectorAll('#rentalsBody [data-tenant]')].map(e => e.getAttribute('data-tenant'))).toEqual(['T2']);
        expect(sheet().querySelector('[aria-pressed="true"]').textContent).toBe('Owes');
        RentalsModule.api.tenantList('filter', 'all');
        RentalsModule.api.tenantList('sort', 'due');
        expect([...document.querySelectorAll('#rentalsBody [data-tenant]')].map(e => e.getAttribute('data-tenant'))).toEqual(['T2', 'T1']);
        expect(document.querySelector('#rentTenantFilter').textContent).toBe('Filter (1)');
        RentalsModule.api.dialogClose(false);
        await open;
        // Closing the sheet gives focus back to Filter: a pick redraws the list, not the button.
        expect(document.activeElement.id).toBe('rentTenantFilter');
        _test.state.detail = 'T1';
        await _test.render();
        expect(document.getElementById('rentalsBody').textContent).toContain('₹8,000/month, due on day 10');
        _test.state.detail = '';
        // A Back within 300 ms of a closed form only closes the form (rentals.js): don't let the next test's Back be one.
        await new Promise(r => setTimeout(r, 320));
    });

    test('Moved out (N): tenants whose link is still on, folded, for the owner and managers', async () => {
        setLang('en');
        const saved = global.__rentData;
        global.__rentData = { ...saved, tenants: [...DATA.tenants, { id: 'T3', name: 'Hari' }],
            linked: [{ id: 'L9', tenantId: 'T3', unitId: 'U2', status: 'ended', endMonth: '2025-12', shareToken: 'x'.repeat(32) }] };
        try {
            const root = await tenants();
            const more = root.querySelector('details.rent-more[data-rent-moved-out]');
            expect(more.open).toBe(false);
            expect(more.querySelector('summary').textContent).toBe('Moved out (1)');
            expect(more.innerHTML).toContain("rentals.shareLink('L9')");
            rentalsRole.mockReturnValue('member');
            await _test.render();
            expect(document.querySelector('#rentalsBody [data-rent-moved-out]')).toBeNull();
        } finally {
            global.__rentData = saved;
        }
    });
});

describe('Properties and the property screen', () => {
    async function properties() {
        await show('owes');
        _test.state.page = 'properties';
        _test.state.detail = '';
        await _test.render();
        return document.getElementById('rentalsBody');
    }
    afterEach(() => { rentalsRole.mockReturnValue('owner'); _test.state.detail = ''; });

    test('the list: units, how many let and what is owed there; one filled Add property; no inline form', async () => {
        setLang('en');
        const root = await properties();
        expect([...root.querySelectorAll('[data-property]')].map(e => e.getAttribute('data-property'))).toEqual(['P2', 'P1']);
        expect(root.querySelector('[data-property="P1"]').textContent.replace(/\s+/g, ' ')).toContain('3 units · 2 let ₹10,000 owed');
        expect(root.querySelector('[data-property="P2"]').textContent).toContain('1 unit · 0 let');
        expect(root.querySelector('#rentPropName')).toBeNull();
        expect(root.querySelectorAll('.btn-primary').length).toBe(1);
    });

    test('property → tenant → Back returns to the property, Back again to the list; vacant units offer Let out', async () => {
        setLang('en');
        await properties();
        RentalsModule.api.showProperty('P1');
        const root = document.getElementById('rentalsBody');
        expect(root.querySelector('#rentDetailTitle').textContent).toBe('Gupta Bhawan');
        expect(root.querySelector('[data-unit="U2"]').innerHTML).toContain("rentals.addTenantToUnit('U2')");
        expect(root.querySelector('[data-unit="U1"] button.rent-tap').getAttribute('data-onclick')).toBe("rentals.openTenant('T1')");
        expect(root.querySelector('[data-unit="U1"]').innerHTML).not.toContain('archiveUnit');
        RentalsModule.api.openTenant('T1');
        expect(root.querySelector('#rentDetailTitle').textContent).toBe('Ram');
        RentalsModule.api.back();
        await new Promise(r => setTimeout(r, 20));
        expect(root.querySelector('#rentDetailTitle').textContent).toBe('Gupta Bhawan');
        RentalsModule.api.back();
        await new Promise(r => setTimeout(r, 20));
        expect(root.querySelector('#rentDetailTitle')).toBeNull();
        expect(root.querySelector('[data-property="P1"]')).not.toBeNull();
    });

    test('Back that closed a form at a property keeps the chain: tenant → Back → the property', async () => {
        setLang('en');
        await properties();
        document.getElementById('rentals').insertAdjacentHTML('beforeend', '<div id="rentDialog" hidden><div id="rentDialogBody"></div></div>');
        RentalsModule.api.showProperty('P1');
        const p = RentalsModule.api.editProperty('P1');
        // NavigationManager on Back: closes the form, and the screen's entry becomes a copy of the one below.
        RentalsModule.api.dialogClose(false);
        await p;
        history.replaceState({ happaTab: 'rentals' }, '');
        window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
        await new Promise(r => setTimeout(r, 320));
        RentalsModule.api.openTenant('T1');
        RentalsModule.api.back();
        await new Promise(r => setTimeout(r, 20));
        expect(document.getElementById('rentDetailTitle').textContent).toBe('Gupta Bhawan');
    });

    test('the property screen: address and kind, unit size and floor; ⋯ has This month and Expenses (a member too, as before)', async () => {
        setLang('en');
        const saved = global.__rentData;
        global.__rentData = { ...saved, properties: [{ id: 'P1', name: 'Gupta Bhawan', address: 'Civil Lines', kind: 'house' }, DATA.properties[1]],
            units: saved.units.map(u => (u.id === 'U1' ? { ...u, floor: '2', area: 650 } : u)) };
        try {
            const root = await properties();
            expect(root.querySelector('[data-property="P1"]').textContent).not.toContain('Civil Lines');
            RentalsModule.api.showProperty('P1');
            expect(root.querySelector('[data-property-place]').textContent).toBe('Civil Lines · House');
            expect(root.querySelector('[data-unit="U1"]').textContent).toMatch(/Floor: 2 · 650 sq ft/);
            const menu = () => [...root.querySelectorAll('.rent-detail-bar details.rent-menu .rent-menu-list > button')].map(b => b.getAttribute('data-onclick'));
            expect(menu()).toEqual(["rentals.propertyMonth('P1')", "rentals.expenses('P1')", "rentals.editProperty('P1')"]);
            rentalsRole.mockReturnValue('member');
            await _test.render();
            expect(root.innerHTML).toContain("rentals.addUnit('P1')");
            expect(menu()).toEqual(["rentals.propertyMonth('P1')", "rentals.expenses('P1')", "rentals.editProperty('P1')"]);
        } finally {
            global.__rentData = saved;
        }
    });
});

describe('Reports (always a tab)', () => {
    afterEach(() => { rentalsRole.mockReturnValue('owner'); });

    test('the yearly report for the owner and managers; deposits held and each property\'s expenses for every role; no tab without a rentals role', async () => {
        setLang('en');
        await show('owes');
        document.getElementById('rentals').insertAdjacentHTML('afterbegin', '<button id="rentReportsTab" data-rent-page="reports" hidden></button>');
        _test.state.page = 'reports';
        await _test.render();
        const root = document.getElementById('rentalsBody');
        expect(document.getElementById('rentReportsTab').hidden).toBe(false);
        expect([...root.querySelectorAll('[data-onclick]')].map(b => b.getAttribute('data-onclick'))).toEqual([
            'rentals.yearReport()', 'rentals.deposits()', "rentals.expenses('P2')", "rentals.expenses('P1')"
        ]);
        rentalsRole.mockReturnValue('member');
        await _test.render();
        expect(root.innerHTML).not.toContain('yearReport');
        expect(root.innerHTML).toContain('rentals.deposits()');
        expect(document.getElementById('rentReportsTab').hidden).toBe(false);
        rentalsRole.mockReturnValue(null);
        await _test.render();
        expect(_test.state.page).toBe('rent');
        expect(document.getElementById('rentReportsTab').hidden).toBe(true);
    });
});

describe('one view: every former Advanced action is reachable, for the same roles', () => {
    const fs = require('fs');
    const path = require('path');
    const TEMPLATE = fs.readFileSync(path.join(__dirname, '../../templates/rentals.html'), 'utf8');
    const ADVANCED = ['viewBy', 'openProperty', 'filterUnits', 'pay', 'remind', 'receipts', 'addTenantToUnit', 'tenantFilters', 'tenantList',
        'expenses', 'propertyMonth', 'deposits'];
    afterEach(() => { rentalsRole.mockReturnValue('owner'); _test.state.detail = ''; _test.state.openProperty = ''; });

    /** Every rentals.<fn>(…) a person can tap on This month (each View by), Tenants (+ Filter), Properties, a property, Reports and the ⋯ menu. */
    async function reachable() {
        const seen = new Set();
        const take = () => document.querySelectorAll('[data-onclick^="rentals."]').forEach((b) => {
            if (b.closest('[hidden]')) return;
            const m = b.getAttribute('data-onclick').match(/^rentals\.(\w+)\((.*)\)$/);
            seen.add(m[1] === 'settings' ? `settings(${m[2]})` : m[1]);
        });
        document.body.innerHTML = TEMPLATE;
        window.app = { rentals: { ...RentalsModule.api } };
        Object.assign(_test.state, { page: 'rent', detail: '', openProperty: '', month: M });
        ['properties', 'units', 'tenants', 'leases', 'openCharges', 'monthCharges', 'monthPaid', 'monthExpenses'].forEach(k => _test.state.loaded.add(k));
        for (const by of ['owes', 'properties', 'units']) {
            _test.state.by = by;
            await _test.render();
            take();
        }
        _test.state.by = 'properties';
        RentalsModule.api.openProperty('P1');
        take();
        _test.state.openProperty = '';
        for (const page of ['tenants', 'properties', 'reports']) {
            _test.state.page = page;
            await _test.render();
            take();
        }
        const sheet = RentalsModule.api.tenantFilters();
        await new Promise(r => setTimeout(r, 0));
        take();
        RentalsModule.api.dialogClose(false);
        await sheet;
        _test.state.page = 'properties';
        RentalsModule.api.showProperty('P1');
        take();
        return seen;
    }

    test.each([
        ['owner', ['yearReport', 'shareLink', "settings('rentals')", "settings('roles')"], []],
        ['manager', ['yearReport', 'shareLink', "settings('rentals')"], ["settings('roles')"]],
        ['member', ["settings('rentals')"], ['yearReport', 'shareLink', "settings('roles')"]]
    ])('%s', async (role, more, never) => {
        setLang('en');
        AppState.currentUser = { uid: 'u1' };
        rentalsRole.mockReturnValue(role);
        const saved = global.__rentData;
        global.__rentData = { ...saved, tenants: [...DATA.tenants, { id: 'T3', name: 'Hari' }],
            charges: [...saved.charges, { id: 'L9_2025-12', leaseId: 'L9', unitId: 'U2', tenantId: 'T3', tenantName: 'Hari', month: '2025-12', dueDay: 10, amount: 5000, paid: 0, payments: [] }],
            linked: [{ id: 'L9', tenantId: 'T3', unitId: 'U2', status: 'ended', endMonth: '2025-12', shareToken: 'x'.repeat(32) }] };
        try {
            const seen = await reachable();
            expect([...ADVANCED, ...more].filter(fn => !seen.has(fn))).toEqual([]);
            expect(never.filter(fn => seen.has(fn))).toEqual([]);
            expect(document.getElementById('rentReportsTab').hidden).toBe(false);
        } finally {
            global.__rentData = saved;
        }
    });
});
