/**
 * Today layout (owner review, Nov 2026): Money now (hero, Cash in drawer, compact tiles), Needs attention (Day report,
 * Reminders), Settle today (Labour, Dues today), Details (Items, Today's bills); one-line rows closed by default and
 * remembered per phone; at ≥ 1280 px a left and a right column with open panels. Figures are todaySummary()'s.
 */
import fs from 'fs';
import path from 'path';
import { jest } from '@jest/globals';
import { DayManager } from '../modules/day.js';
import { CashManagementManager } from '../modules/cash-management.js';
import { AnomaliesManager } from '../modules/anomalies.js';
import { HealthManager } from '../modules/health.js';
import { UIManager } from '../ui/ui-manager.js';
import { BottomNav } from '../ui/bottom-nav.js';
import { AppState } from '../utils/state.js';
import { todayLocalISO, formatDate } from '../utils/dates.js';
import { closedCount } from '../utils/calc/cash.js';
import { itemRows } from '../utils/calc/today.js';

const TEMPLATE = fs.readFileSync(path.resolve(__dirname, '../../templates/day.html'), 'utf8');
const NOW = new Date(2026, 10, 23, 18, 0, 0);
const at = (h, m = 0) => new Date(2026, 10, 23, h, m).toISOString();

beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    jest.setSystemTime(NOW);
    localStorage.clear();
    document.body.innerHTML = TEMPLATE;
    jest.spyOn(AnomaliesManager, 'renderDayReport').mockImplementation(() => {});
    jest.spyOn(HealthManager, 'todayAlerts').mockResolvedValue([]);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    AppState.userRole = 'owner';
    AppState.settings = { laborRate: 6, labourPackageKg: 35 };
    AppState.purchaseHistory = [{ id: 'p1', billNumber: 'P-1', date: at(9), grandTotal: 1000, laborCharges: 12,
        items: [{ name: 'Wheat', qty: 40, rate: 25, total: 1000 }], payment: { cash: 1000, online: 0, due: 0 } }];
    AppState.retailSalesHistory = [{ id: 'r1', billNumber: 'S-1', date: at(10), total: 300, items: [{ name: 'Wheat', qty: 10, rate: 30, total: 300 }], payment: { cash: 100, online: 100, due: 100 } }];
    AppState.salesHistory = [{ id: 'w1', billNumber: 'W-1', date: at(11), total: 500, items: [{ name: 'Rice', qty: 20, rate: 25, total: 500 }], payment: { cash: 500, online: 0, due: 0 } }];
    AppState.expensesHistory = [];
    CashManagementManager.todaySession = null;
    DayManager.daySessions = { date: null, list: [] };
    DayManager.wideToday = null;
});
afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    ['purchaseHistory', 'salesHistory', 'retailSalesHistory', 'expensesHistory'].forEach(k => { AppState[k] = []; });
    AppState.userRole = null;
    CashManagementManager.todaySession = null;
    DayManager.daySessions = { date: null, list: [] };
    DayManager.wideToday = null;
});

const ids = (sel) => [...document.querySelectorAll(sel)].map(e => e.id || e.className);
const expanded = (id) => document.getElementById(`${id}Toggle`)?.getAttribute('aria-expanded');

