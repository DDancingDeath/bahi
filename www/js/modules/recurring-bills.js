/**
 * @fileoverview Recurring bills (#437): electricity, water, rent and other repeating payments. Each bill
 * item has a cadence; each period has a bill amount, payments and a balance carried to the next period
 * (docs/calculations.md RB-1 … RB-12). The owner, managers and members (Roles & access) see it and pay;
 * the owner and managers keep the items. A payment counts in Money and Today through its one expense,
 * saved with it (RB-12). Imported on first open; one read per bill item per open.
 * @module modules/recurring-bills
 */

import { UIManager } from '../ui/ui-manager.js';
import { Helpers } from '../utils/helpers.js';
import { AppState } from '../utils/state.js';
import { t, getLang } from '../i18n/index.js';
import { emptyState, skeleton } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { formatRupees, moneyText } from '../utils/money.js';
import { formatMonth, formatDay, todayLocalISO } from '../utils/dates.js';
import * as repo from '../firebase/repos/recurring-bills.js';
import {
    MAX_NAME, MAX_NOTE, MAX_DUE_DAY, CADENCES, balanceParts, billsSummary, billsDueDays, checkItem, checkEntry,
    entryPeriods, unusualBill, isMonthKey, periodOf, monthKeyOf, billsAfter
} from '../utils/recurring-bills.js';
import { saveBillsDue } from '../utils/pay-reminder.js';
import { FirebaseService } from '../firebase/firestore-service.js';
import { askReason } from '../ui/bill-status.js';
import { infoTipHtml } from '../ui/info-tip.js';
import { canOpenTab, canVoidExpenseWith } from '../utils/role-access.js';
import { validateExpenseEntry } from '../utils/expense-entry.js';
import { backdatedCash } from '../utils/bill-date.js';
import { billExpense, linkCandidates, payExpenseId, payFromExpense, expenseDayOf } from '../utils/linked-expense.js';
import { isPermissionDenied } from '../utils/record-permissions.js';

const esc = (v) => Helpers.escapeHtml(v == null ? '' : String(v));
const js = (v) => Helpers.escapeJsAttr(v);
const et = (key, p) => esc(t(key, p));
const byId = (id) => document.getElementById(id);
const val = (id) => (byId(id)?.value ?? '').trim();
const monthName = (key) => formatMonth(`${key}-01`, { lang: getLang() });
const dayName = (day) => formatDay(day, { lang: getLang() });
const today = () => todayLocalISO();
const role = () => AppState.userRole;
const isOwner = () => role() === 'owner';
/** Sees the page and records payments (Roles & access › Recurring bills). */
const canSee = () => !!role() && canOpenTab('recurring', role(), AppState.settings?.roleAccess);
/** Adds, edits and stops items and enters bill amounts. */
const canManage = () => canSee() && (isOwner() || role() === 'manager');
const isShown = () => byId('recurring')?.classList.contains('active');
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const state = {
    items: [],
    loaded: false,
    error: false,
    open: '',
    form: '',
    seq: 0,
    unusual: null,
    /** An expense from Expenses waiting to be linked ("Link to a recurring bill"). */
    linkExp: '',
    /** The payment form's choices: mode '' until picked (never a silent cash), in 'new' | 'have', the picked expense. */
    pay: { mode: '', inExp: 'new', expenseId: '', amount: '', date: '', period: '', note: '' }
};

const CADENCE_KEYS = { 1: 'ui.rbills.cadence_1', 2: 'ui.rbills.cadence_2', 3: 'ui.rbills.cadence_3', 6: 'ui.rbills.cadence_6', 12: 'ui.rbills.cadence_12' };
const MODE_KEYS = { cash: 'ui.rbills.mode_cash', online: 'ui.rbills.mode_online' };
const STATE_TAGS = { paid: 'pos', part: 'warn', due: 'warn', overdue: 'neg', nobill: 'info' };
const NAME_KEYS = ['ui.rbills.name_electricity', 'ui.rbills.name_water', 'ui.rbills.name_rent', 'ui.rbills.name_internet', 'ui.rbills.name_phone', 'ui.rbills.name_property_tax'];

function stateText(row) {
    if (row.state === 'part') return t('ui.rbills.state_part', { paid: formatRupees(row.covered), of: formatRupees(row.owed) });
    if (row.state === 'due') return t('ui.rbills.state_due', { amount: formatRupees(row.owed) });
    if (row.state === 'overdue') return t('ui.rbills.state_overdue', { amount: formatRupees(row.closing) });
    return t(row.state === 'paid' ? 'ui.rbills.state_paid' : 'ui.rbills.state_nobill');
}

