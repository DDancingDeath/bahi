// -------------------- DAY MODULE --------------------
// Manages the Day page with Today's Summary and Cash Management sub-tabs

import { AppState } from '../utils/state.js';
import { UIManager } from '../ui/ui-manager.js';
import { Helpers } from '../utils/helpers.js';
import { formatKg, labourCalcText } from '../utils/labour.js';
import { todayLocalISO, displayLocale, toLocalISODate, formatDayTime } from '../utils/dates.js';
import { todaySummary } from '../utils/calc/today.js';
import { FirebaseService } from '../firebase/firestore-service.js';
import { CashManagementManager } from './cash-management.js';
import { sessionForDate } from '../utils/cash-session.js';
import { t, tn, getLang, loadAllCatalogues } from '../i18n/index.js';
import { emptyState } from '../ui/components.js';
import { canOpenPage } from '../utils/role-access.js';
import { on, REFRESH, REMINDERS_CHANGED } from '../utils/events.js';
import { overdueReminder, rentReminder, leaseReminder, leaseReminderText } from '../utils/reminders.js';
import { drillReminder } from '../utils/backup-verify.js';
import { billsForKind } from '../utils/party-due.js';
import { rentalsRole } from '../ui/business-switcher.js';
import { formatRate, moneyText } from '../utils/money.js';
import { ManualReminders, TODAY_REMINDERS_KEY } from '../ui/manual-reminders.js';
import { disclosureHtml, refocusDisclosure } from '../ui/disclosure.js';
import { icon } from '../ui/icons.js';
import { payDueReminder, billsDueReminder } from '../utils/pay-reminder.js';
import { getPendingJoins, writeOffsByOthers } from '../utils/owner-alerts.js';
import { firstRunSteps, showFirstRun, appLockOfferDue, FIRST_RUN_HIDDEN_KEY, FIRST_RUN_TEAM_KEY } from '../utils/first-run.js';
import { normalizePrinterSettings } from '../utils/printer-settings.js';
import { safeSetItem } from '../utils/storage-full.js';
import { SyncStatus } from '../ui/sync-status.js';

// Use helper functions
const formatDate = (date) => Helpers.formatDate(date);
const LABOUR_PAID_KEYS = { more: 'ui.today.labour_paid_more', less: 'ui.today.labour_paid_less' };
const CHANNELS = { retail: 'Retail', wholesale: 'Wholesale', purchase: 'Purchase' };
const BILL_KIND_KEYS = { retail: 'ui.finance.bill_retail', wholesale: 'ui.finance.bill_wholesale', purchase: 'ui.reports.pdf_purchase' };
const BILLS_SHOWN = 8;
const WIDE_TODAY = '(min-width: 1280px)';
/** Bills in memory by kind, for the owner's write-off reminder (U-08). */
const loadedBillsByKind = () => ({ purchase: AppState.purchaseHistory || [], retail: AppState.retailSalesHistory || [], wholesale: AppState.salesHistory || [] });
const REMINDER_ICONS = {
    collect: icon('arrIn'), collect_wholesale: icon('truck'), pay: icon('arrOut'), rent: icon('home'), leases: icon('file'),
    salaries: icon('users'), bills: icon('receipt'), backup: icon('clipCheck'), join: icon('user'), writeoff: icon('alert'), firstrun: icon('clipCheck'), lock: icon('lock')
};
/** Opens a Today reminder: its icon tile and body (the caller closes both divs). */
const reminderOpen = (kind) => `<div class="today-reminder" data-reminder="${kind}"><span class="lead-icon">${REMINDER_ICONS[kind]}</span><div class="today-reminder-body">`;

let anomaliesManager = null;
let anomaliesLoading = null;
/**
 * anomalies.js (Today's day report, the Anomalies page) is imported on first use (#59), with
 * both language catalogues: its scans save flags in both languages. A failed import is tried
 * again next time. main.js uses the same loader.
 * @returns {Promise<Object>} AnomaliesManager
 */
export function loadAnomalies() {
    if (!anomaliesLoading) {
        anomaliesLoading = Promise.all([import('./anomalies.js'), loadAllCatalogues()])
            .then(([m]) => (anomaliesManager = m.AnomaliesManager))
            .catch(e => { anomaliesLoading = null; throw e; });
    }
    return anomaliesLoading;
}
/** AnomaliesManager once imported, else null (for callers that can't wait). */
export const loadedAnomalies = () => anomaliesManager;