describe('order and groups (phone)', () => {
    test('Money now (hero, drawer, tiles) → Needs attention (Day report, Reminders) → Settle today → Details', () => {
        DayManager.loadTodayData();
        const order = ids('#dayTodayContent .hero, #todayDrawer, #dayTodayContent .today-metrics, #todayAttentionTitle, #dayReportCard, #todayReminders, #todaySettleTitle, #todayLabourToggle, #todayDuesToggle, #todayDetailsTitle, #todayItemsToggle, #todayBillsLink');
        expect(order).toEqual(['hero', 'todayDrawer', 'panel metrics today-metrics', 'todayAttentionTitle', 'dayReportCard', 'todayReminders',
            'todaySettleTitle', 'todayLabourToggle', 'todayDuesToggle', 'todayDetailsTitle', 'todayItemsToggle', 'todayBillsLink']);
        expect(['todayAttentionTitle', 'todaySettleTitle', 'todayDetailsTitle'].map(id => document.getElementById(id).textContent))
            .toEqual(['Needs attention', 'Settle today', 'Details']);
        // Gone: the Transactions heading, Day details, the cash prompt and the Payment breakdown section
        expect(document.querySelector('#todayMore, #todayCashPrompt, #todayPayBlock, [data-i18n="ui.today.transactions"], [data-i18n="ui.today.payment_breakdown"]')).toBeNull();
    });

    test('tiles: the count on the label line, Purchases / Sales open the split sheet', () => {
        DayManager.loadTodayData();
        const label = (id) => document.getElementById(id).closest('.metric-label').textContent.replace(/\s+/g, ' ').trim();
        expect(label('todayPurchaseCount')).toBe('Purchases1');
        expect(label('todaySaleCount')).toBe('Sales2');
        expect(document.querySelectorAll('.today-metrics > .metric > .metric-sub')).toHaveLength(0);
        expect([...document.querySelectorAll('[data-split-tile]')].map(t => t.dataset.onclick)).toEqual(["day.showSplit('purchase')", "day.showSplit('sale')"]);
    });

    test('Labour, Dues today and Items are one-line rows, closed by default; the choice is remembered per phone', () => {
        DayManager.loadTodayData();
        ['todayLabour', 'todayDues', 'todayItems'].forEach(id => {
            expect(expanded(id)).toBe('false');
            expect(document.getElementById(`${id}Toggle`).closest('.disclosure').classList.contains('disclosure-line')).toBe(true);
        });
        expect(document.querySelector('#todayDuesToggle .disclosure-summary').textContent.replace(/\s+/g, ' ')).toBe('Get ₹100 · Pay ₹0');
        localStorage.setItem('happa.open.today-items', '1');
        localStorage.setItem('happa.open.today-dues', '1');
        DayManager.loadTodayData();
        expect([expanded('todayLabour'), expanded('todayDues'), expanded('todayItems')]).toEqual(['false', 'true', 'true']);
    });

    test('Dues today open: collected, paid off, new to collect, new to pay, then Open dues', () => {
        DayManager.loadTodayData();
        const rows = [...document.querySelectorAll('#todayDuesBody .row')].map(r => r.textContent.replace(/\s+/g, ' ').trim());
        expect(rows).toEqual(['Collected₹0', 'Paid off₹0', 'New to collect₹100', 'New to pay₹0']);
        expect(document.querySelector('#todayDuesBody .today-links .btn').dataset.onclick).toBe("nav.showTab('due', event)");
        // Labour: History › (Money › Labour) for those who may open it, then Details ›
        expect([...document.querySelectorAll('#todayLabourBody .today-links .btn')].map(b => b.dataset.onclick)).toEqual(["nav.showTab('money-labour')", 'day.showLabourBreakdown()']);
        AppState.userRole = 'staff';
        DayManager.loadTodayData();
        expect(document.getElementById('todayLabourHistory')).toBeNull();
    });

    test('Today\'s bills: one row with the count, opening History on Today; wholesale only for roles with Wholesale', () => {
        DayManager.loadTodayData();
        const row = document.getElementById('todayBillsLink');
        expect([row.textContent.trim(), row.dataset.onclick]).toEqual(["Today's bills3", "nav.showTab('history-today', event)"]);
        expect(document.getElementById('todayWholesaleItems')).not.toBeNull();
        AppState.userRole = 'staff';
        DayManager.loadTodayData();
        expect(document.getElementById('todayBillsCount').textContent).toBe('2');
        expect(document.getElementById('todayWholesaleItems')).toBeNull();
    });

    test('Total in / Total out open the cash and online sheet (no Payment breakdown panel on a phone)', () => {
        const sheet = jest.spyOn(UIManager, 'showModalWithHtml').mockResolvedValue(true);
        DayManager.loadTodayData();
        expect([...document.querySelectorAll('.today-inout > button')].map(b => b.dataset.onclick)).toEqual(['day.showInOut()', 'day.showInOut()']);
        DayManager.showInOut();
        const [html, title] = sheet.mock.calls.at(-1);
        expect(title).toBe('Cash and online');
        const box = document.createElement('div');
        box.innerHTML = html;
        expect([...box.querySelectorAll('.row')].map(r => r.textContent.trim())).toEqual(['Cash in₹600', 'Online in₹100', 'Cash out₹1,000', 'Online out₹0']);
        expect(box.querySelector('.tone-pos .i, .i.tone-pos')).not.toBeNull();
        expect(box.querySelector('.i.tone-out')).not.toBeNull();
    });
});