const stateTag = (row) => (row ? `<span class="tag ${esc(STATE_TAGS[row.state])}" data-rb-state="${esc(row.state)}">${esc(stateText(row))}</span>` : '');

function balanceLine(balance) {
    const { left, advance } = balanceParts(balance);
    if (left > 0) return `<span class="tone-neg">${et('ui.rbills.balance_left', { amount: formatRupees(left) })}</span>`;
    if (advance > 0) return `<span class="tone-info">${et('ui.rbills.credit', { amount: formatRupees(advance) })}</span>`;
    return `<span class="tone-muted">${et('ui.rbills.nothing_left')}</span>`;
}

const metric = (id, key, amount) => `<div class="metric"><div class="metric-label">${et(key)}</div><div class="metric-value" data-rb="${esc(id)}">${moneyText(amount)}</div></div>`;

function renderSummary(sum) {
    return `<div class="panel metrics rb-metrics">
            ${metric('RB-8', 'ui.rbills.due_now', sum.dueNow)}
            ${metric('RB-9', 'ui.rbills.paid_month', sum.paidMonth)}
            ${metric('RB-5', 'ui.rbills.credit_total', sum.credit)}
        </div>
        <div class="rb-actions rb-list-head">
            <p class="tone-muted rb-counts">${et('ui.rbills.counts', sum.counts)}</p>
            ${canManage() ? `<button type="button" class="btn btn-tonal rb-add" data-onclick="recurring.showForm('add')">${icon('plus', 'i-sm')} ${et('ui.rbills.add')}</button>` : ''}
        </div>`;
}

function rowMeta(v) {
    const parts = [t(CADENCE_KEYS[v.item.cadence] || CADENCE_KEYS[1])];
    if (v.item.active === false) parts.push(t('ui.rbills.stopped'));
    if (v.nextDue) parts.push(t(v.current ? 'ui.rbills.next_due' : 'ui.rbills.first_due', { date: dayName(v.nextDue) }));
    return parts.join(' · ');
}

function renderRow(v) {
    const open = state.open === v.item.id;
    return `<button type="button" class="row${open ? ' selected' : ''}" data-rbill="${esc(v.item.id)}" aria-expanded="${open}" data-onclick="recurring.open('${js(v.item.id)}')">
            <span class="row-main"><span class="row-title">${esc(v.item.name)}</span><span class="row-meta">${esc(rowMeta(v))}</span></span>
            <span class="row-trail">${stateTag(v.current)}<span class="row-meta">${balanceLine(v.balance)}</span></span>
        </button>`;
}

const label = (id, key) => `<label for="${esc(id)}">${et(key)}</label>`;
const options = (pairs, chosen) => pairs.map(([v, text]) => `<option value="${esc(v)}"${String(v) === String(chosen) ? ' selected' : ''}>${esc(text)}</option>`).join('');

function formActions(save) {
    return `<div class="rb-actions">
            <button type="button" class="btn btn-primary" id="rbSave" data-onclick="recurring.${esc(save)}()">${et('ui.rbills.save')}</button>
            <button type="button" class="btn btn-ghost" data-onclick="recurring.cancel()">${et('ui.modals.cancel')}</button>
        </div>`;
}

function renderItemForm(item) {
    const editing = Boolean(item);
    const fixed = editing && (item.entries || []).length > 0;
    const lock = fixed ? ' disabled' : '';
    const names = NAME_KEYS.map(k => `<option value="${et(k)}"></option>`).join('');
    return `<div class="panel panel-pad rb-form" id="${editing ? 'rbEditForm' : 'rbAddForm'}">
            <h3>${et(editing ? 'ui.rbills.edit' : 'ui.rbills.add')}</h3>
            <div class="field">${label('rbName', 'ui.rbills.name')}<input class="input" id="rbName" list="rbNames" maxlength="${esc(MAX_NAME)}" autocomplete="off" value="${esc(item?.name || '')}"><datalist id="rbNames">${names}</datalist></div>
            <div class="field">${label('rbCadence', 'ui.rbills.cadence')}<select class="input" id="rbCadence"${lock}>${options(CADENCES.map(c => [c, t(CADENCE_KEYS[c])]), item?.cadence || 1)}</select></div>
            <div class="field">${label('rbDueDay', 'ui.rbills.due_day')}<input class="input" id="rbDueDay" inputmode="numeric" type="number" min="1" max="${esc(MAX_DUE_DAY)}" step="1" value="${esc(item?.dueDay || 10)}"></div>
            <div class="field">${label('rbStart', 'ui.rbills.start_month')}<input class="input" id="rbStart" type="month" value="${esc(item?.startMonth || monthKeyOf(new Date()))}"${lock}></div>
            <div class="field">${label('rbExpected', 'ui.rbills.expected')}<input class="input" id="rbExpected" inputmode="numeric" type="number" min="0" step="1" value="${esc(item?.expected || '')}"></div>
            <div class="field">${label('rbNote', 'ui.rbills.note')}<input class="input" id="rbNote" maxlength="${esc(MAX_NOTE)}" autocomplete="off" value="${esc(item?.note || '')}"></div>
            <p class="tone-muted">${et(fixed ? 'ui.rbills.fixed_help' : 'ui.rbills.cadence_help')}</p>
            ${formActions(editing ? 'saveEdit' : 'saveItem')}
        </div>`;
}

