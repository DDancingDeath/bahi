/**
 * @fileoverview Anomalies module (#187, #40): daily scan runs once per day on
 * owner/manager devices, never writes when stored records can't be read from
 * the server, writes only new ids, and the Day report card is hidden for
 * other users and escapes stored text.
 */
jest.mock('../firebase/firestore-service.js', () => ({
    FirebaseService: {
        loadCashSessionsBetween: jest.fn(async () => []),
        loadAuditLogsSince: jest.fn(async () => []),
        loadAnomalies: jest.fn(async () => ({ docs: [], last: null, more: false })),
        saveAnomalies: jest.fn(async () => {}),
        loadPeople: jest.fn(async () => [])
    }
}));
jest.mock('../services/printer.js', () => ({ PrinterService: { showImagePreview: jest.fn(() => true) } }));

import { AnomaliesManager } from '../modules/anomalies.js';
import { FirebaseService } from '../firebase/firestore-service.js';
import { AppState } from '../utils/state.js';

// Fixed midday IST clock (Date only): the night-entry rule would otherwise also
// fire when CI happens to run late at night.
jest.useFakeTimers({
    now: new Date('2026-10-21T12:00:00+05:30'),
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
        'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
        'setTimeout', 'clearTimeout']
});
afterAll(() => jest.useRealTimers());

const now = Date.now();
const badBill = {
    id: 'b1', billNumber: 'R1', customerName: '<img src=x onerror=alert(1)>', userId: 'u1', userName: 'Amit',
    items: [{ name: 'Rice', rate: 40, qty: 10, total: 400 }], total: 400,
    payment: { cash: 100, online: 0, due: 0 }, date: new Date(now).toISOString(), timestamp: now
};

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.clear();
    AppState.userRole = 'owner';
    AppState.currentUser = { uid: 'own1' };
    AppState.historyLoadedFrom = 0;
    AppState.retailSalesHistory = [badBill];
    AppState.purchaseHistory = [];
    AppState.salesHistory = [];
    AppState.stockAdjustments = [];
    AppState.items = [];
    AnomaliesManager.stored = null;
    AnomaliesManager.reportList = [];
    AnomaliesManager.refreshing = null;
    AnomaliesManager.scanQueue = null;
    AnomaliesManager.owners = null;
    AnomaliesManager.ownersAskedBy = null;
    AnomaliesManager.healthAlerts = [];
    document.body.innerHTML = '<div id="dayReportCard" style="display:none"></div>';
});

