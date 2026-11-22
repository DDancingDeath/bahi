/**
 * @fileoverview History page review fixes: Purchase | Sale | Wholesale tabs
 * (Wholesale is the Wholesale page's old History tab, F14), old-app
 * carried dues hidden behind a per-tab toggle, one aligned row layout shared
 * with Wholesale's recent bills, and the plain "not updated live" notice.
 */

jest.mock('../firebase/firestore-service.js', () => ({ FirebaseService: { db: null } }));
jest.mock('../services/printer.js', () => ({ PrinterService: {} }));
jest.mock('../services/audit.js', () => ({ AuditService: { log: jest.fn(), ACTIONS: {} } }));
jest.mock('../ui/infinite-scroll.js', () => ({ attachOlderHistoryScroll: jest.fn() }));

import fs from 'fs';
import path from 'path';
import { AppState } from '../utils/state.js';
import { HistoryManager } from '../modules/history.js';
import { WholesaleSalesManager } from '../modules/wholesale-sales.js';
import { HISTORY_TAB_KEY, HISTORY_FILTER_KEY } from '../utils/history-filters.js';
import { BILL_ROW_SLOTS, byNameHtml, paymentChipsHtml } from '../ui/bill-row.js';
import { setLang } from '../i18n/index.js';
import { resolveRoute } from '../ui/navigation.js';
import en from '../i18n/en.js';
import hi from '../i18n/hi.js';

const WWW = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(WWW, rel), 'utf8');

const day = (offset, h = 10) => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate() + offset, h).getTime();
};
const bill = (id, timestamp, extra = {}) => ({
    id, billNumber: id, customerName: `Party ${id}`, timestamp, totalPackets: 2,
    items: [{ name: 'Wheat', qty: 1, rate: 1 }], total: 100, payment: { cash: 100, online: 0, due: 0 }, ...extra
});
const opening = (id, timestamp, amount = 2500) => bill(id, timestamp, {
    items: [], total: 0, totalPackets: undefined, payment: { cash: 0, online: 0, due: amount },
    dueAmount: amount, openingBalance: { migrated: true, amount, billTotal: amount, paidBefore: 0 }
});

const html = `
    <div id="history">
      <div class="history-type-filter">
        <button data-type="purchase"></button><button data-type="sale"></button><button data-type="wholesale" hidden></button>
      </div>
      <select id="historyDatePreset"><option value="all"></option><option value="today"></option>
        <option value="yesterday"></option><option value="week"></option><option value="month"></option>
        <option value="lastMonth"></option><option value="custom"></option></select>
      <div id="historyCustomRange" hidden><input id="historyFromDate"><input id="historyToDate"></div>
      <div id="historyRangeLabel" hidden></div>
      <input id="historySearch" value="">
      <div id="wrap"><div id="historyList"></div></div>
    </div>
    <div id="wholesale-sales">
      <div id="salesRecentList"></div>
    </div>`;

const historyNos = () => [...document.querySelectorAll('#historyList .bill-row__link')].map(s => s.textContent.replace('#', ''));
const recentNos = () => [...document.querySelectorAll('#salesRecentList .bill-row__no [data-onclick]')].map(s => s.textContent.replace('#', ''));

beforeEach(() => {
    document.body.innerHTML = html;
    sessionStorage.clear();
    localStorage.clear();
    Object.assign(HistoryManager, { filter: null, homeTab: null, pageKey: '', viewMode: 'card', showOpening: { purchase: false, sale: false, wholesale: false } });
    delete window.FirebaseService;
    window.app = { nav: { showTab: jest.fn() } };
    AppState.historyLoadedFrom = 0;
    AppState.userRole = 'staff';
    AppState.settings = {};
    AppState.purchaseHistory = [bill('P1', day(0)), opening('P-OLD-1', day(-2)), opening('P-OLD-2', day(-3))];
    AppState.retailSalesHistory = [bill('S20261022-005', day(-1)), opening('S-OLD-1', day(-4))];
    AppState.salesHistory = [bill('W1', day(0, 12), { source: 'sales-tab' }), bill('W2', day(-5)), opening('W-OLD-1', day(-6))];
});