function periodOptions(v, chosen) {
    return options(entryPeriods(v.item, today()).slice(-24).reverse().map(p => [p, t('ui.rbills.period_option', { month: monthName(p), date: dayName(`${p}-${String(v.item.dueDay).padStart(2, '0')}`) })]), chosen);
}

/** The period a new entry is for: the current one; a bill already entered for it moves a new bill to the next. */
function defaultPeriod(v, kind) {
    const periods = entryPeriods(v.item, today());
    const current = v.current?.period || periods[0];
    if (kind === 'bill' && v.current?.source === 'entered') return periods[periods.indexOf(current) + 1] || current;
    return current;
}

function renderBillForm(v) {
    const warn = state.unusual
        ? `<div class="notice warn" id="rbUnusual" role="alert">${et('ui.rbills.unusual', { last: formatRupees(state.unusual.last) })}
                <button type="button" class="btn btn-tonal btn-sm" data-onclick="recurring.saveBill(true)">${et('ui.rbills.its_right')}</button></div>`
        : '';
    return `<div class="panel panel-pad rb-form" id="rbBillForm">
            <h3>${et('ui.rbills.enter_bill', { name: v.item.name })}</h3>
            <div class="field">${label('rbPeriod', 'ui.rbills.period')}<select class="input" id="rbPeriod">${periodOptions(v, state.unusual?.period || defaultPeriod(v, 'bill'))}</select></div>
            <div class="field">${label('rbAmount', 'ui.rbills.bill_amount')}<div class="adorn"><span class="adorn-pre" aria-hidden="true">₹</span><input class="input" id="rbAmount" inputmode="numeric" type="number" min="0" step="1" value="${esc(state.unusual?.amount ?? '')}"></div></div>
            <p class="tone-muted">${et('ui.rbills.bill_help')}</p>
            ${warn}
            ${formActions('saveBill')}
        </div>`;
}

const seg = (label, field, pairs, chosen) => `<div class="field"><span class="rb-pick-label" id="rb-${esc(field)}-l">${et(label)}</span>
            <div class="seg" role="group" aria-labelledby="rb-${esc(field)}-l" data-rb-seg="${esc(field)}">${pairs.map(([v, key]) => `<button type="button" aria-pressed="${String(v === chosen)}" data-onclick="recurring.pick('${js(field)}', '${js(v)}')">${et(key)}</button>`).join('')}</div></div>`;

/** "Already in Expenses": the expenses near the payment's day, the same amount first. */
function expenseChoices(p) {
    const list = linkCandidates(AppState.expensesHistory || [], { day: p.date || today(), amount: Number(p.amount) || 0 }).slice(0, 12);
    if (!list.length) return `<p class="tone-muted" id="rbNoExpense">${et('ui.rbills.no_expense_match')}</p>`;
    return `<div class="panel rb-exp-list" role="radiogroup" aria-label="${et('ui.rbills.pick_expense')}">${list.map(x => `<label class="row">
            <input type="radio" name="rbExpense" value="${esc(x.id)}"${String(x.id) === p.expenseId ? ' checked' : ''} data-onchange="recurring.pick('expenseId', '${js(x.id)}')">
            <span class="row-main"><span class="row-title">${esc(formatRupees(x.amount))} · ${esc(x.type || '')}</span>
            <span class="row-meta">${esc(dayName(expenseDayOf(x)))} · ${et(MODE_KEYS[x.paymentMode === 'online' ? 'online' : 'cash'])}${x.remarks ? ` · ${esc(x.remarks)}` : ''}</span></span></label>`).join('')}</div>`;
}