describe('daily scan', () => {
    test('#147: back-dated bills are flagged from 1 day for anyone but an owner (owners read once from the team)', async () => {
        const dated = (id, userId) => ({ ...badBill, id, userId, payment: { cash: 400, online: 0, due: 0 }, timestamp: now - 86400000, date: new Date(now - 86400000).toISOString(), enteredAt: now });
        // Nothing dated back by someone else: no read of the team
        AppState.retailSalesHistory = [dated('mine', 'own1')];
        await AnomaliesManager.scan('2026-10-21', '2026-10-21');
        expect(FirebaseService.loadPeople).not.toHaveBeenCalled();
        AppState.retailSalesHistory = [dated('s1', 'staff1'), dated('o2', 'own2')];
        FirebaseService.loadPeople.mockResolvedValue([{ id: 'own2', role: 'owner' }, { id: 'staff1', role: 'staff' }]);
        const { detected } = await AnomaliesManager.scan('2026-10-21', '2026-10-21');
        expect(detected.map(a => [a.type, a.refId])).toEqual([['date-backdated', 's1']]);
        await AnomaliesManager.scan('2026-10-21', '2026-10-21');
        expect(FirebaseService.loadPeople).toHaveBeenCalledTimes(1);
        // A bill without enteredAt that reached the server a day after its date also needs the owners
        AnomaliesManager.owners = null;
        FirebaseService.loadPeople.mockClear();
        AppState.retailSalesHistory = [{ ...dated('s2', 'staff1'), enteredAt: undefined, createdAt: { seconds: Math.floor(now / 1000), nanoseconds: 0 } }];
        expect((await AnomaliesManager.scan('2026-10-21', '2026-10-21')).detected.map(a => [a.type, a.refId])).toEqual([['date-backdated', 's2']]);
        expect(FirebaseService.loadPeople).toHaveBeenCalledTimes(1);
        AppState.retailSalesHistory = [dated('s1', 'staff1'), dated('o2', 'own2')];
        // Not known (read failed): Q20 for all
        AnomaliesManager.owners = null;
        FirebaseService.loadPeople.mockRejectedValueOnce(new Error('offline'));
        expect((await AnomaliesManager.scan('2026-10-21', '2026-10-21')).detected).toEqual([]);
    });

    test('writes new records once per day; a second run the same day reads and writes nothing', async () => {
        await AnomaliesManager.dailyScan();
        expect(FirebaseService.loadAnomalies).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ server: true }));
        expect(FirebaseService.saveAnomalies).toHaveBeenCalledTimes(1);
        const writes = FirebaseService.saveAnomalies.mock.calls[0][0];
        expect(writes.map(w => w.id)).toEqual(['payment-split~bill~b1']);
        expect(writes[0].data.status).toBe('open');

        await AnomaliesManager.dailyScan();
        expect(FirebaseService.loadAnomalies).toHaveBeenCalledTimes(1);
        expect(FirebaseService.saveAnomalies).toHaveBeenCalledTimes(1);
    });

    test('already stored records are not rewritten (review status kept)', async () => {
        FirebaseService.loadAnomalies.mockResolvedValueOnce({ docs: [], last: null, more: false });
        await AnomaliesManager.scan('2000-01-01', '2100-01-01');
        const stored = FirebaseService.saveAnomalies.mock.calls[0][0].map(w => ({ id: w.id, ...w.data, status: 'ok' }));
        FirebaseService.loadAnomalies.mockResolvedValueOnce({ docs: stored, last: null, more: false });
        FirebaseService.saveAnomalies.mockClear();
        await AnomaliesManager.scan('2000-01-01', '2100-01-01');
        expect(FirebaseService.saveAnomalies).not.toHaveBeenCalled();
    });

    test('offline (server read fails): nothing is written and the day is not marked scanned', async () => {
        FirebaseService.loadAnomalies.mockRejectedValueOnce(new Error('unavailable'));
        await AnomaliesManager.dailyScan();
        expect(FirebaseService.saveAnomalies).not.toHaveBeenCalled();
        expect(localStorage.getItem('aadhatAnomalyScanDay')).toBeNull();
    });

    test('other users never scan; managers do not read the audit log', async () => {
        AppState.userRole = 'staff';
        await AnomaliesManager.dailyScan();
        expect(FirebaseService.loadAnomalies).not.toHaveBeenCalled();
        AppState.userRole = 'manager';
        await AnomaliesManager.dailyScan();
        expect(FirebaseService.loadAuditLogsSince).not.toHaveBeenCalled();
        expect(FirebaseService.saveAnomalies).toHaveBeenCalled();
    });
});

