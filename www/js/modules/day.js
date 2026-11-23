// -------------------- DAY MODULE --------------------
// Manages the Day page with Today's Summary and Cash Management sub-tabs

import { AppState } from '../utils/state.js';
import { UIManager } from '../ui/ui-manager.js';
import { Helpers } from '../utils/helpers.js';
import { formatKg, labourCalcText } from '../utils/labour.js';
import { todayLocalISO, displayLocale, toLocalISODate, formatDayTime, formatDate as dateText } from '../utils/dates.js';
import { todaySummary } from '../utils/calc/today.js';
import { FirebaseService } from '../firebase/firestore-service.js';
import { CashManagementManager } from './cash-management.js';
import { sessionForDate } from '../utils/cash-session.js';
import { closedCount, drawerStatus } from '../utils/calc/cash.js';
import { t, tn, getLang, loadAllCatalogues } from '../i18n/index.js';
import { canOpenPage, canOpenSection } from '../utils/role-access.js';
import { on, REFRESH, REMINDERS_CHANGED } from '../utils/events.js';
import { overdueReminder } from '../utils/reminders.js';
import { drillReminder } from '../utils/backup-verify.js';
import { billsForKind } from '../utils/party-due.js';
import { formatAmount, moneyText } from '../utils/money.js';
import { ManualReminders, TODAY_REMINDERS_KEY } from '../ui/manual-reminders.js';
import { disclosureHtml, refocusDisclosure } from '../ui/disclosure.js';
import { icon } from '../ui/icons.js';
import { payDueReminder, billsDueReminder } from '../utils/pay-reminder.js';
import { getPendingJoins, writeOffsByOthers } from '../utils/owner-alerts.js';
import { firstRunSteps, showFirstRun, appLockOfferDue, FIRST_RUN_HIDDEN_KEY, FIRST_RUN_TEAM_KEY } from '../utils/first-run.js';
import { normalizePrinterSettings } from '../utils/printer-settings.js';
import { safeSetItem } from '../utils/storage-full.js';

const CHANNELS = { retail: 'Retail', wholesale: 'Wholesale', purchase: 'Purchase' };
const BILL_KIND_KEYS = { retail: 'ui.finance.bill_retail', wholesale: 'ui.finance.bill_wholesale', purchase: 'ui.reports.pdf_purchase' };
const WIDE_TODAY = '(min-width: 1280px)';
/** Today's own disclosures (happa.open.<key>), closed by default on a phone; open panels on a desktop. */
export const TODAY_LABOUR_KEY = 'today-labour';
export const TODAY_DUES_KEY = 'today-dues';
export const TODAY_ITEMS_KEY = 'today-items';
const ITEM_TYPES = [['purchase', 'ui.reports.pdf_purchase', ''], ['retail', 'ui.finance.bill_retail', ' sale'], ['wholesale', 'ui.finance.bill_wholesale', ' wholesale']];
/**
 * Writes a Today block's markup and gives the focus back to the control that had it (same id, else the same action),
 * so a data refresh never drops a keyboard or screen-reader user to the page.
 * @param {HTMLElement} host
 * @param {string} html
 */