function renderPayForm(v) {
    const p = state.pay;
    const have = p.inExp === 'have';
    const amount = p.amount !== '' ? p.amount : (Math.max(0, v.balance) || '');
    return `<div class="panel panel-pad rb-form" id="rbPayForm">
            <h3>${et('ui.rbills.record', { name: v.item.name })}</h3>
            <div class="field">${label('rbAmount', 'ui.rbills.amount')}<div class="adorn"><span class="adorn-pre" aria-hidden="true">₹</span><input class="input" id="rbAmount" inputmode="numeric" type="number" min="1" step="1" value="${esc(amount)}" data-onchange="recurring.keep()"></div></div>
            <div class="field">${label('rbPeriod', 'ui.rbills.period')}<select class="input" id="rbPeriod">${periodOptions(v, p.period || defaultPeriod(v, 'pay'))}</select></div>
            <div class="field">${label('rbDate', 'ui.rbills.date')}<input class="input" id="rbDate" type="date" value="${esc(p.date || today())}" max="${esc(today())}" data-onchange="recurring.keep()"></div>
            ${seg('ui.rbills.in_expenses', 'inExp', [['new', 'ui.rbills.add_to_expenses'], ['have', 'ui.rbills.already_in_expenses']], p.inExp)}
            ${have ? expenseChoices(p) : seg('ui.rbills.mode', 'mode', Object.entries(MODE_KEYS), p.mode)}
            <div class="field">${label('rbPayNote', 'ui.rbills.pay_note')}<input class="input" id="rbPayNote" maxlength="${esc(MAX_NOTE)}" autocomplete="off" value="${esc(p.note)}"></div>
            <p class="tone-muted rb-hint">${et('ui.rbills.counts_once')} ${infoTipHtml(t(have ? 'ui.rbills.counts_once_have' : 'ui.rbills.counts_once_new'))}</p>
            ${formActions('savePay')}
        </div>`;
}

function renderStopForm(v) {
    return `<div class="panel panel-pad rb-form" id="rbStopForm">
            <h3>${et('ui.rbills.stop')}</h3>
            <div class="field">${label('rbLastMonth', 'ui.rbills.last_month')}<input class="input" id="rbLastMonth" type="month" min="${esc(v.item.startMonth)}" value="${esc(v.current?.period || v.item.startMonth)}"></div>
            <p class="tone-muted">${et('ui.rbills.stop_help')}</p>
            ${formActions('saveStop')}
        </div>`;
}

function renderPeriods(v) {
    const shown = v.periods.slice(-24).reverse();
    if (!shown.length) return emptyState({ icon: 'calendar', title: t('ui.rbills.no_periods') });
    const rows = shown.map(r => `<tr data-period="${esc(r.period)}">
            <td>${esc(monthName(r.period))}</td>
            <td>${esc(dayName(r.due))}</td>
            <td class="num">${r.bill === null ? '—' : moneyText(r.bill)}${r.source === 'expected' ? ` <span class="tone-muted">${et('ui.rbills.expected_mark')}</span>` : ''}</td>
            <td class="num">${moneyText(r.paid)}</td>
            <td class="num">${r.opening ? moneyText(r.opening) : ''}</td>
            <td>${stateTag(r)}</td>
            <td>${balanceLine(r.closing)}</td>
        </tr>`).join('');
    return `<div class="scroll-cue"><div class="scroll-cue-inner"><table class="table">
            <thead><tr><th>${et('ui.rbills.period')}</th><th>${et('ui.rbills.col_due')}</th><th>${et('ui.rbills.col_bill')}</th><th>${et('ui.rbills.col_paid')}</th><th>${et('ui.rbills.col_carried_in')}</th><th>${et('ui.rbills.col_state')}</th><th>${et('ui.rbills.col_balance')}</th></tr></thead>
            <tbody>${rows}</tbody></table></div></div>`;
}

/** The loaded expense of a payment (null when not loaded on this phone). */
const expenseOf = (id) => (id ? (AppState.expensesHistory || []).find(x => String(x?.id) === String(id)) || null : null);

/** Who may take a payment off: with its expense voided (VOID-EXP), or the owner for one not in Money. */
function mayRemove(item, e) {
    const exp = payExpenseId(item, e);
    if (!exp) return isOwner();
    const loaded = expenseOf(exp);
    if (loaded) return canVoidExpenseWith(loaded, { uid: AppState.currentUser?.uid, role: role(), raw: AppState.settings?.roleAccess });
    return isOwner() || role() === 'manager';
}

