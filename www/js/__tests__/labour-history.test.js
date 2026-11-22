/**
 * @fileoverview Money › Labour (docs/calculations.md LH1–LH3): each day's figures equal the Today Labour card's,
 * the running balance, Money's period, owner / manager only, the day sheet and no extra reads.
 */
import fs from 'fs';
import path from 'path';
import { labourDays, labourBalance } from '../utils/calc/labour-days.js';
import { todaySummary } from '../utils/calc/today.js';
import { MoneyManager } from '../modules/money.js';
import { DayManager } from '../modules/day.js';
import { AnomaliesManager } from '../modules/anomalies.js';
import { CashManagementManager } from '../modules/cash-management.js';
import { FirebaseService } from '../firebase/firestore-service.js';
import { UIManager } from '../ui/ui-manager.js';
import { AppState } from '../utils/state.js';
import { canOpenSection } from '../utils/role-access.js';
import { setInsightsContext, resetInsightsContextForTests } from '../utils/insights-context.js';
import { applyTranslations, setLang, resetLangForTests } from '../i18n/index.js';

const ROOT = path.resolve(__dirname, '../../..');
const MONEY = fs.readFileSync(path.join(ROOT, 'www/templates/money.html'), 'utf8');
const DAY = fs.readFileSync(path.join(ROOT, 'www/templates/day.html'), 'utf8');
const SETTINGS = { laborRate: 6, labourPackageKg: 35 };
// Wednesday 25 Nov 2026, noon: this week is Mon 23 – Wed 25
const NOW = new Date(2026, 10, 25, 12, 0, 0);

const line = (qty, packets = 0) => ({ name: 'Wheat', qty, rate: 25, total: qty * 25, weights: Array(packets).fill(packets ? qty / packets : 0) });
const purchase = (id, day, items, laborCharges, extra = {}) => ({ id, date: `2026-11-${day}T10:00:00`, items, laborCharges, ...extra });
const wage = (id, day, amount, extra = {}) => ({ id, date: `2026-11-${day}`, type: 'Labour', amount, ...extra });

function data() {
    AppState.purchaseHistory = [
        purchase('p1', 25, [line(600, 12)], 72, { billNumber: 'P1', customerName: 'Ram <b>Lal</b>' }),
        purchase('p2', 25, [line(400, 8)], 0, { billNumber: 'P2', customerName: 'Shyam' }),
        purchase('p3', 23, [line(35, 1)], 6, { billNumber: 'P3', customerName: 'Mohan' }),
        purchase('p4', '02', [line(70, 2)], 12, { billNumber: 'P4', customerName: 'Old' }),
        { ...purchase('o1', 25, [line(500, 10)], 60), openingBalance: { amount: 900 } }
    ];
    AppState.expensesHistory = [
        wage('e1', 25, 100, { remarks: 'Evening gang' }),
        wage('e2', 23, 30),
        { id: 'e3', date: '2026-11-25', type: 'Tea', amount: 40 },
        wage('e4', 24, 500, { voided: true }),
        wage('e5', '02', 12)
    ];
    AppState.salesHistory = [];
    AppState.retailSalesHistory = [];
    AppState.withdrawalsHistory = [];
    AppState.stockAdjustments = [];
    AppState.items = [];
    AppState.historyLoadedFrom = 0;
    AppState.settings = { ...SETTINGS };
}

beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    jest.setSystemTime(NOW);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(FirebaseService, 'personalRowsLoaded').mockReturnValue(true);
    jest.spyOn(FirebaseService, 'loadWorthAccounts').mockResolvedValue({});
    data();
    AppState.userRole = 'owner';
    resetInsightsContextForTests();
    MoneyManager.snapshots = {};
    MoneyManager.snapshotsLoaded = true;
    MoneyManager.sessionCache = new Map();
    MoneyManager.section = 'profit';
    MoneyManager.summaryCache = { sig: null, map: new Map(), computed: 0 };
});
afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    resetLangForTests();
});

const openMoney = (preset = 'this-week', lang = 'en') => {
    document.body.innerHTML = MONEY;
    document.getElementById('money').classList.add('active');
    setLang(lang, { store: null });
    applyTranslations(document);
    setInsightsContext({ preset });
    MoneyManager.init('labour');
};
const cells = () => [...document.querySelectorAll('#lhDays tbody tr')].map(tr => [...tr.children].map(c => c.textContent.trim()));
const text = (id) => document.getElementById(id).textContent.replace(/\s+/g, ' ').trim();