const redraw = (host, html) => {
    const had = /** @type {?HTMLElement} */ (document.activeElement);
    const inside = !!had && had !== host && host.contains(had);
    const id = inside ? had.id : '';
    const action = inside ? had.dataset?.onclick : '';
    host.innerHTML = html;
    const back = id ? document.getElementById(id) : action ? [...host.querySelectorAll('[data-onclick]')].find(x => x.dataset.onclick === action) : null;
    back?.focus();
};
/** Bills in memory by kind, for the owner's write-off reminder (U-08). */
const loadedBillsByKind = () => ({ purchase: AppState.purchaseHistory || [], retail: AppState.retailSalesHistory || [], wholesale: AppState.salesHistory || [] });
const REMINDER_ICONS = {
    collect: icon('arrIn'), collect_wholesale: icon('truck'), pay: icon('arrOut'),
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
            this.wideToday.addEventListener?.('change', () => {
                this.placeDayDetails();
                if (this.lastSummary) this.loadTodayData();
            });
        }
        this.placeDayDetails();
    },

    /** ≥ 1280 px: two columns, Labour, Dues today and Items as open panels. */
    isWide() {
        return !!this.wideToday?.matches;
    },

    /**
     * At ≥ 1280 px the Cash in drawer row heads the right column; narrower it sits between the hero and the
     * tiles, so the phone order stays.
     */
    placeDayDetails() {
        const side = document.querySelector('#dayTodayContent .today-side');
        const drawer = document.getElementById('todayDrawer');
        const tiles = document.querySelector('#dayTodayContent .today-metrics');
        if (!side || !drawer || !tiles) return;
        if (this.isWide()) {
            if (drawer.parentElement !== side) side.prepend(drawer);
        } else if (drawer.nextElementSibling !== tiles) {
            tiles.before(drawer);
        }
    },

    /** Pull-to-refresh and the desktop refresh button: the day's figures again, and the Day report rescanned. */
    refresh() {
        this.init();
        if (AppState.userRole !== 'owner' && AppState.userRole !== 'manager') return Promise.resolve(true);
        // After the redraw's own (cached) refresh, so the server rescan isn't folded into it
        return loadAnomalies().then(m => Promise.resolve(m.refreshing).then(() => m.refreshNow()))
            .catch(e => console.warn('Day report refresh failed:', e));
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
                else this.renderDrawer(today);
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
        this.lastSummary = s;
        this.renderReminders();
        this.placeDayDetails();
        const wide = this.isWide();

        // Tiles: the figure, and the count on the label line
        this.updateElement('todayTotalPurchases', moneyText(s.purchases));
        this.updateElement('todayPurchaseCount', String(s.purchaseCount));
        this.updateElement('todayTotalSales', moneyText(s.sales));
        this.updateElement('todaySaleCount', String(s.saleCount));
        this.renderSettle(s, wide);
        this.renderCashOnline();
        this.updateElement('todayLaborCost', moneyText(labour.deducted.amount));
        this.renderLabour(labour);
        
        // Expenses breakdown
        this.updateElement('todayBusinessExpenses', moneyText(s.businessExpenses));
        this.updateElement('todayBusinessExpenseCount', String(s.businessExpenseCount));
        this.updateElement('todayPersonalExpenses', moneyText(s.personalExpenses));
        this.updateElement('todayPersonalExpenseCount', String(s.personalExpenseCount));
        
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
        this.renderMeter(s.totalIn, s.totalOut);

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
        this.lastChannels = s.channels;
        this.lastShowWholesale = showWholesale;
        this.renderDetails(s, showWholesale ? s.dayBills : s.dayBills.filter(r => r.type !== 'wholesale'), showWholesale, wide);
        this.lastHasBills = s.dayBills.length > 0;
        this.renderDrawer(todayIso);

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
     * The hero's meter: T10 in and T11 out as the two shares of one bar (no new figure); hidden when both are ₹0.
     * @param {number} totalIn
     * @param {number} totalOut
     */
    renderMeter(totalIn, totalOut) {
        const el = document.getElementById('todayMeter');
        if (!el) return;
        const a = Math.max(0, Number(totalIn) || 0);
        const b = Math.max(0, Number(totalOut) || 0);
        el.hidden = !(a + b > 0);
        el.innerHTML = el.hidden ? '' : [['in', a], ['out', b]].filter(([, v]) => v > 0)
            .map(([k, v]) => `<span class="today-meter-${k === 'in' ? 'in' : 'out'}" style="--w: ${Number(v)}"></span>`).join('');
    },

    /**
     * T18 one tap away: tapping the Purchases or Sales tile opens that type's split (Sales: Retail and Wholesale):
     * cash / online at save, paid later today, written off and due still open; they add up to the total.
     * @param {'purchase'|'sale'} kind
     */
    showSplit(kind) {
        const channels = this.lastChannels;
        if (!channels) return Promise.resolve(false);
        const esc = (v) => Helpers.escapeHtml(v == null ? '' : String(v));
        const types = kind === 'purchase' ? ['purchase'] : ['retail', ...(this.lastShowWholesale ? ['wholesale'] : [])];
        const line = (k, f, key, amount) => `<div class="row"><span class="row-main">${esc(t(key))}</span><strong class="row-trail row-amt" id="todayCh${esc(k)}${esc(f)}">${esc(moneyText(amount))}</strong></div>`;
        const blocks = types.map(type => {
            const c = channels[type];
            const k = CHANNELS[type];
            return `<section class="today-split" data-split="${esc(type)}">
                <h3 class="section-title today-split-head"><span>${esc(t(BILL_KIND_KEYS[type]))}</span> <span class="tone-muted" id="todayCh${esc(k)}Count">${esc(tn('ui.today.bills_count', c.count))}</span> <strong class="today-split-total" id="todayCh${esc(k)}Total">${esc(moneyText(c.total))}</strong></h3>
                <div class="panel">${line(k, 'Cash', 'ui.today.ch_cash', c.cash)}${line(k, 'Online', 'ui.today.ch_online', c.online)}${line(k, 'PaidLater', 'ui.today.ch_paid_later', c.paidLater)}${line(k, 'Due', 'ui.today.ch_due', c.due)}${c.writtenOff > 0 ? line(k, 'WrittenOff', 'ui.today.ch_written_off', c.writtenOff) : ''}</div>
            </section>`;
        }).join('');
        const html = `${blocks}<p class="row-meta today-split-note">${esc(t('ui.today.split_note'))}</p>`;
        return UIManager.showModalWithHtml(html, t(kind === 'purchase' ? 'ui.today.split_title_purchase' : 'ui.today.split_title_sale'));
    },
    /**
     * Reminders (#86): REM-5 manual reminders (owner/manager add them, anyone marks done),
     * REM-1 who to collect from / pay (parties with OVERDUE bills: their whole dues
     * and the overdue part, Outstanding's      chase-first order).
          * Rentals' rent and agreement reminders stay on the Rentals home. Nothing is read from the server.
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
        // Rentals' own reminders (rent due REM-2, agreements REM-4) are on the Rentals home, not on Aadhat's Today; the bell and phone keep them
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
            // Nothing to remind: one line with ＋ for those who add reminders
            host.hidden = !manage;
            host.innerHTML = manage ? `<div class="row today-link today-reminders-link"><span class="row-main row-title">${e(t('ui.today.reminders'))}</span>${addBtn}</div>` : '';
            return;
        }
        const hadFocus = document.activeElement?.id === 'todayRemindersToggle';
        host.hidden = false;
        host.innerHTML = disclosureHtml({
            key: TODAY_REMINDERS_KEY, id: 'todayReminders', line: true,
            title: `<span class="today-reminders-title">${e(t('ui.today.reminders'))}</span>`,
            summary: chips.map(c => `<span>${e(c)}</span>`).join('<span>·</span>'),
            alert: late ? e(t('ui.today.rem_late')) : '',
            tools: addBtn,
            body: parts.join('')
        });
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

    lastHasBills: false,

    /**
     * Cash in drawer (C7, C8): one row from the day's session already on the phone (no read of its own). Open:
     * since when and what should be in the drawer; closed: the count against it; none: Open cash.
     * @param {string} todayIso
     */
    renderDrawer(todayIso) {
        const el = document.getElementById('todayDrawer');
        if (!el) return;
        const live = CashManagementManager.todaySession;
        const session = live && live.date === todayIso ? live : sessionForDate(this.daySessions.date === todayIso ? this.daySessions.list : [], todayIso);
        const loaded = this.daySessions.date === todayIso || !!session;
        el.hidden = !loaded;
        if (!loaded) return;
        const e = Helpers.escapeHtml;
        const title = `<span class="row-title">${e(t(session ? 'ui.today.drawer' : 'ui.today.drawer_not_open'))}</span>`;
        let state = 'none';
        let meta = '';
        let trail = `<button type="button" class="btn btn-sm btn-tonal" data-onclick="day.showSubTab('cash')">${e(t('ui.today.open_cash'))}</button>`;
        if (session) {
            const count = closedCount(session);
            const chev = icon('chevR', 'i-sm');
            if (count) {
                state = count.kind;
                meta = e(t('ui.today.drawer_counted'));
                const tone = { match: 'tone-pos', short: 'tone-neg', extra: 'tone-warn' }[count.kind];
                const text = count.kind === 'match' ? `${icon('check', 'i-sm')}${e(t('ui.today.drawer_match'))}`
                    : e(t(`ui.today.drawer_${count.kind}`, { amount: moneyText(count.amount) }));
                trail = `<strong class="row-amt ${tone}">${text}</strong>${chev}`;
            } else {
                state = 'open';
                const tx = CashManagementManager.calculateTransactionsForDate(todayIso, session);
                const since = dateText(session.signInTime, 'time');
                meta = since ? e(t('ui.today.drawer_since', { time: since })) : '';
                trail = `<strong class="row-amt" id="todayDrawerCash">${e(moneyText(drawerStatus(session, tx).availableCash))}</strong>${chev}`;
            }
        }
        el.dataset.state = state;
        const main = `<span class="row-main">${title}${meta ? `<span class="row-meta">${meta}</span>` : ''}</span>`;
        redraw(el, session
            ? `<button type="button" class="row" data-onclick="day.showSubTab('cash')">${main}<span class="row-trail">${trail}</span></button>`
            : `<div class="row">${main}<span class="row-trail">${trail}</span></div>`);
    },

    /**
     * Settle today: Labour (deducted T-LAB-1, estimated pay T-LAB-2, paid T-LAB-4) and Dues today (collected T13,
     * paid off T14, new to collect T15, new to pay T16). One line each on a phone (closed by default, remembered),
     * open panels on a desktop. No mismatch lines: the working is in Details.
     * @param {Object} s - todaySummary()
     * @param {boolean} wide
     */
    renderSettle(s, wide) {
        const host = document.getElementById('todaySettle');
        if (!host) return;
        const e = Helpers.escapeHtml;
        const role = AppState.userRole;
        const { labour } = s;
        const row = (key, id, amount, { tone = '', lead = '' } = {}) => `<div class="row"><span class="row-main">${lead}${e(t(key))}</span>`
            + `<strong class="row-trail row-amt${tone ? ` ${tone}` : ''}" id="${id}">${e(moneyText(amount))}</strong></div>`;
        const labourBody = [
            row('ui.today.labour_row_deducted', 'todayLaborCost', labour.deducted.amount),
            row('ui.today.labour_row_pay', 'todayLabourToPay', labour.toPay.amount),
            row('ui.today.labour_row_paid', 'todayLabourPaid', labour.paid?.amount ?? 0)
        ].join('') + '<div class="today-links">'
            + (canOpenSection('money', 'labour', role, AppState.settings?.roleAccess)
                ? `<button type="button" class="btn btn-ghost btn-sm" id="todayLabourHistory" data-onclick="nav.showTab('money-labour')">${e(t('ui.today.labour_history'))}${icon('chevR', 'i-sm')}</button>` : '')
            + `<button type="button" class="btn btn-ghost btn-sm" data-onclick="day.showLabourBreakdown()">${e(t('ui.today.labour_details'))}${icon('chevR', 'i-sm')}</button></div>`;
        const canDue = !role || canOpenPage('due', role, AppState.settings?.roleAccess);
        const duesBody = [
            row('ui.today.dues_collected', 'todayDueReceived', s.dueReceived, { tone: 'tone-pos', lead: icon('arrIn', 'i-sm tone-pos') }),
            row('ui.today.dues_paid_off', 'todayDuePaid', s.duePaid, { tone: 'tone-out', lead: icon('arrOut', 'i-sm tone-out') }),
            row('ui.today.dues_new_collect', 'todayDueToReceive', s.dueToReceive, { tone: 'tone-warn' }),
            row('ui.today.dues_new_pay', 'todayDueToPay', s.dueToPay, { tone: 'tone-warn' })
        ].join('') + (canDue ? `<div class="today-links"><button type="button" class="btn btn-ghost btn-sm" data-onclick="nav.showTab('due', event)">${e(t('ui.today.reminder_open_dues'))}${icon('chevR', 'i-sm')}</button></div>` : '');
        const num = (v) => `<strong>${e(moneyText(v))}</strong>`;
        if (wide) {
            redraw(host, `<section class="panel panel-float today-labour" id="todayLabourCard"><h3 class="panel-legend">${e(t('ui.today.labor'))}</h3>${labourBody}</section>`
                + `<section class="panel panel-float" id="todayDuesCard"><h3 class="panel-legend">${e(t('ui.today.dues_today'))}</h3>${duesBody}</section>`);
            return;
        }
        redraw(host, `<div class="panel today-stack">${disclosureHtml({
            key: TODAY_LABOUR_KEY, id: 'todayLabour', line: true,
            title: e(t('ui.today.labor')),
            summary: `<span>${e(t('ui.today.labour_sum_deducted'))} ${num(labour.deducted.amount)}</span> <span>·</span> <span>${e(t('ui.today.labour_sum_est'))} ${num(labour.toPay.amount)}</span>`,
            body: `<div class="today-labour" id="todayLabourCard">${labourBody}</div>`
        })}${disclosureHtml({
            key: TODAY_DUES_KEY, id: 'todayDues', line: true,
            title: e(t('ui.today.dues_today')),
            summary: `<span>${e(t('ui.today.dues_sum_get'))} <strong class="tone-warn">${e(moneyText(s.dueToReceive))}</strong></span> <span>·</span> <span>${e(t('ui.today.dues_sum_pay'))} <strong class="tone-warn">${e(moneyText(s.dueToPay))}</strong></span>`,
            body: duesBody
        })}</div>`);
    },

    /**
     * Cash and online in (T6, T7) and out (T8, T9) as rows; in green with ↙, out in indigo with ↗.
     * @param {Object} s - todaySummary()
     * @param {boolean} [ids] the ids the figures are known by (one copy on screen)
     * @returns {string}
     */
    cashOnlineRows(s, ids = false) {
        const e = Helpers.escapeHtml;
        const lead = { in: icon('arrIn', 'i-sm tone-pos'), out: icon('arrOut', 'i-sm tone-out') };
        const row = (key, id, value, dir) => `<div class="row"><span class="row-main">${lead[dir]}${e(t(key))}</span>`
            + `<strong class="row-trail row-amt ${dir === 'in' ? 'tone-pos' : 'tone-out'}"${ids ? ` id="${id}"` : ''}>${e(moneyText(value))}</strong></div>`;
        return [
            row('ui.today.cash_in', 'todayCashReceived', s.cashIn, 'in'), row('ui.today.online_in', 'todayOnlineReceived', s.onlineIn, 'in'),
            row('ui.today.cash_out', 'todayCashPaid', s.cashOut, 'out'), row('ui.today.online_out', 'todayOnlinePaid', s.onlineOut, 'out')
        ].join('');
    },

    /** Cash and online at the end of the right column, shown at ≥ 1280 px only (day.css); a phone opens it from Total in / out. */
    renderCashOnline() {
        const host = document.getElementById('todayCashOnline');
        if (!host || !this.lastSummary) return;
        redraw(host, `<section class="panel panel-float" id="todayCashOnlineCard"><h3 class="panel-legend">${Helpers.escapeHtml(t('ui.today.cash_online'))}</h3>${this.cashOnlineRows(this.lastSummary, true)}</section>`);
    },

    /** Total in / Total out in the hero: the day's cash and online split as a sheet. */
    showInOut() {
        const s = this.lastSummary;
        if (!s) return Promise.resolve(false);
        return UIManager.showModalWithHtml(`<div class="panel today-inout-split">${this.cashOnlineRows(s)}</div>`, t('ui.today.cash_online'));
    },

    /**
     * Details: Items (T17, one table per bill type, closed by default on a phone) and the Today's bills row (T19,
     * opening History on Today). At ≥ 1280 px the tables are open panels and the title reads Items.
     * @param {Object} s - todaySummary()
     * @param {Array<{type: string}>} rows - todaySummary().dayBills (wholesale left out for a role without Wholesale)
     * @param {boolean} showWholesale
     * @param {boolean} wide
     */
    renderDetails(s, rows, showWholesale, wide) {
        const section = document.getElementById('todayDetails');
        const host = document.getElementById('todayDetailsBody');
        if (!section || !host) return;
        const e = Helpers.escapeHtml;
        section.hidden = !rows.length;
        this.updateElement('todayDetailsTitle', t(wide ? 'ui.today.items' : 'ui.today.group_details'));
        const lists = { purchase: s.purchaseItems, retail: s.retailItems || [], wholesale: showWholesale ? (s.wholesaleItems || []) : [] };
        const bills = (type) => rows.filter(r => r.type === type).length;
        const shown = ITEM_TYPES.filter(([type]) => lists[type].length);
        const block = ([type, key, dot]) => {
            const head = `<span class="mode-dot${dot}" aria-hidden="true"></span><span>${e(t(key))}</span><span class="today-items-meta">${e(tn('ui.today.bills_count', bills(type)))}</span>`;
            const table = this.itemsTableHtml(type, lists[type]);
            return wide
                ? `<section class="panel panel-float" data-items="${type}"><h3 class="panel-legend today-items-head">${head}</h3>${table}</section>`
                : `<div class="today-items-block" data-items="${type}"><h4 class="today-items-head">${head}</h4>${table}</div>`;
        };
        const billsRow = `<button type="button" class="row today-link" id="todayBillsLink" data-onclick="nav.showTab('history-today', event)">`
            + `<span class="row-main row-title">${e(t('ui.today.bills_title'))}</span><span class="row-trail" id="todayBillsCount">${e(String(rows.length))}</span>${icon('chevR', 'i-sm')}</button>`;
        if (wide) {
            const [first, ...rest] = shown;
            redraw(host, (shown.length ? `<div class="today-items-grid"><div>${first ? block(first) : ''}</div><div>${rest.map(block).join('')}</div></div>` : '')
                + `<div class="panel today-stack">${billsRow}</div>`);
            return;
        }
        redraw(host, `<div class="panel today-stack">${shown.length ? disclosureHtml({
            key: TODAY_ITEMS_KEY, id: 'todayItems', line: true,
            title: e(t('ui.today.items')),
            summary: `<span>${e(t('ui.today.items_sum', { bought: s.purchaseItems.length, sold: (showWholesale ? s.saleItems : s.retailItems || []).length }))}</span>`,
            body: `<div class="today-items-wrap">${shown.map(block).join('')}</div>`
        }) : ''}${billsRow}</div>`);
    },

    /**
     * One bill type's items: Item | kg | ₹/kg | Total, highest total first, one line each; "×N" when the item is on
     * more than one bill. No total row (item lines before labour don't add up to the bill totals).
     * @param {string} type
     * @param {Array<{name: string, bills?: number, count: number, quantity: number, totalValue: number, avgRate: ?number}>} items
     * @returns {string}
     */
    itemsTableHtml(type, items) {
        const e = Helpers.escapeHtml;
        const ids = { purchase: 'todayPurchaseItems', retail: 'todayRetailItems', wholesale: 'todayWholesaleItems' };
        const col = (key) => `<th scope="col">${e(t(key))}</th>`;
        const body = items.map(item => {
            const n = item.bills ?? item.count;
            const badge = n > 1 ? `<span class="today-items-n" title="${e(tn('ui.today.bills_count', n))}">×${e(String(n))}</span>` : '';
            return `<tr><th scope="row"><span class="today-items-cell"><span class="today-items-name">${e(item.name)}</span>${badge}</span></th><td>${e(formatKg(item.quantity))}</td>`
                + `<td>${item.avgRate === null || item.avgRate === undefined ? '' : e(formatAmount(item.avgRate, { exact: true }))}</td><td>${e(moneyText(item.totalValue))}</td></tr>`;
        }).join('');
        return `<table class="table today-items" id="${ids[type]}"><thead><tr>${col('ui.today.items_col_item')}${col('ui.today.items_col_kg')}${col('ui.today.items_col_rate')}${col('ui.today.items_col_total')}</tr></thead><tbody>${body}</tbody></table>`;
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
     * Today › Labour: Deducted (T-LAB-1), Estimated pay (T-LAB-2) and Paid (T-LAB-4); no mismatch lines (owner, Today
     * layout): the working is in the breakdown.
     * @param {Object} labour - todaySummary().labour (labourSummary + gap + packets)
     */
    renderLabour(labour) {
        this.lastLabour = labour;
        this.updateElement('todayLabourPaid', moneyText(labour.paid?.amount ?? 0));
        this.updateElement('todayLabourToPay', moneyText(labour.toPay.amount));
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