function renderEntries(item) {
    const list = [...(item.entries || [])].reverse();
    if (!list.length) return emptyState({ icon: 'list', title: t('ui.rbills.no_entries') });
    return list.map((e) => {
        const month = monthName(periodOf(item, e.period));
        if (e.kind === 'bill') {
            return `<div class="row" data-entry="${esc(e.id)}"><span class="row-main"><span class="row-title">${et('ui.rbills.entry_bill', { amount: formatRupees(e.amount) })}</span>
                <span class="row-meta">${et('ui.rbills.entry_bill_meta', { month, date: dayName(e.date) })}</span></span></div>`;
        }
        const inMoney = !!payExpenseId(item, e);
        const mark = inMoney ? '' : ` <span class="tag warn" data-rb-not-in-money>${et('ui.rbills.not_in_money')}</span>`;
        const add = !inMoney && isOwner() ? `<button type="button" class="btn btn-tonal btn-sm" data-onclick="recurring.addToMoney('${js(item.id)}', '${js(e.id)}')">${et('ui.rbills.add_to_money')}</button>` : '';
        const remove = mayRemove(item, e) ? `<button type="button" class="btn btn-ghost btn-sm" data-onclick="recurring.removeEntry('${js(item.id)}', '${js(e.id)}')">${et(inMoney ? 'ui.rbills.void' : 'ui.rbills.remove')}</button>` : '';
        return `<div class="row" data-entry="${esc(e.id)}">
            <span class="row-main"><span class="row-title">${et('ui.rbills.entry_pay', { amount: formatRupees(e.amount) })}${mark}</span>
            <span class="row-meta">${et('ui.rbills.entry_pay_meta', { month, date: dayName(e.date), mode: t(MODE_KEYS[e.mode] || MODE_KEYS.cash) })}${e.note ? ` · ${esc(e.note)}` : ''}</span></span>
            ${add}${remove}
        </div>`;
    }).join('');
}

function renderDetail(v) {
    const it = v.item;
    const manage = canManage();
    const form = state.form === 'bill' && manage ? renderBillForm(v) : state.form === 'pay' ? renderPayForm(v)
        : state.form === 'edit' && manage ? renderItemForm(it) : state.form === 'stop' && manage ? renderStopForm(v) : '';
    const stop = it.active === false || !manage ? '' : `<button type="button" class="btn btn-tonal btn-sm" data-onclick="recurring.showForm('stop')">${et('ui.rbills.stop')}</button>`;
    const keep = manage
        ? `<button type="button" class="btn btn-tonal btn-sm" data-onclick="recurring.showForm('bill')">${et('ui.rbills.enter_bill_btn')}</button>` : '';
    const edit = manage ? `<button type="button" class="btn btn-tonal btn-sm" data-onclick="recurring.showForm('edit')">${et('ui.rbills.edit')}</button>` : '';
    return `<section class="panel panel-pad rb-detail" id="rbDetail">
            <h3>${esc(it.name)}</h3>
            ${it.note ? `<p class="tone-muted">${esc(it.note)}</p>` : ''}
            <p>${balanceLine(v.balance)}${v.nextDue ? ` · ${et('ui.rbills.next_due', { date: dayName(v.nextDue) })}` : ''}</p>
            <div class="rb-actions">
                ${keep}
                <button type="button" class="btn btn-tonal btn-sm" data-onclick="recurring.showForm('pay')">${et('ui.rbills.record_btn')}</button>
                ${edit}
                ${stop}
            </div>
            ${form}
            <h4>${et('ui.rbills.by_period')}</h4>
            ${renderPeriods(v)}
            <h4>${et('ui.rbills.entries')}</h4>
            <div class="panel">${renderEntries(it)}</div>
        </section>`;
}

export function render() {
    const root = byId('recurringBody');
    if (!root) return;
    if (!canSee()) {
        root.innerHTML = `<p class="empty">${et('ui.rbills.no_access')}</p>`;
        return;
    }
    if (!state.loaded) {
        root.innerHTML = state.error
            ? `<p class="notice neg">${et('msg.rbills.not_loaded')}</p>`
            : skeleton({ label: t('ui.rbills.loading') });
        return;
    }
    const sum = billsSummary(state.items, today());
    const rows = [...sum.rows].sort((a, b) => (a.item.active === false) - (b.item.active === false)
        || String(a.nextDue || '9999').localeCompare(String(b.nextDue || '9999')) || a.item.name.localeCompare(b.item.name));
    const open = rows.find(v => v.item.id === state.open);
    const list = rows.length
        ? `<div class="panel rb-list">${rows.map(renderRow).join('')}</div>`
        : emptyState({ icon: 'receipt', title: t('ui.rbills.none') });
    const linking = expenseOf(state.linkExp);
    const pickNote = linking ? `<p class="notice info" id="rbLinkPick">${et('ui.rbills.link_pick', { amount: formatRupees(linking.amount), date: dayName(expenseDayOf(linking)) })}</p>` : '';
    root.innerHTML = `${pickNote}${renderSummary(sum)}
        ${state.form === 'add' ? renderItemForm(null) : ''}
        ${list}
        ${open ? renderDetail(open) : ''}`;
}