describe('History tabs: Purchase | Sale (retail + wholesale) | Wholesale', () => {
    test('Sale lists retail and wholesale bills with a type tag for a role that may open Wholesale; the tab is remembered', () => {
        AppState.userRole = 'owner';
        HistoryManager.refreshHistory();
        expect(historyNos()).toEqual(['P1']);
        HistoryManager.filterHistory('sale');
        expect(historyNos()).toEqual(['W1', 'S20261022-005', 'W2']);
        const tags = [...document.querySelectorAll('#historyList .bill-type-tag')].map(s => s.textContent);
        expect(tags).toEqual(['Wholesale', 'Retail', 'Wholesale']);
        expect(localStorage.getItem(HISTORY_TAB_KEY)).toBe('sale');

        HistoryManager.filter = null; // app reopened
        sessionStorage.clear();
        HistoryManager.refreshHistory();
        expect(historyNos()).toEqual(['W1', 'S20261022-005', 'W2']);
        expect(document.querySelector('[data-type="sale"]').classList.contains('active')).toBe(true);
    });

    test('a member without Wholesale sees retail bills only in Sale', () => {
        AppState.userRole = 'staff';
        AppState.settings = { roleAccess: { staff: { wholesale: false } } };
        HistoryManager.filterHistory('sale');
        expect(historyNos()).toEqual(['S20261022-005']);
        expect(document.getElementById('historyList').textContent).not.toMatch(/W1|W2/);
        AppState.settings = {};
    });

    test('the whole row opens the bill (one call, not one per nested element)', () => {
        AppState.userRole = 'owner';
        HistoryManager.filterHistory('sale');
        const row = document.querySelector('#historyList [data-bill-row]');
        expect(row.getAttribute('role')).toBe('button');
        expect(row.getAttribute('data-onclick')).toMatch(/^history\.viewBill\('id:W1', 'wholesale'\)$/);
        expect(row.querySelectorAll('[data-onclick]')).toHaveLength(0);
        HistoryManager.toggleView();
        expect([...document.querySelectorAll('#historyList .bill-table__row .bill-type-tag')].map(s => s.textContent))
            .toEqual(['Wholesale', 'Retail', 'Wholesale']);
        HistoryManager.toggleView();
    });

    test('Wholesale lists only wholesale bills (no type tag) and is remembered; its button shows for a role with Wholesale', () => {
        AppState.userRole = 'owner';
        HistoryManager.filterHistory('wholesale');
        expect(historyNos()).toEqual(['W1', 'W2']);
        expect(document.querySelectorAll('#historyList .bill-type-tag')).toHaveLength(0);
        expect(document.querySelector('[data-type="wholesale"]').hidden).toBe(false);
        expect(document.querySelector('[data-type="wholesale"]').getAttribute('aria-pressed')).toBe('true');
        expect(localStorage.getItem(HISTORY_TAB_KEY)).toBe('wholesale');
        expect(window.app.nav.showTab).not.toHaveBeenCalled();

        const row = document.querySelector('#historyList [data-bill-row]');
        expect(row.getAttribute('data-onclick')).toBe("history.viewBill('id:W1', 'wholesale')");
        HistoryManager.toggleView();
        expect([...document.querySelectorAll('#historyList tbody tr.bill-table__row')].map(r => r.querySelector('.bill-table__no').textContent)).toEqual(['#W1', '#W2']);
        HistoryManager.toggleView();

        HistoryManager.filter = null; // app reopened, or an old saved filter
        sessionStorage.setItem(HISTORY_FILTER_KEY, JSON.stringify({ type: 'wholesale', preset: 'all' }));
        HistoryManager.refreshHistory();
        expect(historyNos()).toEqual(['W1', 'W2']);
        expect(resolveRoute('wholesale-history')).toEqual({ id: 'wholesale-history', tab: 'history', section: 'wholesale', needs: 'wholesale-sales', nav: 'history' });
    });

    test('NEW-01: Wholesale bills shows the Wholesale tab for that visit only; a plain visit is back on the remembered tab', () => {
        AppState.userRole = 'owner';
        const shown = () => document.querySelector('.history-type-filter [aria-pressed="true"]')?.dataset.type;
        HistoryManager.open('wholesale');
        expect(shown()).toBe('wholesale');
        expect(historyNos()).toEqual(['W1', 'W2']);
        expect(localStorage.getItem(HISTORY_TAB_KEY)).toBeNull();
        HistoryManager.setDatePreset('all');
        expect(JSON.parse(sessionStorage.getItem(HISTORY_FILTER_KEY)).type).toBe('purchase');
        HistoryManager.open(null);
        expect(shown()).toBe('purchase');
        expect(historyNos()).toEqual(['P1']);

        HistoryManager.filterHistory('sale');
        HistoryManager.open('wholesale');
        HistoryManager.filter = null; // app reopened during the link's visit
        HistoryManager.homeTab = null;
        HistoryManager.open(null);
        expect(shown()).toBe('sale');

        // The Wholesale tab tapped on History itself is remembered, as before
        HistoryManager.open('wholesale');
        HistoryManager.filterHistory('wholesale');
        HistoryManager.open(null);
        expect(shown()).toBe('wholesale');
        expect(localStorage.getItem(HISTORY_TAB_KEY)).toBe('wholesale');
    });

    test('a member without Wholesale gets Sale (retail only) for a remembered Wholesale tab, and no Wholesale button', () => {
        AppState.userRole = 'staff';
        AppState.settings = { roleAccess: { staff: { wholesale: false } } };
        localStorage.setItem(HISTORY_TAB_KEY, 'wholesale');
        HistoryManager.refreshHistory();
        expect(historyNos()).toEqual(['S20261022-005']);
        expect(document.querySelector('[data-type="wholesale"]').hidden).toBe(true);
        expect(document.querySelector('[data-type="sale"]').getAttribute('aria-pressed')).toBe('true');
        AppState.settings = {};
    });

    test('tab labels: Purchase | Sale | Wholesale in English, खरीद | बिक्री | थोक in Hindi', () => {
        const tpl = read('templates/history.html');
        const keys = [...tpl.matchAll(/data-type="(?:purchase|sale|wholesale)"[^>]*>.*?data-i18n="([^"]+)"/g)].map(m => m[1]);
        expect(keys).toEqual(['ui.history.tab_purchase', 'ui.history.tab_sale', 'ui.history.tab_wholesale']);
        expect(keys.map(k => en[k])).toEqual(['Purchase', 'Sale', 'Wholesale']);
        expect(keys.map(k => hi[k])).toEqual(['खरीद', 'बिक्री', 'थोक']);
        expect(tpl).not.toMatch(/data-type="(all|retail)"/);
    });
});