describe('labourDays (LH1–LH3)', () => {
    const week = { from: new Date(2026, 10, 23).getTime(), to: new Date(2026, 10, 30).getTime() };

    test('a day is the Today Labour card of that day: same function, same figures', () => {
        const h = labourDays({ purchases: AppState.purchaseHistory, expenses: AppState.expensesHistory, settings: SETTINGS, ...week });
        ['2026-11-25', '2026-11-23'].forEach(key => {
            const today = todaySummary({ bills: { purchase: AppState.purchaseHistory }, expenses: AppState.expensesHistory, settings: SETTINGS, today: new Date(`${key}T15:00:00`) }).labour;
            const day = h.days.find(d => d.key === key);
            expect(day.deducted).toEqual(today.deducted);
            expect(day.toPay).toEqual(today.toPay);
            expect(day.paid).toEqual(today.paid);
        });
    });

    test('days with activity only, newest first; voided, non-labour and opening records left out', () => {
        const h = labourDays({ purchases: AppState.purchaseHistory, expenses: AppState.expensesHistory, settings: SETTINGS, ...week });
        expect(h.days.map(d => [d.key, d.deducted.amount, d.toPay.amount, d.paid.amount, d.balance.difference])).toEqual([
            ['2026-11-25', 72, 174, 100, 74],
            ['2026-11-23', 6, 6, 30, -24]
        ]);
        expect(h.days[0].labourExpenses.map(e => e.id)).toEqual(['e1']);
        expect(h.totals).toEqual({ deducted: 78, toPay: 180, paid: 130, balance: { difference: 50, amount: 50, kind: 'owed' } });
    });

    test('the running balance: owed, paid extra, or matching within 50 paise', () => {
        expect(labourBalance(180, 130)).toEqual({ difference: 50, amount: 50, kind: 'owed' });
        expect(labourBalance(100, 124)).toEqual({ difference: -24, amount: 24, kind: 'extra' });
        expect(labourBalance(100, 99.6).kind).toBe('same');
    });
});