describe('Day report card', () => {
    test('owner sees counts and the review queue with escaped text', async () => {
        AnomaliesManager.renderDayReport({ sales: 400, saleCount: 1 }, null);
        await AnomaliesManager.refreshing;
        const card = document.getElementById('dayReportCard');
        expect(card.style.display).toBe('block');
        expect(card.textContent).toContain('Day report');
        expect(card.textContent).not.toContain('आज की रिपोर्ट');
        expect(card.textContent).toContain('Payment does not match total');
        expect(card.querySelector('img')).toBeNull();
        expect(card.innerHTML).toContain('&lt;img');
        expect(card.textContent).not.toMatch(/staff/i);
        expect(AnomaliesManager.dayReportText()).toContain('Sales: ₹400 (1 bill)');
    });

    test("only today's anomalies on the card and in the share text; older open ones are a count on All anomalies", async () => {
        const yAt = now - 86400000;
        AppState.retailSalesHistory = [badBill, {
            ...badBill, id: 'b0', billNumber: 'R0', customerName: 'Yesterday Party',
            date: new Date(yAt).toISOString(), timestamp: yAt
        }];
        AnomaliesManager.renderDayReport({ sales: 400, saleCount: 1 }, null);
        await AnomaliesManager.refreshing;
        const card = document.getElementById('dayReportCard');
        expect(AnomaliesManager.reportList.map(a => a.dayKey)).toEqual(expect.arrayContaining(['2026-10-20', '2026-10-21']));
        expect(card.textContent).not.toContain('Yesterday Party');
        expect(card.textContent).not.toContain('R0');
        expect(card.textContent).not.toContain('Yesterday');
        expect(card.querySelectorAll('#dayReportBody .anom-row')).toHaveLength(1);
        expect(card.querySelector('#dayReportToggle [data-day-report-sev="high"]').textContent).toBe('High 1');
        expect(card.querySelector('.day-report-all').textContent).toBe('All anomalies (2)');
        const text = AnomaliesManager.dayReportText();
        expect(text).toContain('Anomalies: 1 (High 1, Medium 0, Low 0)');
        expect(text).not.toContain('R0');
        expect(text).not.toContain('Yesterday');
    });

    test('at most 3 rows to review, each compact; the rest behind All anomalies (N)', async () => {
        AnomaliesManager.renderDayReport({}, null);
        await AnomaliesManager.refreshing;
        const { today } = AnomaliesManager.reportKeys();
        AnomaliesManager.reportList = [1, 2, 3, 4, 5].map(n => ({ id: `x${n}`, type: 'rate-high', severity: 'medium', status: 'open', dayKey: today, refKind: 'bill', refId: `b${n}` }));
        AnomaliesManager.drawDayReport();
        const rows = document.querySelectorAll('#dayReportBody .day-report-rows > .anom-row.compact');
        expect(rows).toHaveLength(3);
        expect(rows[0].querySelector('.anom-actions > .btn').textContent.trim()).toBe('Looks right');
        expect(rows[0].querySelector('.anom-actions > details.menu')).not.toBeNull();
        expect(document.querySelector('.day-report-all').textContent).toBe('All anomalies (5)');
    });

    test('no pending count when nothing older is open', async () => {
        AnomaliesManager.renderDayReport({}, null);
        await AnomaliesManager.refreshing;
        const card = document.getElementById('dayReportCard');
        expect(card.textContent).toContain('All anomalies');
        expect(card.textContent).not.toContain('pending');
    });

    test('closed by default: one row with the counts in their colours (no date: it is today); the report is in the closed body', async () => {
        AnomaliesManager.renderDayReport({ sales: 400, saleCount: 1 }, null);
        await AnomaliesManager.refreshing;
        const toggle = document.getElementById('dayReportToggle');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(document.getElementById('dayReportBody').hidden).toBe(true);
        expect(toggle.querySelector('[data-day-report-sev="high"]').className).toBe('tag neg');
        expect(toggle.querySelector('[data-day-report-review]').className).toBe('tag warn');
        expect(toggle.querySelector('.disclosure-summary').textContent).toBe('High 1Review 1');
        expect(toggle.querySelector('.lead-icon').classList.contains('neg')).toBe(true);
        const body = document.getElementById('dayReportBody');
        // Refresh is a small icon in the card's head, not in the report
        expect(document.querySelector('#dayReportCard .disclosure-head > [data-onclick="anomalies.refreshNow()"]').classList.contains('btn-icon')).toBe(true);
        expect(body.querySelector('[data-onclick="anomalies.refreshNow()"]')).toBeNull();
        // One share icon (the shared ⋯ menu): WhatsApp text or an image; no print; then All anomalies on the same row
        const foot = body.querySelector('.day-report-foot');
        const share = foot.querySelector('details.menu.day-report-share');
        expect(share.querySelector('summary').classList.contains('btn-icon')).toBe(true);
        expect(share.querySelector('summary').getAttribute('aria-label')).toBe('Share the day report');
        expect([...share.querySelectorAll('.menu-list > .btn')].map(b => [b.textContent.trim(), b.getAttribute('data-onclick')])).toEqual([
            ['WhatsApp (text)', 'anomalies.shareDayReport()'], ['Share as image', 'anomalies.shareDayReportImage()']]);
        expect(foot.querySelector('.day-report-all').getAttribute('data-onclick')).toBe('anomalies.openPage()');
        expect(body.querySelector('[data-onclick*="print" i]')).toBeNull();
        // No date / cash line, severity chips, type list, top items / parties or group headings on screen
        expect(body.querySelector('.anom-card-sub-row, .anom-chips, .anom-types, .anom-queue-title, .anom-queue-head')).toBeNull();
        expect(body.textContent).not.toMatch(/Top items|Top parties|Needs review|Cash:/);
        expect(AnomaliesManager.dayReportText()).toMatch(/Top/);
        localStorage.setItem('happa.open.day-report', '1');
        AnomaliesManager.drawDayReport();
        expect(document.getElementById('dayReportToggle').getAttribute('aria-expanded')).toBe('true');
        expect(document.getElementById('dayReportBody').hidden).toBe(false);
    });

    test('nothing found: "No issues" when closed, one short line and no zero chips when open', async () => {
        AppState.retailSalesHistory = [];
        AnomaliesManager.renderDayReport({}, null);
        await AnomaliesManager.refreshing;
        const card = document.getElementById('dayReportCard');
        expect(card.querySelector('.disclosure-summary').textContent).toBe('No issues');
        expect(card.querySelector('[data-day-report-sev], [data-day-report-review]')).toBeNull();
        expect(card.querySelector('.anom-chips')).toBeNull();
        expect(card.querySelector('.empty')).toBeNull();
        expect(card.querySelector('[data-day-report-clear]').textContent).toBe('No issues today');
        expect(card.querySelector('#dayReportBody .anom-row')).toBeNull();
        expect(card.querySelector('.day-report-share')).not.toBeNull();
        expect(card.querySelector('[data-onclick="anomalies.openPage()"]')).not.toBeNull();
    });

    test('app health below target: an amber dot and a count on the closed row, the lines and Open app health inside (NEW-06)', async () => {
        AppState.retailSalesHistory = [];
        AnomaliesManager.renderDayReport({}, null);
        await AnomaliesManager.refreshing;
        expect(document.querySelector('[data-disclosure-alert], [data-day-report-health]')).toBeNull();
        AnomaliesManager.setHealthAlerts(['Daily number checks: only 0% passed today (target 95%, 3 runs)', '<b>x</b>']);
        const toggle = document.getElementById('dayReportToggle');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(toggle.querySelector('[data-disclosure-alert]')).not.toBeNull();
        expect(toggle.querySelector('[data-day-report-health]').textContent).toBe('App health 2');
        const lines = document.querySelector('#dayReportBody [data-day-report-health-lines]');
        expect(lines.className).toBe('notice warn day-report-health');
        expect(lines.textContent).toContain('Daily number checks: only 0% passed today');
        expect(lines.querySelector('b')).toBeNull();
        expect(lines.querySelector('[data-onclick="health.openPage()"]').textContent).toBe('Open app health');
        AnomaliesManager.setHealthAlerts([]);
        expect(document.querySelector('[data-disclosure-alert], [data-day-report-health]')).toBeNull();
    });

    test('hidden for other users', () => {
        AppState.userRole = 'staff';
        AnomaliesManager.renderDayReport({}, null);
        expect(document.getElementById('dayReportCard').style.display).toBe('none');
        expect(FirebaseService.loadAnomalies).not.toHaveBeenCalled();
    });

    describe('voids (#75): no approval, but a void by anyone but an owner is flagged on Today', () => {
        const voidedBill = (id, voidedBy) => ({
            ...badBill, id, billNumber: `V${id}`, payment: { cash: 400, online: 0, due: 0 },
            voided: true, voidedBy, voidedByName: 'Ravi', voidedAt: { toDate: () => new Date(now - 60000) }, voidReason: 'Entered twice'
        });
        beforeEach(() => {
            AppState.retailSalesHistory = [];
            FirebaseService.voidedBills = jest.fn(coll => (coll === 'retailSales' ? [voidedBill('1', 'staff1'), voidedBill('2', 'own1')] : []));
        });
        afterEach(() => { delete FirebaseService.voidedBills; });

        test('owner: a member\'s void shows on Today (medium, with the reason) once the owners are read; the owner\'s own does not', async () => {
            FirebaseService.loadPeople.mockResolvedValue([{ id: 'own1', role: 'owner' }, { id: 'staff1', role: 'staff' }]);
            AnomaliesManager.renderDayReport({}, null);
            expect(AnomaliesManager.reportList).toEqual([]);
            await AnomaliesManager.refreshing;
            expect(AnomaliesManager.reportList.map(a => [a.id, a.severity])).toEqual([['bill-voided~bill~1', 'medium']]);
            const card = document.getElementById('dayReportCard');
            expect(card.textContent).toContain('Bill #V1 voided (₹400) — Entered twice');
            expect(FirebaseService.loadAuditLogsSince).not.toHaveBeenCalled();
            expect(FirebaseService.loadPeople).toHaveBeenCalledTimes(1);
            expect(FirebaseService.saveAnomalies.mock.calls[0][0].map(w => w.id)).toEqual(['bill-voided~bill~1']);
        });

        test('manager: the owner\'s void is told apart by the team list, read once', async () => {
            AppState.userRole = 'manager';
            AppState.currentUser = { uid: 'man1' };
            FirebaseService.loadPeople.mockResolvedValue([{ id: 'own1', role: 'owner' }, { id: 'staff1', role: 'staff' }]);
            AnomaliesManager.renderDayReport({}, null);
            // owners not known yet: nothing shown, not even the owner's own void
            expect(AnomaliesManager.reportList).toEqual([]);
            await AnomaliesManager.refreshing;
            expect(AnomaliesManager.reportList.map(a => a.id)).toEqual(['bill-voided~bill~1']);
            expect(FirebaseService.saveAnomalies.mock.calls[0][0].map(w => w.id)).toEqual(['bill-voided~bill~1']);
            AnomaliesManager.stored = null;
            await AnomaliesManager.refreshDayReport();
            expect(FirebaseService.loadPeople).toHaveBeenCalledTimes(1);
        });

        test('the owners\' list is asked for once a session on the cached path, and never offline', async () => {
            AppState.userRole = 'manager';
            AppState.currentUser = { uid: 'man1' };
            AnomaliesManager.markReportFresh(`${AnomaliesManager.reportKeys().yesterday}|${AnomaliesManager.reportKeys().today}`);
            const online = jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
            await AnomaliesManager.refreshDayReport();
            expect(FirebaseService.loadPeople).not.toHaveBeenCalled();
            online.mockRestore();
            FirebaseService.loadPeople.mockRejectedValue(new Error('unavailable'));
            await AnomaliesManager.refreshDayReport();
            await AnomaliesManager.refreshDayReport();
            expect(FirebaseService.loadPeople).toHaveBeenCalledTimes(1);
            expect(AnomaliesManager.reportList).toEqual([]);
        });

        test('owner: the owners come from the same cached profile read the daily scan uses for the audit log', async () => {
            FirebaseService.loadAuditPeople = jest.fn(async () => [{ id: 'own1', role: 'owner' }, { id: 'staff1', role: 'staff' }]);
            try {
                expect(await AnomaliesManager.loadOwnerIds()).toEqual(['own1']);
                expect(FirebaseService.loadAuditPeople).toHaveBeenCalledTimes(1);
                expect(FirebaseService.loadPeople).not.toHaveBeenCalled();
            } finally {
                delete FirebaseService.loadAuditPeople;
            }
        });
    });

    describe('expense voids (#99): flagged on Today like bill voids', () => {
        const voidedExpense = (id, voidedBy) => ({
            id, type: 'Tea', amount: 150, category: 'business', voided: true, voidedBy, voidedByName: 'Ravi',
            voidedAt: { toDate: () => new Date(now - 60000) }, voidReason: 'Wrong amount'
        });
        beforeEach(() => {
            AppState.retailSalesHistory = [];
            FirebaseService.voidedExpenses = jest.fn(() => [voidedExpense('e1', 'staff1'), voidedExpense('e2', 'own1')]);
        });
        afterEach(() => { delete FirebaseService.voidedExpenses; });

        test('owner: a member\'s expense void shows with the reason and amount once the owners are read; the owner\'s own does not', async () => {
            FirebaseService.loadPeople.mockResolvedValue([{ id: 'own1', role: 'owner' }, { id: 'staff1', role: 'staff' }]);
            AnomaliesManager.renderDayReport({}, null);
            await AnomaliesManager.refreshing;
            expect(AnomaliesManager.reportList.map(a => [a.id, a.severity])).toEqual([['expense-voided~expense~e1', 'medium']]);
            expect(document.getElementById('dayReportCard').textContent).toContain('Expense voided (₹150) — Wrong amount');
            expect(FirebaseService.loadPeople).toHaveBeenCalledTimes(1);
            expect(FirebaseService.loadAuditLogsSince).not.toHaveBeenCalled();
            expect(FirebaseService.saveAnomalies.mock.calls[0][0].map(w => w.id)).toEqual(['expense-voided~expense~e1']);
        });

        test('only the owner\'s own expense voids loaded: no owners read', async () => {
            FirebaseService.voidedExpenses.mockReturnValue([voidedExpense('e2', 'own1')]);
            AnomaliesManager.renderDayReport({}, null);
            await AnomaliesManager.refreshing;
            expect(AnomaliesManager.reportList).toEqual([]);
            expect(FirebaseService.loadPeople).not.toHaveBeenCalled();
        });
    });
});