describe('old-app carried dues in History', () => {
    test('hidden by default; the toggle shows N for the tab and reveals them as a separate group', () => {
        HistoryManager.refreshHistory();
        expect(historyNos()).toEqual(['P1']);
        const chip = document.getElementById('historyOpeningToggle');
        expect(chip.textContent).toBe('Show dues carried from old app (2)');
        expect(chip.getAttribute('aria-pressed')).toBe('false');

        chip.click();
        const group = document.querySelector('#historyList .bill-group--opening');
        expect([...group.querySelectorAll('.bill-row__link')].map(s => s.textContent)).toEqual(['#P-OLD-1', '#P-OLD-2']);
        expect(group.querySelectorAll('.old-app-chip')).toHaveLength(2);
        expect(document.getElementById('historyOpeningToggle').textContent).toBe('Hide dues carried from old app (2)');

        // Per tab: Sale still hides its one opening record
        HistoryManager.filterHistory('sale');
        expect(document.querySelector('#historyList .bill-group--opening')).toBeNull();
        expect(document.getElementById('historyOpeningToggle').textContent).toBe('Show dues carried from old app (1)');
    });

    test('search finds them only when the toggle is on', () => {
        document.getElementById('historySearch').value = 'P-OLD-2';
        HistoryManager.refreshHistory();
        expect(historyNos()).toEqual([]);
        expect(document.getElementById('historyOpeningToggle').textContent).toContain('(1)');
        HistoryManager.toggleOpenings();
        expect(historyNos()).toEqual(['P-OLD-2']);
    });

    test('Table View groups them the same way', () => {
        HistoryManager.viewMode = 'table';
        HistoryManager.refreshHistory();
        expect(document.querySelectorAll('#historyList tr.is-opening')).toHaveLength(0);
        HistoryManager.toggleOpenings();
        expect(document.querySelectorAll('#historyList tr.is-opening')).toHaveLength(2);
        expect(document.querySelector('#historyList .bill-table__group').textContent).toBe('Dues carried from the old app');
    });
});