function ensureCss() {
    if (byId('recurringCss')) return;
    const link = document.createElement('link');
    link.id = 'recurringCss';
    link.rel = 'stylesheet';
    link.href = 'css/recurring-bills.css';
    document.head.appendChild(link);
}

/** Keeps RB-11 for Today from the loaded items (no reads). */
function noteDue(list = state.items, uid = AppState.currentUser?.uid) {
    if (!uid) return;
    try { saveBillsDue(localStorage, { uid, days: billsDueDays(list, today()) }); } catch (_) { /* never break the page */ }
}

/**
 * Today's bills line (RB-11), once a day on the phone of anyone who sees the page (main.js, after the
 * first screen): one read per bill item. Nothing on the page changes.
 */
export async function refreshBillsDue() {
    const uid = AppState.currentUser?.uid;
    if (!canSee() || !uid) return false;
    const seq = state.seq;
    const list = await repo.loadBillItems();
    if (AppState.currentUser?.uid !== uid || !canSee()) return false;
    // The page opened or saved meanwhile: its figure is newer than this read
    if (seq !== state.seq || state.loaded) return false;
    noteDue(list, uid);
    return true;
}

/** Opens the page: reads every bill item once (one read each). */
export async function init() {
    ensureCss();
    state.loaded = false;
    state.error = false;
    render();
    if (!canSee()) return;
    const seq = ++state.seq;
    try {
        const list = await repo.loadBillItems();
        if (seq !== state.seq) return;
        state.items = list;
        state.loaded = true;
        noteDue();
    } catch (e) {
        console.warn('Recurring bills not loaded:', e?.code || e);
        if (seq === state.seq) state.error = true;
    }
    if (isShown()) render();
}

const focusFirst = { add: 'rbName', edit: 'rbName', bill: 'rbAmount', pay: 'rbAmount', stop: 'rbLastMonth' };

export function open(id) {
    state.open = state.open === id ? '' : id;
    if (state.form !== 'add') state.form = '';
    state.unusual = null;
    const x = state.open ? expenseOf(state.linkExp) : null;
    if (x) {
        state.form = 'pay';
        state.pay = { mode: '', inExp: 'have', expenseId: String(x.id), amount: String(payFromExpense(x).amount), date: expenseDayOf(x), period: '', note: '' };
        state.linkExp = '';
    }
    render();
    if (state.open) byId('rbDetail')?.scrollIntoView?.({ block: 'nearest' });
}

export function showForm(kind) {
    state.form = kind;
    state.unusual = null;
    if (kind === 'pay') state.pay = { mode: '', inExp: 'new', expenseId: '', amount: '', date: '', period: '', note: '' };
    render();
    byId(focusFirst[kind])?.focus?.();
}

export function cancel() {
    state.form = '';
    state.unusual = null;
    render();
}

const openItem = () => state.items.find(x => x.id === state.open);
const warn = (key, params) => UIManager.showToast(t(key, params), 'warning');

/** Runs one save (one tap = one write), refusing offline; true when saved. */
async function save(key, fn, doneKey, params) {
    if (Helpers.isBusy(key)) return false;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        warn('msg.rbills.needs_internet');
        return false;
    }
    try {
        await Helpers.runExclusive(key, '#recurring .btn', fn);
        noteDue();
        state.form = '';
        state.unusual = null;
        render();
        UIManager.showToast(t(doneKey, params), 'success');
        return true;
    } catch (e) {
        console.warn('Recurring bill not saved:', e?.code || e);
        UIManager.showToast(t('msg.rbills.not_saved'), 'error');
        return false;
    }
}

const itemForm = () => ({ name: val('rbName'), cadence: val('rbCadence'), dueDay: val('rbDueDay'), startMonth: val('rbStart'), expected: val('rbExpected'), note: val('rbNote') });

export async function saveItem() {
    const { item, error } = checkItem(itemForm(), monthKeyOf(new Date()));
    if (error) return warn(error);
    await save('rbills.add', async () => {
        const id = await repo.addBillItem(item);
        state.items.push({ id, ...item, active: true, endMonth: '', entries: [] });
        state.open = id;
    }, 'msg.rbills.added', { name: item.name });
}