describe('read budget (free plan)', () => {
    const serverCalls = () => FirebaseService.loadAnomalies.mock.calls.filter(c => !c[2]?.cacheOnly);

    test('Today refresh never reads the audit log; the daily scan does, capped', async () => {
        await AnomaliesManager.refreshDayReport();
        expect(FirebaseService.loadAuditLogsSince).not.toHaveBeenCalled();
        expect(serverCalls()[0][2]).toEqual(expect.objectContaining({ limit: 200, server: true }));
        await AnomaliesManager.dailyScan();
        expect(FirebaseService.loadAuditLogsSince).toHaveBeenCalledTimes(1);
        // paged by FirebaseService, at most 1,000 entries per scanned day
        expect(FirebaseService.loadAuditLogsSince.mock.calls[0][1]).toBe(7 * 1000);
    });

    test('repeated Today refreshes within the TTL (even after reopening the app) use the cache only', async () => {
        await AnomaliesManager.refreshDayReport();
        expect(serverCalls()).toHaveLength(1);
        for (let i = 0; i < 3; i++) {
            AnomaliesManager.stored = null; // app reopened: in-memory copy gone, TTL kept in localStorage
            await AnomaliesManager.refreshDayReport();
        }
        expect(serverCalls()).toHaveLength(1);
        expect(FirebaseService.loadCashSessionsBetween).toHaveBeenCalledTimes(1);
        expect(FirebaseService.loadAnomalies.mock.calls.filter(c => c[2]?.cacheOnly)).toHaveLength(3);
        expect(FirebaseService.saveAnomalies).toHaveBeenCalledTimes(1);

        await AnomaliesManager.refreshNow(); // the card's refresh button reads the server
        expect(serverCalls()).toHaveLength(2);
    });

    test('after the daily scan the Today card needs no server read of its own', async () => {
        await AnomaliesManager.dailyScan();
        FirebaseService.loadAnomalies.mockClear();
        AnomaliesManager.stored = null;
        await AnomaliesManager.refreshDayReport();
        expect(serverCalls()).toHaveLength(0);
    });
});