describe('aligned bill row', () => {
    const slots = (row) => [...row.querySelectorAll('[class^="bill-row__"]')]
        .map(el => el.className.split(' ')[0].replace('bill-row__', ''))
        .filter(s => BILL_ROW_SLOTS.includes(s));

    test('every row has the same slots in column order; chips have their own slot', () => {
        HistoryManager.toggleOpenings();
        const rows = [...document.querySelectorAll('#historyList [data-history-item]')];
        expect(rows.length).toBe(3);
        rows.forEach(row => {
            expect(row.hasAttribute('data-bill-row')).toBe(true);
            expect(slots(row)).toEqual(['no', 'party', 'amount', 'date', 'items', 'chips']);
        });
        const old = rows.find(r => r.classList.contains('is-opening'));
        // The "Old app" chip sits in the chips slot, never next to the amount.
        expect(old.querySelector('.bill-row__chips .old-app-chip')).not.toBeNull();
        expect(old.querySelector('.bill-row__amount').textContent).toBe('₹2,500');
    });

    test('the Due tag is amber (never plain like Cash, U-73), orange-amber after 30 days and red after 90', () => {
        const DAY = 86400000;
        const tone = (days) => {
            const el = document.createElement('div');
            el.innerHTML = paymentChipsHtml({ id: 'x', timestamp: Date.now() - days * DAY, payment: { total: 100, cash: 40, online: 0, due: 60 } });
            const due = el.querySelector('.payment-due');
            return ['warn', 'neg'].find(c => due.classList.contains(c)) || 'ink';
        };
        expect([tone(2), tone(45), tone(120)]).toEqual(['warn', 'warn', 'neg']);
    });

    test('NEW-14: the chips read "Online ₹…", "Cash ₹…", "Due ₹…" (no colon), in Hindi too', () => {
        const chips = () => {
            const el = document.createElement('div');
            el.innerHTML = paymentChipsHtml({ id: 'x', timestamp: Date.now(), payment: { total: 300, cash: 100, online: 11521, due: 50 } });
            return [...el.querySelectorAll('.payment-badge')].map(c => c.textContent);
        };
        expect(chips()).toEqual(['Online ₹11,521', 'Cash ₹100', 'Due ₹50']);
        setLang('hi');
        expect(chips()).toEqual(['ऑनलाइन ₹11,521', 'नकद ₹100', 'बकाया ₹50']);
        setLang('en');
    });

    test('the Wholesale page\'s recent bills use the same row component', () => {
        WholesaleSalesManager.renderSalesHistory();
        expect(recentNos()).toEqual(['W1', 'W2']);
        const row = document.querySelector('#salesRecentList [data-history-item]');
        expect(row.hasAttribute('data-bill-row')).toBe(true);
        expect(slots(row)).toEqual(['no', 'party', 'amount', 'date', 'items', 'chips']);
        expect(row.getAttribute('data-type')).toBe('wholesale');
        for (const mod of ['js/modules/history.js', 'js/modules/wholesale-sales.js']) {
            expect(read(mod)).toMatch(/import \{[^}]*buildBillRow[^}]*\} from '\.\.\/ui\/bill-row\.js'/);
        }
    });

    test('History › Wholesale: old-app dues behind the toggle, search and Table View work', () => {
        AppState.userRole = 'owner';
        HistoryManager.filterHistory('wholesale');
        expect(document.getElementById('historyOpeningToggle').textContent).toBe('Show dues carried from old app (1)');
        document.getElementById('historyOpeningToggle').click();
        expect(historyNos()).toEqual(['W-OLD-1', 'W1', 'W2']);
        document.getElementById('historySearch').value = 'W2';
        HistoryManager.refreshHistory();
        expect(historyNos()).toEqual(['W2']);
        HistoryManager.toggleView();
        expect([...document.querySelectorAll('#historyList tbody tr.bill-table__row')].map(r => r.querySelector('.bill-table__no').textContent)).toEqual(['#W2']);
    });

    test('CSS: the bill number never wraps; amounts are right-aligned; desktop uses six fixed columns', () => {
        const css = read('css/history.css');
        const rule = (src, sel) => {
            const m = src.match(new RegExp(`(^|\\n)\\s*([^{}]*\\${sel}[^{}]*)\\{([^}]*)\\}`, 'g')) || [];
            return m.join('\n');
        };
        const noRule = rule(css, '.bill-row__no');
        expect(noRule).toMatch(/white-space:\s*nowrap/);
        expect(noRule).toMatch(/text-overflow:\s*ellipsis/);
        expect(rule(css, '.bill-row__amount')).toMatch(/text-align:\s*right/);
        expect(rule(css, '.bill-table__no')).toMatch(/white-space:\s*nowrap/);

        const desktop = read('css/desktop.css');
        const grid = desktop.match(/\[data-history-item]\[data-bill-row]\s*\{([^}]*)\}/)[1];
        const cols = grid.match(/grid-template-columns:\s*([^;]+);/)[1].trim().split(/\s+(?![^(]*\))/);
        expect(cols).toHaveLength(6);
        expect(desktop).not.toMatch(/bill-row__no[^{]*\{[^}]*white-space:\s*(normal|pre-wrap)/);
    });
});