export async function saveEdit() {
    const it = openItem();
    if (!it) return;
    const fixed = (it.entries || []).length > 0;
    const f = itemForm();
    const { item, error } = checkItem(fixed ? { ...f, cadence: it.cadence, startMonth: it.startMonth } : f, monthKeyOf(new Date()));
    if (error) return warn(error);
    if (it.endMonth && item.startMonth > it.endMonth) return warn('msg.rbills.bad_month');
    const patch = fixed ? { name: item.name, dueDay: item.dueDay, expected: item.expected, note: item.note } : item;
    await save('rbills.edit', async () => {
        await repo.updateBillItem(it.id, patch);
        Object.assign(it, patch);
    }, 'msg.rbills.saved');
}

/** Enters (or corrects) a period's bill amount; a bill over 3× the last one asks once ("Yes, it's right"). */
export async function saveBill(confirmed = false) {
    const it = openItem();
    if (!it) return;
    const { entry, error } = checkEntry({ kind: 'bill', amount: val('rbAmount'), period: val('rbPeriod'), date: today() }, it, today());
    if (error) return warn(error);
    const last = unusualBill(it, entry.period, entry.amount);
    if (last !== null && !confirmed) {
        state.unusual = { last, period: entry.period, amount: entry.amount };
        render();
        byId('rbUnusual')?.querySelector('button')?.focus?.();
        return;
    }
    const full = { id: newId(), ...entry };
    await save('rbills.bill', async () => {
        await repo.addEntry(it.id, full);
        it.entries = [...(it.entries || []), full];
    }, 'msg.rbills.bill_saved', { amount: formatRupees(full.amount), name: it.name, month: monthName(full.period) });
}

/** Keeps what is typed in the payment form across a redraw. */
export function keep() {
    if (!byId('rbPayForm')) return;
    Object.assign(state.pay, { amount: val('rbAmount'), date: val('rbDate'), period: val('rbPeriod'), note: val('rbPayNote') });
}

/** The payment form's buttons: cash / online, add to / already in Expenses, the expense picked. */
export function pick(field, value) {
    keep();
    if (!['mode', 'inExp', 'expenseId'].includes(field)) return;
    state.pay[field] = String(value);
    if (field === 'expenseId') return;
    render();
}

const who = () => ({ role: role(), roleAccess: AppState.settings?.roleAccess, now: new Date() });

/** Drawer and Today follow a new or voided bill expense at once. */
function refreshCash() {
    const cm = window.app?.cashManagement;
    if (!cm) return;
    cm.calculateTodayTransactions?.().catch?.(e => console.warn('Cash refresh after bill payment failed:', e?.code || e));
    cm.updateUI?.();
}

/**
 * Records a payment with its one expense (RB-12), in one batch: a new expense (business, "Bills", the
 * payment's mode and day), or one already in Expenses (its amount, day and mode). Online only.
 */
export async function savePay() {
    const it = openItem();
    if (!it) return;
    keep();
    const p = state.pay;
    const picked = p.inExp === 'have' ? linkCandidates(AppState.expensesHistory || [], { day: p.date || today(), amount: Number(p.amount) || 0 }).find(x => String(x.id) === p.expenseId) : null;
    if (p.inExp === 'have' && !picked) return warn('msg.rbills.pick_expense');
    if (p.inExp !== 'have' && !p.mode) return warn('msg.rbills.choose_mode');
    const from = picked ? payFromExpense(picked) : { amount: p.amount, date: p.date, mode: p.mode };
    const { entry, error } = checkEntry({ kind: 'pay', amount: from.amount, period: p.period, date: from.date, mode: from.mode, note: p.note }, it, today());
    if (error) return warn(error);
    if (!picked) {
        const problem = validateExpenseEntry({ day: entry.date, mode: entry.mode }, who());
        if (problem) return warn(problem.key, problem.params);
        if (backdatedCash(entry.date, entry.mode === 'cash' ? entry.amount : 0, role()) === 'refuse') return warn('msg.rbills.cash_today_only');
    }
    const full = { id: newId(), ...entry };
    const ok = await save('rbills.pay', async () => {
        if (picked) {
            await FirebaseService.linkExpense(picked.id, { recurringBillId: it.id, recurringPayId: full.id }, repo.payWrite(it.id, full));
            full.expenseId = String(picked.id);
        } else {
            const expense = billExpense(it, full, { uid: AppState.currentUser?.uid, name: AppState.userName || '' });
            const { record, committed } = FirebaseService.startSaveExpense(expense, { withBatch: repo.payWrite(it.id, full) });
            await committed;
            full.expenseId = record.id;
        }
        it.entries = [...(it.entries || []), full];
    }, 'msg.rbills.recorded', { amount: formatRupees(full.amount), name: it.name });
    if (ok) refreshCash();
}