export const DayManager = {
    currentSubTab: 'today',
    
    /**
     * Initialize the Day page
     */
    init() {
        ManualReminders.start(() => this.renderReminders());
        this.watchWideToday();
        this.updateTodayHeader();
        this.loadTodayData();
        this.loadTodaySession();
        // The Cash page may have taken the cash body back while Today › Cash stayed selected
        if (this.currentSubTab === 'cash' && document.getElementById('day')?.classList.contains('active')
            && !document.querySelector('#dayCashManagementContainer .cash-body')) this.loadCashManagement();
    },

    /** Every cash session of `date` (usually one; legacy days can have more), from one query. */
    daySessions: { date: null, list: [] },
    daySessionsLoading: null,
    /** @type {?MediaQueryList} */
    wideToday: null,

    /** Follows the ≥ 1280 px desktop width for placeDayDetails (once). */
    watchWideToday() {
        if (!this.wideToday && typeof window.matchMedia === 'function') {
            this.wideToday = window.matchMedia(WIDE_TODAY);
            this.wideToday.addEventListener?.('change', () => this.placeDayDetails());
        }
        this.placeDayDetails();
    },

    /**
     * At ≥ 1280 px Labour and Payment breakdown sit in the right column under Reminders and the
     * Day report; narrower they go back to the top of Day details, so the phone order stays (NEW-17).
     */
    placeDayDetails() {
        const side = document.querySelector('#dayTodayContent .today-side');
        const summary = document.querySelector('#todayMore > summary');
        const blocks = ['todayLabourBlock', 'todayPayBlock'].map(id => document.getElementById(id));
        if (!side || !summary || !blocks[0] || !blocks[1]) return;
        if (this.wideToday?.matches) {
            if (blocks[0].parentElement !== side) side.append(blocks[0], blocks[1]);
        } else if (blocks[0].parentElement === side) {
            summary.after(blocks[0], blocks[1]);
        }
    },

    /**
     * Today's cash sessions carry drawer legs of due payments whose bills may
     * not be in memory (#95). Read all of the day's sessions (one query, as
     * before: again only while there is no drawer session for today) and
     * redraw; the drawer session, if the Cash tab hasn't picked one, is the
     * one the Cash page would pick.
     */
    loadTodaySession() {
        const today = todayLocalISO();
        if (this.daySessionsLoading === today) return;
        if (this.daySessions.date === today && CashManagementManager.todaySession?.date === today) return;
        this.daySessionsLoading = today;
        FirebaseService.loadCashSessionsForDate(today)
            .then(sessions => {
                this.daySessions = { date: today, list: sessions || [] };
                const pick = sessionForDate(sessions, today);
                if (pick && CashManagementManager.todaySession?.date !== today) CashManagementManager.todaySession = pick;
                // No session: only the prompt depends on it (a full redraw would repeat Today's other queries)
                if (this.daySessions.list.length > 0) this.loadTodayData();
                else this.renderCashPrompt(this.lastHasBills, today);
            })
            .catch(e => console.warn('Could not load today\'s cash sessions:', e?.message || e))
            .finally(() => { if (this.daySessionsLoading === today) this.daySessionsLoading = null; });
    },

    /**
     * Sessions whose due legs count on `date` (T6–T14): every session of the
     * day, as the day book, plus the live one the Cash tab holds (it may have
     * legs this phone just added). dueEvents counts each payment id once.
     * @param {string} date YYYY-MM-DD
     * @returns {Object[]}
     */
    sessionsOn(date) {
        const live = CashManagementManager.todaySession;
        const day = this.daySessions.date === date ? this.daySessions.list : [];
        return live && live.date === date ? [live, ...day] : day;
    },

    /**
     * Show a sub-tab (today or cash)
     * @param {string} tab - 'today' or 'cash'
     */
    showSubTab(tab) {
        this.currentSubTab = tab;
        
        // Update tab button styles
        const todayBtn = document.getElementById('dayTabToday');
        const cashBtn = document.getElementById('dayTabCash');
        const todayContent = document.getElementById('dayTodayContent');
        const cashContent = document.getElementById('dayCashContent');
        todayBtn.setAttribute('aria-selected', String(tab === 'today'));
        cashBtn.setAttribute('aria-selected', String(tab !== 'today'));
        
        if (tab === 'today') {
            todayBtn.classList.add('active');
            cashBtn.classList.remove('active');
            todayContent.style.display = '';
            cashContent.style.display = 'none';
            this.loadTodayData();
        } else {
            cashBtn.classList.add('active');
            todayBtn.classList.remove('active');
            todayContent.style.display = 'none';
            cashContent.style.display = '';
            this.loadCashManagement();
        }
    },

    /**
     * Update the today header with current date
     */
    updateTodayHeader() {
        const header = document.getElementById('todayDateHeader');
        const subheader = document.getElementById('todayDateSubheader');
        
        if (header) {
            const today = new Date();
            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            header.textContent = t('ui.today.activity_title');
            if (subheader) {
                subheader.textContent = today.toLocaleDateString(displayLocale(), options);
            }
        }
    },

    /**
     * Load today's summary data
     */
    loadTodayData() {
        const todayIso = todayLocalISO();
        const session = CashManagementManager.todaySession;
        // Without the personal rows (listener not started/delivered) today's total comes from personalExpenseDays (#98)
        const personalReadable = !!FirebaseService.personalRowsLoaded?.();
        if (!personalReadable) this.loadPersonalDay(todayIso);
        const s = todaySummary({
            bills: { purchase: AppState.purchaseHistory, wholesale: AppState.salesHistory, retail: AppState.retailSalesHistory },
            expenses: AppState.expensesHistory,
            personalDay: personalReadable ? null : FirebaseService.personalExpenseDay?.(todayIso),
            sessions: this.sessionsOn(todayIso),
            settings: AppState.settings,
            today: new Date()
        });
        const { labour } = s;
        this.renderReminders();
        // Day details (labour, payment split, dues, by bill type, items) open for the owner and manager,
        // folded for Members, who need the cash, today's bills and reminders (U-35)
        const more = /** @type {?HTMLDetailsElement} */ (document.getElementById('todayMore'));
        if (more && AppState.userRole && !more.dataset.roleSet) {
            more.dataset.roleSet = '1';
            more.open = AppState.userRole === 'owner' || AppState.userRole === 'manager';
        }
        this.placeDayDetails();

        // Update UI - Main Stats
        this.updateElement('todayTotalPurchases', moneyText(s.purchases));
        this.updateElement('todayPurchaseCount', tn('ui.today.bills_count', s.purchaseCount));
        this.updateElement('todayTotalSales', moneyText(s.sales));
        this.updateElement('todaySaleCount', tn('ui.today.bills_count', s.saleCount));
        this.updateElement('todayLaborCost', moneyText(labour.deducted.amount));
        this.renderLabour(labour);
        
        // Expenses breakdown
        this.updateElement('todayBusinessExpenses', moneyText(s.businessExpenses));
        this.updateElement('todayBusinessExpenseCount', tn('ui.today.entries_count', s.businessExpenseCount));
        this.updateElement('todayPersonalExpenses', moneyText(s.personalExpenses));
        this.updateElement('todayPersonalExpenseCount', tn('ui.today.entries_count', s.personalExpenseCount));
        
        // Total In and Total Out for hero card
        this.updateElement('todayTotalIn', moneyText(s.totalIn));
        this.updateElement('todayTotalOut', moneyText(s.totalOut));
        
        // Nothing in or out yet: a neutral line, not "More went out" over ₹0 (N-18)
        const cashFlowLabel = document.getElementById('todayCashFlowLabel');
        if (cashFlowLabel) {
            const key = !s.totalIn && !s.totalOut ? 'ui.today.net_none' : s.isOutflow ? 'ui.today.net_outflow' : 'ui.today.net_inflow';
            cashFlowLabel.textContent = t(key);
        }
        
        this.updateElement('todayNetCashFlow', moneyText(s.netAmount));

        // Payment summary
        this.updateElement('todayCashReceived', moneyText(s.cashIn));
        this.updateElement('todayOnlineReceived', moneyText(s.onlineIn));
        this.updateElement('todayCashPaid', moneyText(s.cashOut));
        this.updateElement('todayOnlinePaid', moneyText(s.onlineOut));
        
        // Total cash flow with color
        const totalCashFlowEl = document.getElementById('todayTotalCashFlow');
        if (totalCashFlowEl) {
            totalCashFlowEl.textContent = (s.net >= 0 ? '+' : '') + moneyText(s.net);
        }

        // Due summary
        this.updateElement('todayDueReceived', moneyText(s.dueReceived));
        this.updateElement('todayDuePaid', moneyText(s.duePaid));
        this.updateElement('todayDueToReceive', moneyText(s.dueToReceive));
        this.updateElement('todayDueToPay', moneyText(s.dueToPay));

        const showWholesale = this.canSeeWholesale();
        this.renderChannels(s.channels, showWholesale);
        this.renderDayBills(showWholesale ? s.dayBills : s.dayBills.filter(r => r.type !== 'wholesale'));
        this.lastHasBills = s.dayBills.length > 0;
        this.renderCashPrompt(this.lastHasBills, todayIso);

        // Render item-wise details
        this.renderItemWiseDetails(s.purchaseItems, 'purchase');
        this.renderItemWiseDetails(s.saleItems, 'sale');

        // Day report (#187, #40): today's anomalies + review queue, shared with these totals.
        // It and the App health banner are imported when Today first draws (#59).
        const totals = {
            sales: s.sales, saleCount: s.saleCount,
            purchases: s.purchases, purchaseCount: s.purchaseCount,
            expenses: s.expenses, totalIn: s.totalIn, totalOut: s.totalOut,
            dueReceived: s.dueReceived, duePaid: s.duePaid,
            labourDeducted: labour.deducted.amount, labourDeductedBills: labour.deducted.bills,
            labourToPay: labour.toPay
        };
        const todaySession = session && session.date === todayIso ? session : null;
        // App health (#217): a live check below its target today is a line in the Day report, not above the figures (NEW-06)
        const healthLines = import('./health.js').then(({ HealthManager }) => HealthManager.todayAlerts())
            .catch(e => { console.warn('App health checks failed:', e); return []; });
        loadAnomalies().then(m => {
            m.renderDayReport(totals, todaySession);
            return healthLines.then(lines => m.setHealthAlerts(lines));
        }).catch(e => console.warn('Day report failed:', e));
    },

    /**
     * T18: cash / online at save, paid later today, written off and due still open, per bill type (they add up to the total).
     * @param {Object} channels - todaySummary().channels
     * @param {boolean} showWholesale - false hides the Wholesale card
     */
    renderChannels(channels, showWholesale = true) {
        Object.entries(CHANNELS).forEach(([type, k]) => {
            const c = channels[type];
            const card = document.getElementById(`todayCh${k}`);
            if (card) card.hidden = type === 'wholesale' && !showWholesale;
            this.updateElement(`todayCh${k}Count`, tn('ui.today.bills_count', c.count));
            this.updateElement(`todayCh${k}Total`, moneyText(c.total));
            this.updateElement(`todayCh${k}Cash`, moneyText(c.cash));
            this.updateElement(`todayCh${k}Online`, moneyText(c.online));
            this.updateElement(`todayCh${k}PaidLater`, moneyText(c.paidLater));
            this.updateElement(`todayCh${k}Due`, moneyText(c.due));
            this.updateElement(`todayCh${k}WrittenOff`, moneyText(c.writtenOff));
            const off = document.getElementById(`todayCh${k}WrittenOffRow`);
            if (off) off.hidden = !(c.writtenOff > 0);
        });
    },

    /**
     * Reminders (#86): REM-5 manual reminders (owner/manager add them, anyone marks done),
     * REM-1 who to collect from / pay (parties with OVERDUE bills: their whole dues
     * and the overdue part, Outstanding's chase-first order) and REM-2 rent still due as Rentals last
     * showed it this month on this phone. Nothing is read from the server.
     */
    renderReminders(now = new Date()) {
        const host = document.getElementById('todayReminders');
        if (!host) return;
        const role = AppState.userRole;
        const canDue = !role || canOpenPage('due', role, AppState.settings?.roleAccess);
        const canWholesale = this.canSeeWholesale();
        const e = Helpers.escapeHtml;
        const party = (p) => `<li class="today-reminder-party"><span>${e(p.name || t('ui.reports.unknown'))}</span>`
            + ` <strong>${e(moneyText(p.total))}</strong>`
            + ` <span class="today-reminder-days">${e([t('ui.outstanding.party_overdue', { amount: moneyText(p.overdue) }),
                ...(p.oldestDays !== null && p.oldestDays !== undefined ? [tn('ui.today.reminder_days', p.oldestDays)] : [])].join(' · '))}</span>`
            + '</li>';
        const block = (kind, r, open) => reminderOpen(kind)
            + `<div class="today-reminder-head"><strong>${e(t(`ui.today.reminder_${kind}`))}</strong> ${e(moneyText(r.total))}</div>`
            + `<div class="today-reminder-more" data-overdue>${e(t('ui.today.reminder_overdue', { amount: moneyText(r.overdue) }))}</div>`
            + `<ul>${r.parties.map(party).join('')}</ul>`
            + (r.more ? `<div class="today-reminder-more">${e(t('ui.today.reminder_more', { count: r.more }))}</div>` : '')
            + `<button type="button" class="btn btn-sm" data-onclick="${open}">${e(t('ui.today.reminder_open_dues'))}</button></div></div>`;
        const parts = [];
        // The closed card's one line: a short chip per reminder; `late` marks something overdue
        const chips = [];
        let late = false;
        // Manual reminders (#86) first: what someone asked to be done today
        const manual = ManualReminders.html(toLocalISODate(now));
        if (manual) {
            parts.push(manual);
            const m = ManualReminders.summary(toLocalISODate(now));
            if (m.count) chips.push(t('ui.today.rem_chip_todo', { count: m.count }));
            late = late || m.late;
        }
        const add = (kind, bills, open) => {
            const r = overdueReminder(bills, { today: now });
            if (!r.parties.length) return;
            parts.push(block(kind, r, open));
            chips.push(t(`ui.today.rem_chip_${kind}`, { amount: moneyText(r.total) }));
            late = late || r.overdue > 0;
        };
        // Outstanding lists retail customers and suppliers; wholesale dues live on the Wholesale page.
        if (canDue) add('collect', AppState.retailSalesHistory || [], "day.openDues('retail')");
        if (canWholesale) add('collect_wholesale', billsForKind(AppState, 'wholesale'), "nav.showTab('wholesale-outstanding')");
        if (canDue) add('pay', AppState.purchaseHistory || [], "day.openDues('purchase')");
        if (rentalsRole(AppState)) {
            let rent = null;
            try { rent = rentReminder(localStorage, AppState.currentUser?.uid, toLocalISODate(now).slice(0, 7)); } catch (_) { rent = null; }
            if (rent) {
                chips.push(t('ui.today.rem_chip_rent', { amount: moneyText(rent.due) }));
                late = late || rent.late > 0;
                parts.push(`${reminderOpen('rent')}<div class="today-reminder-head"><strong>${e(t('ui.today.reminder_rent'))}</strong> ${e(moneyText(rent.due))}</div>`
                    + `<div>${e(tn('ui.today.reminder_rent_units', rent.dueUnits, { late: rent.late }))}</div>`
                    + `<div class="today-reminder-more">${e(t('ui.today.reminder_as_of', { time: formatDayTime(rent.at, { lang: getLang() }) }))}</div>`
                    + `<button type="button" class="btn btn-sm" data-onclick="rentals.open('rent', event)">${e(t('ui.today.reminder_open_rent'))}</button></div></div>`);
            }
            // REM-4: agreements ending and rent increases due, as the Rent page last saw them this month
            let leases = null;
            try { leases = leaseReminder(localStorage, AppState.currentUser?.uid, toLocalISODate(now).slice(0, 7)); } catch (_) { leases = null; }
            if (leases) {
                chips.push(t('ui.today.rem_chip_leases', { count: leases.items.length + (leases.more || 0) }));
                parts.push(`${reminderOpen('leases')}<div class="today-reminder-head"><strong>${e(t('ui.today.reminder_leases'))}</strong></div>`
                    + `<ul>${leases.items.map(x => `<li class="today-reminder-party"><span>${e([x.place, x.tenant].filter(Boolean).join(' · '))}</span> <span class="today-reminder-days">${e(leaseReminderText(x))}</span></li>`).join('')}</ul>`
                    + (leases.more ? `<div class="today-reminder-more">${e(t('ui.today.reminder_more', { count: leases.more }))}</div>` : '')
                    + `<div class="today-reminder-more">${e(t('ui.today.reminder_as_of', { time: formatDayTime(leases.at, { lang: getLang() }) }))}</div>`
                    + `<button type="button" class="btn btn-sm" data-onclick="rentals.open('tenants', event)">${e(t('ui.today.reminder_open_tenants'))}</button></div></div>`);
            }
        }
        // REM-3 (#63): the owner checks a backup file at least every 30 days
        if (AppState.userRole === 'owner') {
            // U-58: a new shop's first steps, until done or hidden
            const firstRun = this.firstRunHtml();
            if (firstRun) parts.unshift(firstRun);
            // U-55: offer the phone lock once (off until the owner sets a PIN)
            let lockDue = false;
            try { lockDue = appLockOfferDue(localStorage, AppState.currentUser?.uid || '', AppState.userRole); } catch (_) { lockDue = false; }
            if (lockDue) {
                parts.push(`${reminderOpen('lock')}<div class="today-reminder-head"><strong>${e(t('ui.applock.offer_title'))}</strong></div><div>${e(t('ui.applock.offer_text'))}</div>`
                    + `<button type="button" class="btn btn-sm btn-tonal" data-onclick="appLock.setup()">${e(t('ui.applock.set_up'))}</button> `
                    + `<button type="button" class="btn btn-sm btn-ghost" data-onclick="appLock.dismissOffer()">${e(t('ui.applock.no_thanks'))}</button></div></div>`);
            }
            // U-24: people waiting for the owner's approval
            const waiting = getPendingJoins();
            if (waiting > 0) {
                parts.unshift(`${reminderOpen('join')}<div class="today-reminder-head"><strong>${e(tn('ui.today.reminder_join', waiting))}</strong></div>`
                    + `<button type="button" class="btn btn-sm btn-tonal" data-onclick="team.openWaiting()">${e(t('ui.today.reminder_open_join'))}</button></div></div>`);
            }
            // U-08: dues someone else wrote off this week
            const writeOffs = writeOffsByOthers(loadedBillsByKind(), AppState.currentUser?.uid || '', now.getTime());
            if (writeOffs.length) {
                parts.push(`${reminderOpen('writeoff')}<div class="today-reminder-head"><strong>${e(tn('ui.today.reminder_writeoffs', writeOffs.length))}</strong></div>`
                    + `<ul>${writeOffs.slice(0, 3).map(w => `<li class="today-reminder-party"><span>${e([w.billNumber ? `#${w.billNumber}` : '', w.party].filter(Boolean).join(' '))}</span> <strong>${e(moneyText(w.amount))}</strong> <span class="today-reminder-days">${e(t('ui.today.reminder_writeoff_by', { name: w.by || t('ui.reports.unknown') }))}</span></li>`).join('')}</ul>`
                    + `<button type="button" class="btn btn-sm" data-onclick="history.viewBill('${Helpers.escapeJsAttr(`id:${writeOffs[0].billId}`)}', '${Helpers.escapeJsAttr(writeOffs[0].billType)}')">${e(t('ui.today.reminder_open_writeoff'))}</button></div></div>`);
            }
            // WP-11 (#373): salaries due, as the Workers page last worked them out on this phone
            let pay = null;
            try { pay = payDueReminder(localStorage, AppState.currentUser?.uid, toLocalISODate(now).slice(0, 7)); } catch (_) { pay = null; }
            if (pay) {
                chips.push(t('ui.today.rem_chip_salaries', { amount: moneyText(pay.due) }));
                parts.push(`${reminderOpen('salaries')}<div class="today-reminder-head"><strong>${e(t('ui.today.reminder_salaries'))}</strong> ${e(moneyText(pay.due))}</div>`
                    + `<div>${e(tn('ui.today.reminder_salaries_workers', pay.count))}</div>`
                    + `<div class="today-reminder-more">${e(t('ui.today.reminder_salaries_as_of', { time: formatDayTime(pay.at, { lang: getLang() }) }))}</div>`
                    + `<button type="button" class="btn btn-sm" data-onclick="nav.showTab('workers')">${e(t('ui.today.reminder_open_workers'))}</button></div></div>`);
            }
            // RB-11 (#437): bills due within 3 days or overdue, as Recurring bills last worked them out on this phone
            let bills = null;
            try { bills = billsDueReminder(localStorage, AppState.currentUser?.uid, toLocalISODate(now)); } catch (_) { bills = null; }
            if (bills) {
                chips.push(t('ui.today.rem_chip_bills', { count: bills.count }));
                parts.push(`${reminderOpen('bills')}<div class="today-reminder-head"><strong>${e(t('ui.today.reminder_bills', { count: bills.count, amount: moneyText(bills.due) }))}</strong></div>`
                    + (bills.nobill ? `<div>${e(t('ui.today.reminder_bills_nobill', { count: bills.nobill }))}</div>` : '')
                    + `<div class="today-reminder-more">${e(t('ui.today.reminder_bills_as_of', { time: formatDayTime(bills.at, { lang: getLang() }) }))}</div>`
                    + `<button type="button" class="btn btn-sm" data-onclick="nav.showTab('recurring')">${e(t('ui.today.reminder_open_bills'))}</button></div></div>`);
            }
            let drill = null;
            try { drill = drillReminder(localStorage, AppState.currentUser?.uid || '', now.getTime()); } catch (_) { drill = null; }
            if (drill?.due) {
                chips.push(t('ui.today.rem_chip_backup'));
                parts.push(`${reminderOpen('backup')}<div class="today-reminder-head"><strong>${e(t('ui.today.reminder_backup'))}</strong></div>`
                    + `<div>${e(drill.lastAt === null ? t('ui.today.reminder_backup_never') : tn('ui.today.reminder_backup_days', drill.days))}</div>`
                    + `<button type="button" class="btn btn-sm" data-onclick="day.openBackupCheck()">${e(t('ui.today.reminder_open_backup'))}</button></div></div>`);
            }
        }
        const manage = ManualReminders.canManage();
        const addBtn = manage && !ManualReminders.formOpen
            ? `<button type="button" class="btn btn-ghost btn-icon today-reminders-add" title="${e(t('ui.reminders.add_label'))}" aria-label="${e(t('ui.reminders.add_label'))}" data-onclick="day.reminderForm(true)">${icon('plus')}</button>`
            : '';
        if (!parts.length) {
            // Nothing to remind: only the small link for those who add reminders
            host.hidden = !manage;
            host.innerHTML = manage ? `<button type="button" class="btn btn-ghost btn-sm today-reminders-link" data-onclick="day.reminderForm(true)">${e(t('ui.reminders.add'))}</button>` : '';
            return;
        }
        const hadFocus = document.activeElement?.id === 'todayRemindersToggle';
        host.hidden = false;
        host.innerHTML = `<div class="panel today-reminder-list">${disclosureHtml({
            key: TODAY_REMINDERS_KEY, id: 'todayReminders', lead: `<span class="lead-icon">${icon('list')}</span>`,
            title: `<span class="today-reminders-title">${e(t('ui.today.reminders'))}</span>`,
            summary: chips.map(c => `<span>${e(c)}</span>`).join('<span>·</span>'),
            alert: late ? e(t('ui.today.rem_late')) : '',
            tools: addBtn,
            body: parts.join('')
        })}</div>`;
        refocusDisclosure('todayReminders', hadFocus);
        ManualReminders.restoreFocus();
    },

    /**
     * U-58: the owner's first-run checklist (business name, items and rates, team, printer) with
     * where to do each and Help; hidden for good with "Hide this list".
     * @returns {string} HTML ('' when there is nothing to show)
     */
    firstRunHtml() {
        const uid = AppState.currentUser?.uid || '';
        const read = (key) => { try { return localStorage.getItem(`${key}.${uid}`); } catch (_) { return null; } };
        const printer = normalizePrinterSettings(AppState.printerSettings);
        const steps = firstRunSteps({
            shopName: AppState.settings?.shopName,
            itemCount: (AppState.items || []).length,
            teamSeen: read(FIRST_RUN_TEAM_KEY) === '1',
            printerSet: !!printer.deviceId || printer.printers.length > 0
        });
        if (!showFirstRun(steps, { isOwner: AppState.userRole === 'owner', hidden: read(FIRST_RUN_HIDDEN_KEY) === '1' })) return '';
        const e = Helpers.escapeHtml;
        const rows = steps.map(s => `<li class="first-run-step${s.done ? ' done' : ''}">${s.done ? icon('check', 'i-sm') : ''}<span>${e(t(`ui.firstrun.step_${s.id}`))}</span>`
            + (s.done ? '' : ` <button type="button" class="btn btn-sm btn-ghost" data-onclick="nav.showTab('${s.route}', event)">${e(t('ui.firstrun.do_it'))}</button>`) + '</li>').join('');
        return `${reminderOpen('firstrun')}<div class="today-reminder-head"><strong>${e(t('ui.firstrun.title'))}</strong></div>`
            + `<ul class="first-run-list">${rows}</ul>`
            + `<button type="button" class="btn btn-sm" data-onclick="nav.showTab('settings-help', event)">${e(t('ui.firstrun.help'))}</button> `
            + `<button type="button" class="btn btn-sm btn-ghost" data-onclick="day.hideFirstRun()">${e(t('ui.firstrun.hide'))}</button></div></div>`;
    },

    hideFirstRun() {
        safeSetItem(`${FIRST_RUN_HIDDEN_KEY}.${AppState.currentUser?.uid || ''}`, '1');
        this.renderReminders();
    },

    /** Admin › Data, where the owner checks a backup file (REM-3, #63). */
    openBackupCheck() {
        window.app?.nav?.showTab?.('admin');
        setTimeout(() => window.app?.admin?.showTab('data'), 150);
    },

    /** Outstanding on its Purchases or Sales list for this visit (navigation opens it on the remembered list first). */
    openDues(kind) {
        // After the page is in and its own first render (#66: it may load on first visit)
        return Promise.resolve(window.app?.nav?.showTab?.('due')).then(ok => {
            if (ok !== false) setTimeout(() => window.app?.outstanding?.filterDue(kind, { once: true }), 150);
        });
    },

    /** Wholesale cards and bills only for roles that may open the Wholesale page. */
    canSeeWholesale() {
        const role = AppState.userRole;
        return !role || canOpenPage('wholesale-sales', role, AppState.settings?.roleAccess);
    },

    showAllBills: false,
    lastHasBills: false,

    /**
     * T19: today's bills, newest first; a row opens the bill (History's bill details).
     * @param {Array<{type: string, bill: Object, at: number, total: number}>} rows - todaySummary().dayBills
     */
    renderDayBills(rows) {
        const list = document.getElementById('todayBillsList');
        if (!list) return;
        const esc = (v) => Helpers.escapeHtml(v == null ? '' : String(v));
        if (!rows.length) {
            list.innerHTML = emptyState({ icon: 'receipt', title: t('ui.today.no_bills_today') });
        } else {
            const shown = this.showAllBills ? rows : rows.slice(0, BILLS_SHOWN);
            list.innerHTML = shown.map(({ type, bill, at, total }) => {
                const party = bill.customerName || bill.seller || bill.buyer || (type === 'retail' ? t('ui.today.walk_in') : '');
                const no = bill.billNumber ? `#${bill.billNumber}` : '';
                const ref = Helpers.escapeJsAttr(`id:${bill.id}`);
                return `<button type="button" class="today-bill-${type}" data-today-bill data-onclick="history.viewBill('${ref}', '${type}')" aria-label="${esc(t('ui.today.bill_open_aria', { bill: [t(BILL_KIND_KEYS[type]), no, party].filter(Boolean).join(' ') }))}">
                    <span class="today-bill-time">${esc(at ? Helpers.formatTime(new Date(at)) : '')}</span>
                    <span class="today-bill-main"><span class="today-bill-party">${esc(party || no)}</span><span class="today-bill-kind">${esc([t(BILL_KIND_KEYS[type]), party ? no : '']                    .filter(Boolean).join(' · '))}</span>${SyncStatus.chipHtml(bill.id)}</span>
                    <strong class="today-bill-total">${esc(moneyText(total))}</strong>
                </button>`;
            }).join('');
        }
        const more = document.getElementById('todayBillsMore');
        if (more) {
            more.hidden = rows.length <= BILLS_SHOWN;
            more.textContent = this.showAllBills ? t('ui.today.bills_less') : t('ui.today.bills_more', { count: rows.length });
        }
    },

    toggleAllBills() {
        this.showAllBills = !this.showAllBills;
        this.loadTodayData();
    },

    /**
     * "Open cash" prompt (#141, Q41): today has bills and the day's sessions are loaded and none is open.
     * @param {boolean} hasBills
     * @param {string} todayIso
     */
    renderCashPrompt(hasBills, todayIso) {
        const el = document.getElementById('todayCashPrompt');
        if (!el) return;
        const loaded = this.daySessions.date === todayIso;
        el.hidden = !(hasBills && loaded && this.sessionsOn(todayIso).length === 0);
    },

    /**
     * Render item-wise purchase or sale cards (T17)
     * @param {Array<Object>} itemsArray - todaySummary().purchaseItems / saleItems
     * @param {string} type - 'purchase' or 'sale'
     */
    renderItemWiseDetails(itemsArray, type) {
        const containerId = type === 'purchase' ? 'todayPurchaseItems' : 'todaySaleItems';
        const container = document.getElementById(containerId);
        if (!container) return;

        if (itemsArray.length === 0) {
            container.innerHTML = emptyState({ icon: 'receipt', title: t(type === 'purchase' ? 'ui.today.no_purchases_today' : 'ui.today.no_sales_today') });
            return;
        }

        const label = (key) => Helpers.escapeHtml(t(key));
        const countKey = type === 'purchase' ? 'ui.today.purchases_label' : 'ui.today.sales_label';
        container.innerHTML = itemsArray.map(item => `
                <div class="row day-item">
                    <div class="row-main">
                        <div class="row-title">${Helpers.escapeHtml(item.name)}</div>
                        <div class="row-meta">${label(countKey)} <strong>${item.count}x</strong> · ${label('ui.today.qty_label')} <strong>${formatKg(item.quantity)} kg</strong> · ${label('ui.billing.total_colon')} <strong class="row-amt">${moneyText(item.totalValue)}</strong> · ${label('ui.today.avg_rate_label')} <strong>${formatRate(item.avgRate ?? 0)}/kg</strong></div>
                    </div>
                </div>`).join('');
    },

    /**
     * Helper to update element text
     */
    /**
     * Loads today's personal expense total for a role that can't read the rows
     * (#98) and redraws once it arrives (FirebaseService reuses it for a minute).
     * @param {string} day YYYY-MM-DD
     */
    loadPersonalDay(day) {
        if (this.personalDayLoading) return;
        const before = JSON.stringify(FirebaseService.personalExpenseDay?.(day) ?? null);
        this.personalDayLoading = Promise.resolve(FirebaseService.loadPersonalExpenseDay?.(day))
            .then(() => {
                if (JSON.stringify(FirebaseService.personalExpenseDay?.(day) ?? null) !== before
                    && document.getElementById('todayTotalIn')) this.loadTodayData();
            })
            .catch(e => console.warn('Personal expense day total not loaded:', e))
            .finally(() => { this.personalDayLoading = null; });
    },

    updateElement(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    },

    /**
     * Today › Labour card: Deducted (T-LAB-1), Paid (T-LAB-4) and Pay, the estimate (T-LAB-2). An amber line under
     * Paid (T-LAB-5) or Pay (T-LAB-3) only when it differs from deducted; the working is in the breakdown.
     * @param {Object} labour - todaySummary().labour (labourSummary + gap + packets)
     */
    renderLabour(labour) {
        this.lastLabour = labour;
        const { toPay, gap, paid, paidGap } = labour;
        const diffLine = (id, text) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.textContent = text;
            el.hidden = !text;
        };
        if (paid) {
            this.updateElement('todayLabourPaid', moneyText(paid.amount));
            const key = LABOUR_PAID_KEYS[paidGap.kind];
            diffLine('todayLabourPaidDiff', key ? t(key, { amount: moneyText(paidGap.amount) }) : '');
        }
        this.updateElement('todayLabourToPay', moneyText(toPay.amount));
        diffLine('todayLabourDiff', gap.kind === 'same' ? '' : t('ui.today.labour_pay_differs', { amount: moneyText(gap.amount) }));
    },

    /** Tap on the Labour card: today's purchase bills with kg, packets and labour deducted. */
    showLabourBreakdown() {
        const labour = this.lastLabour;
        if (!labour) return Promise.resolve(false);
        const esc = (v) => Helpers.escapeHtml(v == null ? '' : String(v));
        const { deducted, toPay, rows, packets } = labour;
        const body = rows.length ? rows.map(({ bill, kg, packets, labour: amount }) => {
            const name = [bill.billNumber ? `#${bill.billNumber}` : '', bill.customerName || bill.seller || ''].filter(Boolean).join(' ');
            return `<tr><td>${esc(name || t('ui.reports.unknown'))}</td><td>${esc(formatKg(kg))}</td><td>${esc(packets)}</td><td>${esc(moneyText(amount))}</td></tr>`;
        }).join('') : `<tr><td colspan="4">${esc(t('ui.today.no_purchases_today'))}</td></tr>`;
        const html = `
            <table class="table labour-breakdown">
                <thead><tr><th>${esc(t('ui.today.labour_col_bill'))}</th><th>${esc(t('ui.today.labour_col_kg'))}</th><th>${esc(t('ui.today.labour_col_packets'))}</th><th>${esc(t('ui.today.labour_col_deducted'))}</th></tr></thead>
                <tbody>${body}</tbody>
                <tfoot><tr><th>${esc(t('ui.today.labour_total'))}</th><th>${esc(formatKg(toPay.kg))}</th><th>${esc(packets)}</th><th>${esc(moneyText(deducted.amount))}</th></tr></tfoot>
            </table>
            <p class="labour-breakdown-note"><strong>${esc(t('ui.today.labour_to_pay'))}</strong> ${esc(moneyText(toPay.amount))} ${esc(labourCalcText(toPay, 'ui.today.labour_to_pay_calc'))}</p>
            <p class="labour-breakdown-note">${esc(t('ui.today.labour_part_package'))}</p>
            <p class="labour-breakdown-note">${esc(t('ui.today.labour_note'))}</p>`;
        return UIManager.showModalWithHtml(html, t('ui.today.labour_breakdown_title'));
    },

    /**
     * Filter transactions based on dropdown
     */
    filterTransactions() {
        this.loadTodayData();
    },

    /**
     * Today › Cash shows the Cash page itself: its one body moves here, so
     * there is a single copy of every cash element id (#96).
     */
    loadCashManagement() {
        const container = document.getElementById('dayCashManagementContainer');
        const body = document.querySelector('#cash-management .cash-body, #dayCashManagementContainer .cash-body');
        if (!container || !body) return;
        if (body.parentElement !== container) container.appendChild(body);
        if (this.cashInit) return this.cashInit;
        this.cashInit = Promise.resolve(window.app?.cashManagement?.init())
            .catch(e => console.error('Cash management init failed:', e))
            .finally(() => { this.cashInit = null; });
        return this.cashInit;
    },

    /** Moves the cash body back to the Cash page before that page opens. */
    returnCashBody() {
        const page = document.getElementById('cash-management');
        const body = document.querySelector('#dayCashManagementContainer .cash-body');
        if (page && body) page.appendChild(body);
    }
};

// Bills or expenses changed (another phone, a void): redraw Today while it shows.
on(REFRESH.today, () => { if (DayManager.currentSubTab === 'today') DayManager.loadTodayData(); });
on(REMINDERS_CHANGED, () => {
    if (DayManager.currentSubTab === 'today' && document.getElementById('day')?.classList.contains('active')) DayManager.renderReminders();
});
