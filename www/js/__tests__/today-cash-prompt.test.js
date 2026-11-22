/** Today: the "Open cash" prompt (#141, Q41) shows only when today has bills, the day's sessions are loaded and none is open. */
import fs from 'fs';
import path from 'path';
import { DayManager } from '../modules/day.js';
import { CashManagementManager } from '../modules/cash-management.js';
import { todayLocalISO } from '../utils/dates.js';

const prompt = () => document.getElementById('todayCashPrompt');

beforeEach(() => {
    document.body.innerHTML = fs.readFileSync(path.resolve(__dirname, '../../templates/day.html'), 'utf8');
    CashManagementManager.todaySession = null;
    DayManager.daySessions = { date: null, list: [] };
});
afterEach(() => {
    CashManagementManager.todaySession = null;
    DayManager.daySessions = { date: null, list: [] };
});

test('hidden until the day\'s sessions are loaded', () => {
    DayManager.renderCashPrompt(true, todayLocalISO());
    expect(prompt().hidden).toBe(true);
});

test('shown with bills and no session; hidden without bills', () => {
    const day = todayLocalISO();
    DayManager.daySessions = { date: day, list: [] };
    DayManager.renderCashPrompt(true, day);
    expect(prompt().hidden).toBe(false);
    DayManager.renderCashPrompt(false, day);
    expect(prompt().hidden).toBe(true);
});

test('hidden once a session of today exists (loaded, or opened on this phone)', () => {
    const day = todayLocalISO();
    DayManager.daySessions = { date: day, list: [{ id: 's1', date: day }] };
    DayManager.renderCashPrompt(true, day);
    expect(prompt().hidden).toBe(true);
    DayManager.daySessions = { date: day, list: [] };
    CashManagementManager.todaySession = { id: 's2', date: day };
    DayManager.renderCashPrompt(true, day);
    expect(prompt().hidden).toBe(true);
});

test('members without the Wholesale page see no wholesale card or bills', () => {
    const { AppState } = require('../utils/state.js');
    const day = todayLocalISO();
    const now = new Date().toISOString();
    AppState.userRole = 'staff';
    AppState.settings = {};
    AppState.salesHistory = [{ id: 'w1', billNumber: 'W-1', date: now, total: 500, cashPayment: 500, payment: { cash: 500, online: 0, due: 0, total: 500 } }];
    AppState.retailSalesHistory = [{ id: 'r1', billNumber: 'S-1', date: now, total: 100, cashPayment: 100, payment: { cash: 100, online: 0, due: 0, total: 100 } }];
    AppState.purchaseHistory = [];
    AppState.expensesHistory = [];
    DayManager.daySessions = { date: day, list: [] };
    const { AnomaliesManager } = require('../modules/anomalies.js');
    const { HealthManager } = require('../modules/health.js');
    jest.spyOn(AnomaliesManager, 'renderDayReport').mockImplementation(() => {});
    jest.spyOn(HealthManager, 'todayAlerts').mockResolvedValue([]);
    const { UIManager } = require('../ui/ui-manager.js');
    const sheet = jest.spyOn(UIManager, 'showModalWithHtml').mockResolvedValue(true);
    const splitTypes = () => [...new DOMParser().parseFromString(sheet.mock.calls.at(-1)[0], 'text/html').querySelectorAll('[data-split]')].map(s => s.dataset.split);
    DayManager.loadTodayData();
    DayManager.showSplit('sale');
    expect(splitTypes()).toEqual(['retail']);
    expect(document.getElementById('todayBillsCount').textContent).toBe("Today's bills · 1");
    expect(document.getElementById('todayBillsMeta').textContent).toBe('1 retail');
    expect(prompt().hidden).toBe(false);
    AppState.userRole = 'owner';
    DayManager.loadTodayData();
    DayManager.showSplit('sale');
    expect(splitTypes()).toEqual(['retail', 'wholesale']);
    expect(document.getElementById('todayBillsMeta').textContent).toBe('1 retail · 1 wholesale');
    jest.restoreAllMocks();
    ['salesHistory', 'retailSalesHistory'].forEach(k => { AppState[k] = []; });
    AppState.userRole = null;
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
    draw.mockRestore();
});