/** Owner: puts a payment recorded before payments made expenses into Money (one new expense). */
export async function addToMoney(itemId, entryId) {
    const it = state.items.find(x => x.id === itemId);
    const e = it?.entries?.find(x => x.id === entryId && x.kind === 'pay');
    if (!e || !isOwner() || payExpenseId(it, e)) return;
    const ok = await save('rbills.money', async () => {
        const expense = billExpense(it, e, { uid: AppState.currentUser?.uid, name: AppState.userName || '' });
        const { record, committed } = FirebaseService.startSaveExpense(expense, { withBatch: repo.linkedWrite(it.id, e.id) });
        await committed;
        it.linked = { ...(it.linked || {}), [e.id]: record.id };
    }, 'msg.rbills.added_to_money', { amount: formatRupees(e.amount) });
    if (ok) refreshCash();
}

export async function saveStop() {
    const it = openItem();
    const last = val('rbLastMonth');
    if (!it) return;
    if (!isMonthKey(last) || last < it.startMonth) return warn('msg.rbills.bad_month');
    const later = billsAfter(it, last);
    if (later.length && !Helpers.isBusy('rbills.stop')) {
        const ok = await UIManager.showModal(t('msg.rbills.stop_drops_bills', { month: monthName(later[0]), last: monthName(last) }), t('ui.rbills.stop'), true, { confirmLabel: t('ui.rbills.stop') });
        if (!ok) return;
    }
    const patch = { active: false, endMonth: last };
    await save('rbills.stop', async () => {
        await repo.updateBillItem(it.id, patch);
        Object.assign(it, patch);
    }, 'msg.rbills.stopped', { name: it.name });
}

/** Takes a payment off: one in Money by voiding its expense (the payment goes with it, VOID-EXP); an older one (owner). */
export async function removeEntry(itemId, entryId) {
    const it = state.items.find(x => x.id === itemId);
    const entry = it?.entries?.find(e => e.id === entryId && e.kind === 'pay');
    if (!entry || !mayRemove(it, entry) || Helpers.isBusy('rbills.remove')) return;
    const expenseId = payExpenseId(it, entry);
    if (expenseId) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return warn('msg.rbills.needs_internet');
        const reason = await askReason({ titleKey: 'ui.rbills.void_title', explainKey: 'ui.rbills.void_explain', labelKey: 'ui.expenses.void_reason', confirmKey: 'ui.rbills.void', danger: true });
        if (!reason) return;
        try {
            await Helpers.runExclusive('rbills.remove', '#recurring .btn', () => FirebaseService.voidExpense(expenseId, reason));
        } catch (e) {
            console.warn('Bill payment not voided:', e?.code || e);
            UIManager.showToast(t(isPermissionDenied(e) ? 'msg.rbills.void_not_allowed' : 'msg.rbills.not_saved'), 'error');
            return;
        }
        it.entries = it.entries.filter(e => e.id !== entryId);
        if (it.linked?.[entryId]) it.linked = Object.fromEntries(Object.entries(it.linked).filter(([k]) => k !== entryId));
        noteDue();
        render();
        refreshCash();
        UIManager.showToast(t('msg.rbills.voided'), 'success');
        return;
    }
    const ok = await UIManager.showModal(t('msg.rbills.remove_confirm', { amount: formatRupees(entry.amount), name: it.name }), t('ui.rbills.remove'), true, { confirmLabel: t('ui.rbills.remove'), danger: true });
    if (!ok) return;
    await save('rbills.remove', async () => {
        await repo.removeEntry(it.id, entry);
        it.entries = it.entries.filter(e => e.id !== entryId);
    }, 'msg.rbills.removed');
}

/** From an expense's details: open the bill it paid, and the payment form has it picked. */
export function linkFrom(expenseId) {
    if (!expenseOf(expenseId)) return;
    state.linkExp = String(expenseId);
    window.app?.expenses?.closeExpenseDetails?.();
    window.app?.nav?.showTab?.('recurring');
}

/** Signed out: nothing of the last user's stays in memory. */
export function reset() {
    Object.assign(state, { items: [], loaded: false, error: false, open: '', form: '', seq: state.seq + 1, unusual: null, linkExp: '' });
}

export const RecurringBillsManager = { init, render, reset, open, showForm, cancel, saveItem, saveEdit, saveBill, savePay, saveStop, removeEntry, refreshBillsDue, keep, pick, addToMoney, linkFrom };