describe('Cash in drawer row', () => {
    const drawer = () => document.getElementById('todayDrawer');
    const text = () => drawer().textContent.replace(/\s+/g, ' ').trim();

    test('hidden until the day\'s sessions are known; none open: "Drawer not open" with Open cash', () => {
        DayManager.renderDrawer(todayLocalISO());
        expect(drawer().hidden).toBe(true);
        DayManager.daySessions = { date: todayLocalISO(), list: [] };
        DayManager.renderDrawer(todayLocalISO());
        expect(drawer().hidden).toBe(false);
        expect(text()).toBe('Drawer not openOpen cash');
        expect(drawer().querySelector('.btn').dataset.onclick).toBe("day.showSubTab('cash')");
    });

    test('open: since when, and the cash that should be in the drawer, from the session already loaded', () => {
        const day = todayLocalISO();
        CashManagementManager.todaySession = { id: 's1', date: day, openingBalance: 5000, signInTime: new Date(2026, 10, 23, 8, 45).toISOString() };
        DayManager.loadTodayData();
        expect(drawer().dataset.state).toBe('open');
        expect(text()).toBe('Cash in drawersince 8:45 am₹4,600');
        expect(drawer().querySelector('button.row').dataset.onclick).toBe("day.showSubTab('cash')");
    });

    test('closed: the count in colour (short red, extra amber, matches green)', () => {
        const day = todayLocalISO();
        DayManager.daySessions = { date: day, list: [] };
        CashManagementManager.todaySession = { id: 's1', date: day, signedOut: true, difference: -62 };
        DayManager.renderDrawer(day);
        expect([drawer().dataset.state, drawer().querySelector('.row-amt').className, drawer().querySelector('.row-amt').textContent]).toEqual(['short', 'row-amt tone-neg', '₹62 short']);
        CashManagementManager.todaySession = { id: 's1', date: day, signedOut: true, difference: 40 };
        DayManager.renderDrawer(day);
        expect(drawer().querySelector('.row-amt').className).toBe('row-amt tone-warn');
        CashManagementManager.todaySession = { id: 's1', date: day, signedOut: true, difference: 0.4 };
        DayManager.renderDrawer(day);
        expect([drawer().dataset.state, drawer().querySelector('.row-amt').textContent]).toEqual(['match', 'Matches']);
        expect(closedCount({ signedOut: false })).toBeNull();
    });
});

describe('desktop ≥ 1280 px', () => {
    test('right column: drawer, Needs attention, Settle today (open .panel-float), Cash and online; left: tiles, Items (open), bills', () => {
        const listeners = [];
        const mql = { matches: false, addEventListener: (_, fn) => listeners.push(fn) };
        const saved = window.matchMedia;
        window.matchMedia = jest.fn(() => mql);
        try {
            DayManager.daySessions = { date: todayLocalISO(), list: [] };
            DayManager.watchWideToday();
            DayManager.loadTodayData();
            expect(document.getElementById('todayDrawer').nextElementSibling.classList.contains('today-metrics')).toBe(true);
            mql.matches = true;
            listeners.forEach(fn => fn());
            const side = document.querySelector('.today-side');
            expect([...side.children].map(e => e.id || e.className)).toEqual(['todayDrawer', 'today-group today-attention', 'today-group', 'todayCashOnline']);
            expect(ids('#todaySettle > .panel-float')).toEqual(['todayLabourCard', 'todayDuesCard']);
            expect(document.querySelector('#todaySettle .disclosure-toggle')).toBeNull();
            expect(document.querySelector('#todayCashOnlineCard > .panel-legend').textContent).toBe('Cash and online');
            const main = document.querySelector('.today-main:not(.today-main-top)');
            expect(document.getElementById('todayDetailsTitle').textContent).toBe('Items');
            expect([...main.querySelectorAll('.today-items-grid .panel-float')].map(p => p.dataset.items)).toEqual(['purchase', 'retail', 'wholesale']);
            expect(document.getElementById('todayItemsToggle')).toBeNull();
            expect(main.querySelector('#todayBillsLink')).not.toBeNull();
            mql.matches = false;
            listeners.forEach(fn => fn());
            expect(document.getElementById('todayDrawer').nextElementSibling.classList.contains('today-metrics')).toBe(true);
            expect(expanded('todayLabour')).toBe('false');
        } finally {
            window.matchMedia = saved;
        }
    });
});

