/**
 * @jest-environment jsdom
 */
/** Today › Cash shows the Cash page's own body, never a copy (#96). */
import fs from 'fs';
import path from 'path';
import { DayManager } from '../modules/day.js';
import { CashManagementManager } from '../modules/cash-management.js';
import { UIManager } from '../ui/ui-manager.js';
import { AppState } from '../utils/state.js';
import { todayLocalISO } from '../utils/dates.js';
import { offlineCountFor } from '../utils/cash-session.js';

const tpl = (name) => fs.readFileSync(path.resolve(__dirname, `../../templates/${name}.html`), 'utf8');
const duplicateIds = () => {
    const seen = new Set();
    return [...document.querySelectorAll('[id]')].map(el => el.id).filter(id => seen.has(id) || !seen.add(id));
};

beforeEach(() => {
    document.body.innerHTML = tpl('day') + tpl('cash-management');
    window.app = { cashManagement: { init: jest.fn().mockResolvedValue() } };
    jest.spyOn(DayManager, 'loadTodayData').mockImplementation(() => {});
    jest.spyOn(DayManager, 'loadTodaySession').mockImplementation(() => {});
    DayManager.currentSubTab = 'today';
});
afterEach(() => {
    jest.restoreAllMocks();
    delete window.app;
});

test('opening Today › Cash moves the cash body: one copy of every id', () => {
    expect(duplicateIds()).toEqual([]);
    DayManager.showSubTab('cash');
    expect(duplicateIds()).toEqual([]);
    expect(document.querySelectorAll('.cash-body')).toHaveLength(1);
    expect(document.querySelector('#dayCashManagementContainer .cash-body #statusAvailable')).not.toBeNull();
    expect(window.app.cashManagement.init).toHaveBeenCalledTimes(1);
    DayManager.showSubTab('cash');
    expect(duplicateIds()).toEqual([]);
});

test('the Cash page takes the body back; Today › Cash takes it again when Today is the open page', () => {
    DayManager.showSubTab('cash');
    DayManager.returnCashBody();
    expect(document.querySelector('#cash-management > .cash-body')).not.toBeNull();
    expect(document.getElementById('dayCashManagementContainer').children).toHaveLength(0);
    DayManager.init();
    expect(document.querySelector('#cash-management > .cash-body')).not.toBeNull();
    document.getElementById('day').classList.add('active');
    DayManager.init();
    expect(document.querySelector('#dayCashManagementContainer > .cash-body')).not.toBeNull();
    expect(duplicateIds()).toEqual([]);
});

test('a second tap while init runs shares it', async () => {
    const first = DayManager.loadCashManagement();
    DayManager.loadCashManagement();
    expect(window.app.cashManagement.init).toHaveBeenCalledTimes(1);
    await first;
    DayManager.loadCashManagement();
    expect(window.app.cashManagement.init).toHaveBeenCalledTimes(2);
});

test('the moved fields get their listeners once, however often init runs', async () => {
    for (const m of ['loadRecentSessions', 'autoSignOutPreviousDays', 'loadTodaySessionFromCache', 'calculateTodayTransactions',
        'updateUI', 'loadCustomerOptions', 'renderHistoryFromCache', 'loadDuplicateDays', 'updateTransactionForm']) {
        jest.spyOn(CashManagementManager, m).mockImplementation(() => Promise.resolve([]));
    }
    const due = jest.spyOn(CashManagementManager, 'populateDueBills').mockImplementation(() => {});
    await CashManagementManager.init();
    DayManager.showSubTab('cash');
    await CashManagementManager.init();
    document.getElementById('partyName').dispatchEvent(new Event('input'));
    expect(due).toHaveBeenCalledTimes(1);
});

describe('closing cash with no internet (U-32)', () => {
    let online;
    beforeEach(() => {
        online = false;
        jest.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => online);
        jest.spyOn(UIManager, 'showToast').mockImplementation(() => {});
        jest.spyOn(CashManagementManager, 'validateSignOut').mockImplementation(() => {});
        AppState.currentUser = { uid: 'u1' };
        CashManagementManager.todaySession = { id: 's1', date: todayLocalISO(), signedOut: false };
        localStorage.clear();
    });
    afterEach(() => {
        CashManagementManager.todaySession = null;
        AppState.currentUser = null;
    });

    test('the count is kept on this phone and put back in the fields once online', async () => {
        document.getElementById('cashSignOutAmount').value = '1450';
        document.getElementById('cashSignOutNotes').value = 'Took 500 home';
        await CashManagementManager.signOut();
        expect(UIManager.showToast).toHaveBeenCalledWith(expect.stringMatching(/saved on this phone/), 'warning');
        expect(CashManagementManager.todaySession.signedOut).toBe(false);
        document.getElementById('cashSignOutAmount').value = '';
        document.getElementById('cashSignOutNotes').value = '';
        online = true;
        CashManagementManager.renderOfflineCount();
        const box = document.getElementById('cashOfflineCount');
        expect(box.hidden).toBe(false);
        expect(box.textContent).toMatch(/internet is back/);
        expect(document.getElementById('cashSignOutAmount').value).toBe('1450');
        expect(document.getElementById('cashSignOutNotes').value).toBe('Took 500 home');
    });

    test('a saved count only applies to the same open session today', () => {
        const today = '2026-11-15';
        const saved = { sessionId: 's1', date: today, amount: 100, at: 1 };
        expect(offlineCountFor(saved, { id: 's1', date: today }, today)).toBe(saved);
        expect(offlineCountFor(saved, { id: 's1', date: today, signedOut: true }, today)).toBeNull();
        expect(offlineCountFor(saved, { id: 's2', date: today }, today)).toBeNull();
        expect(offlineCountFor(saved, { id: 's1', date: today }, '2026-11-16')).toBeNull();
    });
});