describe('rows (NEW-16, NEW-05)', () => {
    const row = (a) => {
        document.body.innerHTML = AnomaliesManager.rowHtml({ id: 'x1', severity: 'high', status: 'open', dayKey: '2026-10-21', ...a });
        return document.querySelector('.anom-actions');
    };
    const styles = (el) => [...el.querySelectorAll(':scope > .btn')].map(b => [b.className, b.textContent.trim()]);

    test('an open row: one tonal "Looks right", the rest as ghost buttons in the ⋯ menu', () => {
        const actions = row({ type: 'rate-high', refKind: 'bill', refId: 'b1', amount: 400 });
        expect(styles(actions)).toEqual([['btn btn-sm btn-tonal', 'Looks right']]);
        const menu = actions.querySelector('details.anom-overflow');
        expect(menu.querySelector('summary').getAttribute('aria-label')).toBe('More actions');
        expect([...menu.querySelectorAll('.anom-overflow-menu > .btn')].map(b => [b.className, b.textContent.trim()])).toEqual([
            ['btn btn-sm btn-ghost', 'Open'], ['btn btn-sm btn-ghost', 'Correct rate on this bill'], ['btn btn-sm btn-ghost', 'I corrected it']
        ]);
    });

    test('a reviewed row: one tonal "Reopen"; Open in the menu', () => {
        const actions = row({ type: 'rate-high', status: 'ok', refKind: 'cash', refId: '2026-10-21' });
        expect(styles(actions)).toEqual([['btn btn-sm btn-tonal', 'Reopen']]);
        expect([...actions.querySelectorAll('.anom-overflow-menu > .btn')].map(b => b.textContent.trim())).toEqual(['Open']);
    });

    test('the ⋯ list floats on a panel out of the row\'s flow, so opening it moves nothing (NEW-19)', () => {
        const actions = row({ type: 'rate-high', refKind: 'bill', refId: 'b1' });
        expect(actions.querySelector('details.menu.anom-overflow > .panel.menu-list.anom-overflow-menu')).not.toBeNull();
        const read = (f) => require('fs').readFileSync(require('path').join(__dirname, `../../css/${f}`), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        const css = read('anomalies.css');
        const shared = read('surfaces.css');
        const rule = (sel, src = css) => (new RegExp(`(?:^|\\})\\s*${sel.replace(/[.[\]()>]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(src) || [])[1] || '';
        expect(rule('.menu', shared)).toMatch(/position: relative/);
        expect(rule('.menu-list', shared)).toMatch(/position: absolute/);
        expect(rule('.menu-list', shared)).toMatch(/z-index: var\(--z-popover\)/);
        expect(rule('.menu-list', shared)).toMatch(/box-shadow: var\(--e2\)/);
        expect(css).not.toMatch(/\.anom-overflow/);
        expect(rule('.anom-actions')).toMatch(/flex-wrap: nowrap/);
        expect(css).not.toMatch(/\.anom-overflow\[open\]/);
        expect(css).not.toMatch(/\.anom-list \{[^}]*overflow: hidden/);
    });

    test('a number check: its text and amount without paise from ₹100 up, the true minus', () => {
        row({ type: 'numcheck-ac3', refKind: 'bill', refId: 'b1', amount: 2193.43, en: 'Bill split: expected ₹1,33,710.57, found -₹2,636', hi: 'x' });
        expect(document.querySelector('.anom-why').textContent).toBe('Bill split: expected ₹1,33,711, found −₹2,636');
        expect(document.querySelector('.anom-meta').textContent).toContain('₹2,193');
        expect(document.querySelector('.anom-meta').textContent).not.toContain('.43');
    });
});