describe('app bar and refresh', () => {
    test('Today: the date beside the title and a refresh button (shown on a desktop by CSS); other pages neither', () => {
        document.body.innerHTML = '<header class="app-bar"><h1 id="appBarTitle"></h1><span id="appBarDate" hidden></span><button id="appBarRefresh" hidden></button></header>';
        BottomNav.setTitle('day');
        expect(document.getElementById('appBarTitle').textContent).toBe('Today');
        expect([document.getElementById('appBarDate').hidden, document.getElementById('appBarDate').textContent]).toEqual([false, 'Mon, 23 Nov']);
        expect(document.getElementById('appBarRefresh').hidden).toBe(false);
        BottomNav.setTitle('history');
        expect([document.getElementById('appBarDate').hidden, document.getElementById('appBarRefresh').hidden]).toEqual([true, true]);
    });

    test('pull-to-refresh / the refresh button reload Today and rescan the Day report (no refresh icon on the report)', async () => {
        const rescan = jest.spyOn(AnomaliesManager, 'refreshNow').mockResolvedValue(undefined);
        const init = jest.spyOn(DayManager, 'init').mockImplementation(() => {});
        await DayManager.refresh();
        expect(init).toHaveBeenCalledTimes(1);
        expect(rescan).toHaveBeenCalledTimes(1);
        // A member has no Day report: no server scan (its reads would be refused)
        AppState.userRole = 'staff';
        await DayManager.refresh();
        expect(init).toHaveBeenCalledTimes(2);
        expect(rescan).toHaveBeenCalledTimes(1);
    });

    test('a redraw keeps the focus on the row or button that had it', () => {
        DayManager.loadTodayData();
        document.getElementById('todayBillsLink').focus();
        DayManager.loadTodayData();
        expect(document.activeElement.id).toBe('todayBillsLink');
        document.querySelector('#todayLabourBody [data-onclick="day.showLabourBreakdown()"]').focus();
        DayManager.loadTodayData();
        expect(document.activeElement.dataset.onclick).toBe('day.showLabourBreakdown()');
    });
});

test('a data change redraws Today only while its Today sub-tab shows', () => {
    const { emit, REFRESH } = require('../utils/events.js');
    const draw = jest.spyOn(DayManager, 'loadTodayData').mockImplementation(() => {});
    DayManager.currentSubTab = 'today';
    emit(REFRESH.today);
    expect(draw).toHaveBeenCalledTimes(1);
    DayManager.currentSubTab = 'cash';
    emit(REFRESH.today);
    expect(draw).toHaveBeenCalledTimes(1);
    DayManager.currentSubTab = 'today';
});

test('T17 itemRows: lines and bills per item (×N counts bills, a bill with the item twice counts once)', () => {
    const rows = itemRows([
        { items: [{ name: 'Wheat', qty: 10, total: 260 }, { name: 'Wheat', qty: 5, total: 130 }] },
        { items: [{ name: 'Wheat', qty: 5, total: 130 }, { name: 'Rice', qty: 2, total: 80 }] }
    ]);
    expect(rows.map(r => [r.name, r.count, r.bills, r.quantity, r.totalValue])).toEqual([['Wheat', 3, 2, 20, 520], ['Rice', 1, 1, 2, 80]]);
});

test('the date beside Today: weekday, day and month in the app language', () => {
    expect(formatDate(new Date(2026, 10, 23), 'weekday', { lang: 'en' })).toBe('Mon, 23 Nov');
    expect(formatDate(new Date(2026, 10, 23), 'weekday', { lang: 'hi' })).toBe('सोम, 23 नवंबर');
});