describe('Money › Labour', () => {
    test('header totals, balance and one row per day; numbers right-aligned, true minus', () => {
        openMoney('this-week');
        expect(document.getElementById('moneyLabourHistory').hidden).toBe(false);
        expect(text('lhDeducted')).toBe('₹78');
        expect(text('lhEst')).toBe('₹180');
        expect(text('lhPaid')).toBe('₹130');
        expect(text('lhBalance')).toBe('Balance +₹50');
        expect(document.querySelector('#lhBalance strong').className).toBe('tone-warn');
        expect(cells()).toEqual([
            ['25 Nov', '₹72', '₹174', '₹100', '+₹74'],
            ['23 Nov', '₹6', '₹6', '₹30', '−₹24']
        ]);
        expect(document.querySelectorAll('#lhDays tbody td:not(.num)')).toHaveLength(0);
        // numbers only: no sentences, and the ± column is a plain signed number
        expect(document.querySelector('#moneyLabourHistory').textContent).not.toMatch(/more|less|owed|extra|than/i);
        expect(document.querySelector('#lhDays tbody [class*="tone-"]')).toBeNull();
        // compare & share is for the other tabs
        expect(document.getElementById('moneyCmpToggle').hidden).toBe(true);
    });

    test('paid extra over the period: the true minus, in green', () => {
        AppState.expensesHistory.push(wage('e6', 24, 100));
        openMoney('this-week');
        expect(text('lhBalance')).toBe('Balance −₹50');
        expect(document.querySelector('#lhBalance strong').className).toBe('tone-pos');
        expect(cells()[1]).toEqual(['24 Nov', '₹0', '₹0', '₹100', '−₹100']);
    });

    test('a day equals the Today Labour card on screen', () => {
        document.body.innerHTML = DAY;
        jest.spyOn(AnomaliesManager, 'renderDayReport').mockImplementation(() => {});
        CashManagementManager.todaySession = null;
        DayManager.loadTodayData();
        const today = ['todayLaborCost', 'todayLabourToPay', 'todayLabourPaid'].map(id => document.getElementById(id).textContent.trim());
        const link = document.getElementById('todayLabourHistory');
        expect(link.textContent).toBe('History');
        expect(link.dataset.onclick).toBe("nav.showTab('money-labour')");
        expect(link.closest('button.today-labour-open')).toBeNull();
        openMoney('today');
        expect(cells()).toEqual([['25 Nov', ...today, '+₹74']]);
    });

    test('period filter: Money\'s presets and chosen days', () => {
        openMoney('this-month');
        expect(cells().map(r => r[0])).toEqual(['25 Nov', '23 Nov', '2 Nov']);
        expect(text('lhDeducted')).toBe('₹90');
        MoneyManager.setPreset('this-week');
        expect(cells().map(r => r[0])).toEqual(['25 Nov', '23 Nov']);
        setInsightsContext({ preset: 'range:2026-11-01:2026-11-23' });
        MoneyManager.render();
        expect(cells().map(r => r[0])).toEqual(['23 Nov', '2 Nov']);
        expect(document.querySelector('#moneyCmpBar #moneyCmpAFrom')).not.toBeNull();
        expect(document.querySelector('#moneyCmpBar [data-onclick="money.shareSummary()"]')).toBeNull();
        setInsightsContext({ preset: 'range:2026-11-10:2026-11-20' });
        MoneyManager.render();
        expect(document.getElementById('lhDays').textContent).toContain('No purchases or labour payments in this period');
        expect(text('lhBalance')).toBe('Balance ₹0');
    });

    test('Today\'s History link shows only to who may open Money › Labour', () => {
        document.body.innerHTML = DAY;
        jest.spyOn(AnomaliesManager, 'renderDayReport').mockImplementation(() => {});
        CashManagementManager.todaySession = null;
        AppState.userRole = 'manager';
        DayManager.loadTodayData();
        expect(document.getElementById('todayLabourHistory')).not.toBeNull();
        AppState.settings = { ...SETTINGS, roleAccess: { manager: { finance: false } } };
        DayManager.loadTodayData();
        expect(document.getElementById('todayLabourHistory')).toBeNull();
        AppState.userRole = 'staff';
        AppState.settings = { ...SETTINGS, roleAccess: { staff: { finance: true } } };
        DayManager.loadTodayData();
        expect(document.getElementById('todayLabourHistory')).toBeNull();
    });

    test('owner and manager only, with Money', () => {
        expect(canOpenSection('money', 'labour', 'owner')).toBe(true);
        expect(canOpenSection('money', 'labour', 'manager')).toBe(true);
        expect(canOpenSection('money', 'labour', 'manager', { manager: { finance: false } })).toBe(false);
        expect(canOpenSection('money', 'labour', 'staff', { staff: { finance: true } })).toBe(false);
        AppState.userRole = 'manager';
        openMoney();
        expect(document.querySelector('[data-money-section="labour"]').hidden).toBe(false);
        expect(MoneyManager.section).toBe('labour');
        AppState.userRole = 'staff';
        AppState.settings = { ...SETTINGS, roleAccess: { staff: { finance: true } } };
        MoneyManager.section = 'profit';
        openMoney();
        expect(document.querySelector('[data-money-section="labour"]').hidden).toBe(true);
        expect(MoneyManager.section).toBe('profit');
        MoneyManager.setSection('labour');
        expect(MoneyManager.section).toBe('profit');
        expect(document.getElementById('moneyLabourHistory').hidden).toBe(true);
    });

    test('tapping a day opens its bills and labour payments', async () => {
        const modal = jest.spyOn(UIManager, 'showModalWithHtml').mockResolvedValue(true);
        openMoney('this-week');
        const row = document.querySelector('#lhDays tbody tr');
        expect(row.getAttribute('role')).toBe('button');
        expect(row.dataset.onclick).toBe("money.openLabourDay('2026-11-25')");
        await MoneyManager.openLabourDay('2026-11-25');
        const [html, title] = modal.mock.calls[0];
        expect(title).toBe('25 Nov 2026');
        const box = document.createElement('div');
        box.innerHTML = html;
        expect([...box.querySelectorAll('table tbody tr')].map(tr => [...tr.children].map(c => c.textContent))).toEqual([
            ['#P1', 'Ram <b>Lal</b>', '12', '₹72'],
            ['#P2', 'Shyam', '8', '₹0']
        ]);
        expect([...box.querySelectorAll('.row')].map(r => r.textContent)).toEqual(['LabourEvening gang₹100']);
        expect(box.querySelector('.lh-balance').textContent).toBe('Balance +₹74');
    });

    test('Hindi: the same figures, Hindi words', () => {
        openMoney('this-week', 'hi');
        expect(document.querySelector('[data-money-section="labour"]').textContent).toBe('मज़दूरी');
        expect([...document.querySelectorAll('#lhDays thead th')].slice(0, 4).map(th => th.textContent)).toEqual(['तारीख', 'काटी गई', 'अनुमान', 'दिया']);
        expect(text('lhBalance')).toBe('बाकी +₹50');
    });

    test('reads nothing: the figures come from the bills and expenses already on the phone', () => {
        const reads = ['loadCashSessionsBetween', 'loadMonthSnapshots'].filter(f => typeof FirebaseService[f] === 'function')
            .map(f => jest.spyOn(FirebaseService, f));
        openMoney('this-month');
        MoneyManager.setPreset('this-week');
        reads.forEach(spy => expect(spy).not.toHaveBeenCalled());
    });
});