describe('History › Wholesale respects the role\'s History "days back" limit', () => {
    const DAY = 24 * 60 * 60 * 1000;
    afterEach(() => {
        AppState.userRole = undefined;
        AppState.settings = {};
    });

    test.each([['manager'], ['staff']])('%s with historyDays: older bills hidden, no older months loaded', async (role) => {
        AppState.userRole = role;
        AppState.settings = { roleAccess: { [role]: { historyDays: 3, wholesale: true } } };
        const windowStart = Date.now() - DAY; // loaded window is newer than the cutoff
        window.FirebaseService = {
            getHistoryWindowStart: () => windowStart,
            isFullHistoryLoaded: () => false,
            ensureHistoryFrom: jest.fn(() => new Promise(() => {}))
        };

        HistoryManager.filterHistory('wholesale');
        expect(historyNos()).toEqual(['W1']);
        expect(document.getElementById('historyOpeningToggle')).toBeNull(); // W-OLD-1 is 6 days old
        WholesaleSalesManager.renderSalesHistory();
        expect(recentNos()).toEqual(['W1']);

        // A custom range back to 2020 only loads from the cutoff, never older months.
        await HistoryManager.applyCustomRange('2020-01-01', '');
        await new Promise(r => setTimeout(r, 0));
        const calls = window.FirebaseService.ensureHistoryFrom.mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        calls.forEach(([from]) => {
            expect(from).toBeGreaterThanOrEqual(Date.now() - 3 * DAY - 60000);
            expect(from).toBeLessThan(windowStart);
        });
    });

    test('no limit for the owner: every wholesale bill shows', () => {
        AppState.userRole = 'owner';
        HistoryManager.filterHistory('wholesale');
        expect(historyNos()).toEqual(['W1', 'W2']);
    });
});

describe('"By {name}" on bill rows', () => {
    afterEach(() => setLang('en'));

    test('the name is escaped, wrapped in <strong> unless asked not to, and placed where the language puts it', () => {
        expect(byNameHtml('<b>Ram</b> $&')).toBe('By <strong>&lt;b&gt;Ram&lt;/b&gt; $&amp;</strong>');
        expect(byNameHtml('Ram', false)).toBe('By Ram');
        setLang('hi');
        expect(byNameHtml('Ram')).toBe('<strong>Ram</strong> द्वारा');
    });
});
